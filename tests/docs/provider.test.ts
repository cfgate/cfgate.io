import { describe, it, expect, vi } from 'vitest'
import { CloudflarePublication } from '../../src/runtime/provider'
import { makePlan, targetSchema } from '../../src/docs/contracts'
import bootstrap from '../../docs/bootstrap.json'
const id = '22222222-2222-4222-8222-222222222222'
describe('Cloudflare publication adapter', () => {
  it('checks candidate annotations and publishes only the selected version at 100 percent', async () => {
    const plan = await makePlan('a'.repeat(40), 'b'.repeat(64), [targetSchema.parse(bootstrap)])
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          result: {
            id,
            annotations: {
              'workers/message': plan.buildKey,
              'workers/tag': plan.buildKey.slice(0, 24),
            },
          },
        })
      )
      .mockResolvedValueOnce(Response.json({ success: true, result: {} }))
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          result: { deployments: [{ versions: [{ version_id: id, percentage: 100 }] }] },
        })
      )
    const provider = new CloudflarePublication('a'.repeat(32), 'deploy-secret', '', fetcher)
    await provider.verifyCandidate(id, plan)
    await provider.deploy(id)
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({
      strategy: 'percentage',
      versions: [{ version_id: id, percentage: 100 }],
    })
    expect(await provider.activeVersion()).toBe(id)
  })
  it('rejects a candidate from another build and avoids leaking authorization to the hook', async () => {
    const plan = await makePlan('a'.repeat(40), 'b'.repeat(64), [targetSchema.parse(bootstrap)])
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ success: true, result: { id, annotations: {} } }))
      .mockResolvedValueOnce(Response.json({ success: true, result: { build_uuid: id } }))
    const provider = new CloudflarePublication(
      'a'.repeat(32),
      'deploy-secret',
      'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/test',
      fetcher
    )
    await expect(provider.verifyCandidate(id, plan)).rejects.toThrow('does not match')
    expect(await provider.requestBuild()).toBe(id)
    expect(fetcher.mock.calls[1][1]?.headers).toBeUndefined()
  })
})
