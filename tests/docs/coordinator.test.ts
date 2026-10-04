import { describe, it, expect, vi } from 'vitest'
import bootstrap from '../../docs/bootstrap.json'
import { targetSchema } from '../../src/docs/contracts'
import { Github } from '../../src/docs/github'
import { Coordinator, initialState } from '../../src/runtime/coordinator'
import type { CoordinatorStorage } from '../../src/runtime/docs-state'
import { projectSnapshot } from '../../src/lib/project'
import { docsPolicy } from '../../src/docs/policy'

function setup(initialized = true) {
  const data = new Map<string, unknown>([['state', { ...initialState(), initialized }]])
  let now = Date.now()
  let active: string | undefined
  let alarm: number | null = null
  const target = targetSchema.parse(bootstrap)
  const storage: CoordinatorStorage = {
    get: async <T>(key: string) => structuredClone(data.get(key)) as T | undefined,
    put: vi.fn(async (key, value) => {
      data.set(key, structuredClone(value))
    }),
    getAlarm: async () => alarm,
    setAlarm: vi.fn(async (time) => {
      alarm = time
    }),
    transaction: async (operation) => operation(storage),
  }
  const github = new Github()
  const observation = {
    tag_name: target.operatorVersion,
    draft: false,
    prerelease: false,
    published_at: '2026-10-01T00:00:00Z',
  }
  vi.spyOn(github, 'releases').mockResolvedValue([observation])
  vi.spyOn(github, 'target').mockResolvedValue({
    target,
    chartAppVersion: target.operatorVersion.replace(/^v/, ''),
    operator: [observation],
    chart: [{ ...observation, tag_name: target.chartVersion! }],
  })
  vi.spyOn(github, 'renderer').mockResolvedValue('a'.repeat(40))
  const provider = {
    requestBuild: vi.fn(async () => 'hook-build'),
    verifyCandidate: vi.fn(async () => {}),
    deploy: vi.fn(async (id: string) => {
      active = id
    }),
    activeVersion: vi.fn(async () => active),
  }
  const make = () =>
    new Coordinator(
      storage,
      github,
      provider,
      () => now,
      async (_f, fallback) => fallback!
    )
  return {
    engine: make(),
    make,
    storage,
    github,
    target,
    provider,
    advance: (ms: number) => {
      now += ms
    },
    setActive: (id: string) => {
      active = id
    },
  }
}
const id = '11111111-1111-4111-8111-111111111111'
const versionId = '22222222-2222-4222-8222-222222222222'
describe('durable publication lifecycle', () => {
  it('deduplicates visitors, webhook deliveries, and hooks during an active build', async () => {
    const s = setup()
    await s.engine.reconcile()
    await s.engine.signal(id)
    await s.engine.signal(id)
    await s.engine.reconcile(true)
    expect(s.provider.requestBuild).toHaveBeenCalledTimes(1)
    await s.engine.claim(id, 'a'.repeat(40))
    await s.engine.reconcile(true)
    expect(s.provider.requestBuild).toHaveBeenCalledTimes(1)
    const before = (await s.engine.state()).nextCheckAt
    await s.engine.signal(undefined, true)
    expect((await s.engine.state()).nextCheckAt).toBe(before)
  })
  it('publishes an eligible candidate and handles duplicate completion', async () => {
    const s = setup()
    const plan = await s.engine.claim(id, 'a'.repeat(40))
    await s.engine.candidate(id, plan.buildKey, versionId, new Date().toISOString())
    await s.engine.candidate(id, plan.buildKey, versionId, new Date().toISOString())
    expect(s.provider.deploy).toHaveBeenCalledTimes(1)
    expect((await s.engine.state()).published?.plan.buildKey).toBe(plan.buildKey)
    await s.engine.reconcile(true)
    expect(s.provider.requestBuild).not.toHaveBeenCalled()
  })
  it('rejects old output when a newer release arrives, even before the next periodic check', async () => {
    const s = setup()
    const plan = await s.engine.claim(id, 'a'.repeat(40))
    vi.mocked(s.github.target).mockResolvedValue({
      target: {
        ...s.target,
        operatorVersion: 'v0.3.0',
        operatorSource: { ...s.target.operatorSource, ref: 'v0.3.0', commit: 'b'.repeat(40) },
        documentationSource: {
          ...s.target.documentationSource,
          ref: 'v0.3.0',
          commit: 'b'.repeat(40),
        },
      },
      operator: [],
      chart: [],
      chartAppVersion: s.target.operatorVersion,
    })
    await expect(
      s.engine.candidate(id, plan.buildKey, versionId, new Date().toISOString())
    ).rejects.toThrow('superseded')
    expect(s.provider.deploy).not.toHaveBeenCalled()
  })
  it('resumes build requests when unavailable release sources recover', async () => {
    const s = setup()
    vi.mocked(s.github.target).mockRejectedValueOnce(new Error('Chart release not ready'))
    await s.engine.reconcile()
    expect((await s.engine.state()).phase).toBe('waiting-for-sources')
    expect((await s.engine.state()).lastReleaseCheck).toBeUndefined()
    expect(s.provider.requestBuild).not.toHaveBeenCalled()
    s.advance(docsPolicy.retryIntervalMs)
    await s.engine.reconcile()
    expect((await s.engine.state()).phase).toBe('build-requested')
    expect((await s.engine.state()).lastReleaseCheck).toBeTruthy()
    expect(s.provider.requestBuild).toHaveBeenCalledTimes(1)
  })
  it('detects tag movement instead of relabeling source content', async () => {
    const s = setup()
    await s.engine.reconcile()
    vi.mocked(s.github.target).mockResolvedValue({
      target: {
        ...s.target,
        operatorSource: { ...s.target.operatorSource, commit: 'c'.repeat(40) },
      },
      operator: [],
      chart: [],
      chartAppVersion: s.target.operatorVersion,
    })
    await expect(s.engine.claim(id, 'a'.repeat(40))).rejects.toThrow('not ready')
    expect((await s.engine.state()).lastError).toContain('tag moved')
  })
  it('rejects builds of an older renderer and expired leases', async () => {
    const s = setup()
    await expect(s.engine.claim(id, 'b'.repeat(40))).rejects.toThrow('renderer')
    const plan = await s.engine.claim(id, 'a'.repeat(40))
    s.advance(docsPolicy.buildLeaseMs + 1)
    await expect(
      s.engine.candidate(id, plan.buildKey, versionId, new Date().toISOString())
    ).rejects.toThrow('expired')
    expect(s.provider.deploy).not.toHaveBeenCalled()
  })
  it('keeps the last publication during failed source checks', async () => {
    const s = setup()
    const plan = await s.engine.claim(id, 'a'.repeat(40))
    await s.engine.candidate(id, plan.buildKey, versionId, new Date().toISOString())
    vi.mocked(s.github.releases).mockRejectedValue(new Error('GitHub down'))
    const before = await s.engine.state()
    await s.engine.reconcile(true)
    const after = await s.engine.state()
    expect(after.published).toEqual(before.published)
    expect(after.lastReleaseCheck).toBe(before.lastReleaseCheck)
    expect(after.project.ci).toEqual(projectSnapshot.ci)
  })
  it('recovers remote success after a timeout and process replacement', async () => {
    const s = setup()
    const plan = await s.engine.claim(id, 'a'.repeat(40))
    s.provider.deploy.mockImplementation(async (id) => {
      s.setActive(id)
      throw new Error('timeout')
    })
    await expect(
      s.engine.candidate(id, plan.buildKey, versionId, new Date().toISOString())
    ).rejects.toThrow('timeout')
    expect((await s.engine.state()).publishing?.versionId).toBe(versionId)
    const restarted = s.make()
    await restarted.reconcile()
    expect((await restarted.state()).published?.workerVersionId).toBe(versionId)
    expect(s.provider.deploy).toHaveBeenCalledTimes(1)
  })
  it('does not publish another candidate while an earlier result is uncertain', async () => {
    const s = setup()
    const plan = await s.engine.claim(id, 'a'.repeat(40))
    s.provider.deploy.mockRejectedValue(new Error('timeout'))
    await expect(
      s.engine.candidate(id, plan.buildKey, versionId, new Date().toISOString())
    ).rejects.toThrow()
    s.advance(docsPolicy.buildLeaseMs * 2)
    await expect(s.make().claim('new-job', 'a'.repeat(40))).rejects.toThrow('unresolved')
    expect(s.provider.requestBuild).not.toHaveBeenCalled()
  })
  it('persists scheduling before a failed hook and bounds retries', async () => {
    const s = setup()
    s.provider.requestBuild.mockRejectedValue(new Error('timeout'))
    for (let i = 0; i < 10; i++) {
      await s.make().reconcile(true)
      s.advance(docsPolicy.buildLeaseMs + 1)
    }
    expect(s.provider.requestBuild).toHaveBeenCalledTimes(5)
    expect(s.storage.setAlarm).toHaveBeenCalled()
  })
  it('retains published identity during an explicit rebuild', async () => {
    const s = setup()
    const plan = await s.engine.claim(id, 'a'.repeat(40))
    await s.engine.candidate(id, plan.buildKey, versionId, new Date().toISOString())
    await s.engine.forceRebuild()
    await s.engine.reconcile()
    expect((await s.engine.state()).published?.workerVersionId).toBe(versionId)
    expect(s.provider.requestBuild).toHaveBeenCalledTimes(1)
  })
})

