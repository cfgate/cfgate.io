import { z } from 'zod'
import { boundedText } from '../docs/github.js'
import type { DocsBuildPlan } from '../docs/contracts.js'

export interface PublicationProvider {
  requestBuild(): Promise<string>
  verifyCandidate(id: string, plan: DocsBuildPlan): Promise<void>
  deploy(id: string): Promise<void>
  activeVersion(): Promise<string | undefined>
}
export class CloudflarePublication implements PublicationProvider {
  constructor(
    private account: string,
    private token: string,
    private hook: string,
    private fetcher: typeof fetch = fetch
  ) {}
  private async api(path: string, init: RequestInit = {}): Promise<unknown> {
    if (!/^[a-f0-9]{32}$/.test(this.account))
      throw new Error('Missing Cloudflare account configuration')
    const response = await this.fetcher(
      `https://api.cloudflare.com/client/v4/accounts/${this.account}/workers/scripts/cfgate-service-worker/${path}`,
      {
        ...init,
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      }
    )
    const payload = z
      .object({ success: z.boolean(), result: z.unknown() })
      .parse(JSON.parse(await boundedText(response, 1024 * 1024)))
    if (!response.ok || !payload.success)
      throw new Error(`Publication provider returned ${response.status}`)
    return payload.result
  }
  async requestBuild(): Promise<string> {
    if (
      !/^https:\/\/api\.cloudflare\.com\/client\/v4\/workers\/builds\/deploy_hooks\/[a-zA-Z0-9_-]+$/.test(
        this.hook
      )
    )
      throw new Error('Missing or invalid deploy hook')
    const response = await this.fetcher(this.hook, {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    })
    if (!response.ok) throw new Error(`Build hook returned ${response.status}`)
    return z
      .object({ success: z.literal(true), result: z.object({ build_uuid: z.uuid() }) })
      .parse(JSON.parse(await boundedText(response, 16000))).result.build_uuid
  }
  async verifyCandidate(id: string, plan: DocsBuildPlan): Promise<void> {
    z.uuid().parse(id)
    const result = z
      .object({ id: z.string(), annotations: z.record(z.string(), z.string()) })
      .parse(await this.api(`versions/${id}`))
    if (
      result.id !== id ||
      result.annotations['workers/message'] !== plan.buildKey ||
      result.annotations['workers/tag'] !== plan.buildKey.slice(0, 24)
    )
      throw new Error('Uploaded candidate does not match build plan')
  }
  async deploy(id: string): Promise<void> {
    await this.api('deployments', {
      method: 'POST',
      body: JSON.stringify({
        strategy: 'percentage',
        versions: [{ version_id: id, percentage: 100 }],
      }),
    })
  }
  async activeVersion(): Promise<string | undefined> {
    const result = z
      .object({
        deployments: z.array(
          z.object({
            versions: z.array(z.object({ version_id: z.string(), percentage: z.number() })),
          })
        ),
      })
      .parse(await this.api('deployments'))
    const versions = result.deployments[0]?.versions
    if (versions?.length !== 1 || versions[0].percentage !== 100) return undefined
    return versions[0].version_id
  }
}
