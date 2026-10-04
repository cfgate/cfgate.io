import { digest, makePlan, type DocsBuildPlan } from '../docs/contracts.js'
import { Github, SourceError } from '../docs/github.js'
import { docsPolicy } from '../docs/policy.js'
import { loadProjectData, projectSnapshot } from '../lib/project.js'
import type { CoordinatorState, CoordinatorStorage, CoordinatorSignals } from './docs-state.js'
import type { PublicationProvider } from './provider.js'

export function initialState(): CoordinatorState {
  return {
    schemaVersion: 1,
    initialized: false,
    project: structuredClone(projectSnapshot),
    github: {},
    jobs: [],
    pins: {},
    nextCheckAt: 0,
    nextBuildAt: 0,
    attempts: 0,
    phase: 'waiting-for-bootstrap',
    counters: {
      checks: 0,
      unchanged: 0,
      requested: 0,
      failures: 0,
      superseded: 0,
      published: 0,
    },
  }
}

export class Conflict extends Error {}
export class Coordinator {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(
    private storage: CoordinatorStorage,
    private github: Github,
    private provider: PublicationProvider,
    private now: () => number = Date.now,
    private projectLoader = loadProjectData
  ) {}
  serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation)
    this.queue = next.catch(() => undefined)
    return next
  }
  async state(): Promise<CoordinatorState> {
    return (await this.storage.get<CoordinatorState>('state')) ?? initialState()
  }
  private async schedule(time: number) {
    await this.storage.transaction(async (txn) => {
      const current = await txn.getAlarm()
      if (current === null || current > time) await txn.setAlarm(time)
    })
  }
  private async save(state: CoordinatorState) {
    state.jobs = state.jobs.slice(-8)
    // Write the alarm before state: a crash after either write must leave a wakeup.
    await this.schedule(this.now() + (state.publishing ? 60000 : docsPolicy.retryIntervalMs))
    await this.storage.put('state', state)
  }
  async signal(delivery?: string, staleOnly = false): Promise<void> {
    if (staleOnly && (await this.state()).nextCheckAt > this.now()) return
    // A webhook receipt must not wait for a build claim or provider call holding the publication lock.
    await this.schedule(this.now() + 1000)
    await this.storage.transaction(async (txn) => {
      const signals = (await txn.get<CoordinatorSignals>('signals')) ?? { receipts: {} }
      if (delivery && signals.receipts[delivery]) return
      if (delivery) signals.receipts[delivery] = this.now()
      signals.receipts = Object.fromEntries(
        Object.entries(signals.receipts)
          .filter(([, time]) => this.now() - time < 86400000)
          .slice(-256)
      )
      signals.pending = crypto.randomUUID()
      await txn.put('signals', signals)
    })
  }
  private async consumeSignal(revision?: string): Promise<void> {
    if (!revision) return
    await this.storage.transaction(async (txn) => {
      const signals = await txn.get<CoordinatorSignals>('signals')
      if (signals?.pending === revision) {
        signals.pending = undefined
        await txn.put('signals', signals)
      }
    })
  }
  private pin(state: CoordinatorState, plan: DocsBuildPlan) {
    for (const target of plan.targets)
      for (const source of [
        target.operatorSource,
        target.documentationSource,
        target.chartSource,
      ]) {
        if (!source) continue
        const key = `${source.repository}:${source.ref}`
        if (state.pins[key] && state.pins[key] !== source.commit)
          throw new Conflict(`Release tag moved: ${key}`)
        state.pins[key] = source.commit
      }
    // Keep bounded receipts for recently selected sources; full provenance stays in deployment manifests.
    state.pins = Object.fromEntries(Object.entries(state.pins).slice(-64))
  }
  private async observe(state: CoordinatorState): Promise<boolean> {
    state.counters.checks++
    this.github.cache = state.github
    state.project = await this.projectLoader(fetch, state.project)
    try {
      const releases = await this.github.releases('cfgate/cfgate')
      state.observedLatest = releases[0]?.tag_name
      state.lastReleaseCheck = new Date(this.now()).toISOString()
      const [selected, renderer] = await Promise.all([this.github.target(), this.github.renderer()])
      const plan = await makePlan(
        renderer,
        await digest(docsPolicy),
        [selected.target],
        (state.desired?.generation ?? 0) + 1
      )
      this.pin(state, plan)
      const display = (repo: string, entries: typeof releases) =>
        entries.slice(0, 3).map((r) => ({
          version: r.tag_name,
          published: r.published_at!,
          url: `https://github.com/${repo}/releases/tag/${r.tag_name}`,
        }))
      state.project.releases = {
        source: 'github',
        checkedAt: state.lastReleaseCheck,
        operator: display('cfgate/cfgate', selected.operator),
        chart: display('cfgate/helm-chart', selected.chart),
        chartAppVersion: selected.chartAppVersion,
      }
      if (state.desired?.buildKey !== plan.buildKey) {
        for (const job of state.jobs)
          if (job.status === 'building') {
            job.status = 'superseded'
            state.counters.superseded++
          }
        state.desired = plan
        state.desiredObservedAt = this.now()
        state.attempts = 0
        state.nextBuildAt = 0
      } else state.counters.unchanged++
      if (state.phase === 'waiting-for-sources') state.phase = 'ready'
      state.nextCheckAt = this.now() + docsPolicy.checkIntervalMs
      state.lastError = undefined
      return true
    } catch (error) {
      state.phase = 'waiting-for-sources'
      state.lastError = error instanceof Error ? error.message : 'Source check failed'
      state.nextCheckAt = Math.max(
        this.now() + docsPolicy.retryIntervalMs,
        error instanceof SourceError && Number.isFinite(error.retryAt) ? error.retryAt! : 0
      )
      return false
    } finally {
      state.github = this.github.cache
      await this.save(state)
    }
  }
  private async recoverPublication(state: CoordinatorState): Promise<boolean> {
    if (!state.publishing) return true
    const pending = state.publishing
    if ((await this.provider.activeVersion()) !== pending.versionId) {
      state.phase = 'publishing'
      state.lastError = 'Publication outcome is unresolved; new publication is blocked'
      await this.save(state)
      return false
    }
    state.published = {
      plan: pending.plan,
      workerVersionId: pending.versionId,
      builtAt: pending.builtAt,
      deployedAt: new Date(this.now()).toISOString(),
    }
    const job = state.jobs.find((job) => job.id === pending.jobId)
    if (job) job.status = 'published'
    state.lastPublicationDelayMs = this.now() - (state.desiredObservedAt ?? pending.startedAt)
    state.counters.published++
    state.phase = 'ready'
    state.publishing = undefined
    state.forceRebuild = false
    state.lastError = undefined
    await this.save(state)
    return true
  }
  async reconcile(force = false): Promise<void> {
    return this.serial(async () => {
      const state = await this.state()
      const signal = await this.storage.get<CoordinatorSignals>('signals')
      try {
        if (!state.initialized) {
          await this.save(state)
          return
        }
        if (!(await this.recoverPublication(state))) return
        if (force || signal?.pending || this.now() >= state.nextCheckAt) {
          const observed = await this.observe(state)
          await this.consumeSignal(signal?.pending)
          if (!observed) return
        }
        if (
          !state.desired ||
          state.phase === 'waiting-for-sources' ||
          (state.published?.plan.buildKey === state.desired.buildKey && !state.forceRebuild)
        ) {
          await this.save(state)
          return
        }
        if (state.jobs.some((j) => j.status === 'building' && j.expiresAt > this.now())) {
          await this.save(state)
          return
        }
        if (this.now() < state.nextBuildAt || state.attempts >= 5) {
          await this.save(state)
          return
        }
        state.attempts++
        state.phase = 'build-requested'
        state.nextBuildAt = this.now() + docsPolicy.buildLeaseMs
        await this.save(state)
        await this.provider.requestBuild()
        state.counters.requested++
        await this.save(state)
      } catch (error) {
        state.counters.failures++
        state.lastError = error instanceof Error ? error.message : 'Reconciliation failed'
        if (!state.publishing) state.phase = 'failed'
        await this.save(state)
      }
    })
  }
  async claim(id: string, renderer: string): Promise<DocsBuildPlan> {
    return this.serial(async () => {
      const state = await this.state()
      if (!state.initialized) throw new Conflict('Bootstrap is required')
      if (!(await this.recoverPublication(state))) throw new Conflict('Publication is unresolved')
      if (!(await this.observe(state))) throw new Conflict('Sources are not ready')
      const plan = state.desired!
      if (renderer !== plan.rendererCommit) throw new Conflict('Build renderer is not current main')
      const old = state.jobs.find((job) => job.id === id)
      if (old) {
        if (
          old.status !== 'building' ||
          old.plan.buildKey !== plan.buildKey ||
          old.expiresAt <= this.now()
        )
          throw new Conflict('Build is no longer eligible')
        return old.plan
      }
      if (state.jobs.some((j) => j.status === 'building' && j.expiresAt > this.now()))
        throw new Conflict('Another build holds the lease')
      state.jobs.push({
        id,
        plan,
        expiresAt: this.now() + docsPolicy.buildLeaseMs,
        status: 'building',
      })
      state.phase = 'building'
      state.nextBuildAt = this.now() + docsPolicy.buildLeaseMs
      await this.save(state)
      return plan
    })
  }
  async candidate(id: string, buildKey: string, versionId: string, builtAt: string): Promise<void> {
    return this.serial(async () => {
      const state = await this.state()
      if (
        state.published?.workerVersionId === versionId &&
        state.published.plan.buildKey === buildKey
      )
        return
      if (!state.initialized) throw new Conflict('Bootstrap is required')
      if (!(await this.recoverPublication(state))) throw new Conflict('Publication is unresolved')
      if (!(await this.observe(state)))
        throw new Conflict('Cannot verify current release eligibility')
      const job = state.jobs.find((job) => job.id === id)
      if (
        job?.status !== 'building' ||
        job.expiresAt <= this.now() ||
        job.plan.buildKey !== buildKey ||
        state.desired?.buildKey !== buildKey ||
        state.desired.generation !== job.plan.generation
      )
        throw new Conflict('Candidate superseded or expired')
      await this.provider.verifyCandidate(versionId, job.plan)
      state.publishing = { jobId: id, versionId, builtAt, plan: job.plan, startedAt: this.now() }
      state.phase = 'publishing'
      await this.save(state)
      // An uncertain provider response leaves durable intent; never advance to another candidate until observed.
      await this.provider.deploy(versionId)
      if (!(await this.recoverPublication(state)))
        throw new Conflict('Deployment not yet confirmed')
    })
  }
  async failure(id: string): Promise<void> {
    return this.serial(async () => {
      const state = await this.state()
      const job = state.jobs.find((j) => j.id === id)
      if (job?.status !== 'building' || state.publishing?.jobId === id) return
      job.status = 'failed'
      state.counters.failures++
      state.phase = 'failed'
      state.nextBuildAt = this.now() + docsPolicy.retryIntervalMs * Math.min(6, 2 ** state.attempts)
      await this.save(state)
    })
  }
  async bootstrap(plan: DocsBuildPlan, versionId: string, builtAt: string): Promise<void> {
    return this.serial(async () => {
      const state = await this.state()
      if (state.published || state.publishing || state.desired)
        throw new Conflict('Coordinator already initialized')
      if ((await this.provider.activeVersion()) !== versionId)
        throw new Conflict('Bootstrap must identify the active deployment')
      this.pin(state, plan)
      state.initialized = true
      state.phase = 'ready'
      state.published = {
        plan,
        workerVersionId: versionId,
        builtAt,
        deployedAt: new Date(this.now()).toISOString(),
      }
      await this.save(state)
    })
  }
  async forceRebuild(): Promise<void> {
    return this.serial(async () => {
      const state = await this.state()
      if (
        state.publishing ||
        state.jobs.some((j) => j.status === 'building' && j.expiresAt > this.now())
      )
        throw new Conflict('Work is already active')
      state.forceRebuild = true
      if (state.desired) state.desired.generation++
      state.attempts = 0
      state.nextBuildAt = 0
      state.nextCheckAt = 0
      await this.save(state)
    })
  }
}