describe('bootstrap isolation', () => {
  it('does not let visitors race source selection before explicit initialization', async () => {
    const s = setup(false)
    await s.engine.signal()
    await s.engine.reconcile()
    expect(s.github.target).not.toHaveBeenCalled()
    expect(s.provider.requestBuild).not.toHaveBeenCalled()
    await expect(s.engine.claim(id, 'a'.repeat(40))).rejects.toThrow('Bootstrap')
    const { makePlan, digest } = await import('../../src/docs/contracts')
    const plan = await makePlan('a'.repeat(40), await digest(docsPolicy), [s.target])
    s.setActive(versionId)
    await s.engine.bootstrap(plan, versionId, new Date().toISOString())
    await s.engine.reconcile()
    expect((await s.engine.state()).published?.workerVersionId).toBe(versionId)
    expect(s.provider.requestBuild).not.toHaveBeenCalled()
  })
})

describe('notification latency', () => {
  it('durably accepts a webhook while source observation is stalled', async () => {
    const s = setup()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const original = s.github.target.bind(s.github)
    vi.mocked(s.github.target).mockImplementationOnce(async () => {
      await gate
      return original()
    })
    const checking = s.engine.reconcile()
    await vi.waitFor(() => expect(s.github.target).toHaveBeenCalled())
    await s.engine.signal(id)
    expect(await s.storage.get('signals')).toMatchObject({ receipts: { [id]: expect.any(Number) } })
    const wakeup = await s.storage.getAlarm()
    release()
    await checking
    expect(await s.storage.getAlarm()).toBe(wakeup)
  })
})
