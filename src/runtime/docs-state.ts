import type { DocsBuildPlan, PublishedDocs } from '../docs/contracts.js'
import type { GithubCache } from '../docs/github.js'
import type { ProjectData } from '../lib/project.js'

export interface BuildJob {
  id: string
  plan: DocsBuildPlan
  expiresAt: number
  status: 'building' | 'failed' | 'superseded' | 'published'
}
export interface CoordinatorState {
  schemaVersion: 1
  initialized: boolean
  project: ProjectData
  github: GithubCache
  desired?: DocsBuildPlan
  published?: PublishedDocs
  publishing?: {
    jobId: string
    versionId: string
    builtAt: string
    plan: DocsBuildPlan
    startedAt: number
  }
  jobs: BuildJob[]
  pins: Record<string, string>
  nextCheckAt: number
  nextBuildAt: number
  forceRebuild?: boolean
  attempts: number
  phase:
    | 'waiting-for-bootstrap'
    | 'ready'
    | 'waiting-for-sources'
    | 'build-requested'
    | 'building'
    | 'publishing'
    | 'failed'
  lastReleaseCheck?: string
  lastError?: string
  desiredObservedAt?: number
  lastPublicationDelayMs?: number
  observedLatest?: string
  counters: {
    checks: number
    unchanged: number
    requested: number
    failures: number
    superseded: number
    published: number
  }
}
export interface CoordinatorSignals {
  pending?: string
  receipts: Record<string, number>
}
export interface CoordinatorStorage {
  transaction<T>(
    operation: (txn: Pick<CoordinatorStorage, 'get' | 'put'>) => Promise<T>
  ): Promise<T>
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
  setAlarm(time: number): Promise<void>
}
