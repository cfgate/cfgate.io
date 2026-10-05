import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudflarePublication } from '../../../src/runtime/provider'
import { Github } from '../../../src/docs/github'

// Validate workerd Request options without sending real provider mutations.
afterEach(() => vi.restoreAllMocks())
describe('default API transports in Workers', () => {
  it('uses the global fetch receiver for publication, hooks and GitHub reads', async () => {
    const responses = [
      {
        success: true,
        result: { deployments: [{ versions: [{ version_id: 'active', percentage: 100 }] }] },
      },
      { success: true, result: { build_uuid: '11111111-1111-4111-8111-111111111111' } },
      [],
    ]
    vi.spyOn(globalThis, 'fetch').mockImplementation(async function (this: unknown, input, init) {
      expect(this).toBe(globalThis)
      const request = new Request(input, init)
      expect(request.redirect).toBe('manual')
      return Response.json(responses.shift())
    })
    const provider = new CloudflarePublication(
      'a'.repeat(32),
      'test',
      'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/test'
    )
    expect(await provider.activeVersion()).toBe('active')
    expect(await provider.requestBuild()).toBe('11111111-1111-4111-8111-111111111111')
    expect(await new Github().releases('cfgate/cfgate')).toEqual([])
    expect(responses).toHaveLength(0)
  })
})

describe('provider redirect rejection', () => {
  it('rejects redirect responses without following their destination', async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json(
        { success: false, result: null },
        { status: 302, headers: { Location: 'https://unrelated.example/' } }
      )
    )
    const publication = new CloudflarePublication('a'.repeat(32), 'test', '', transport)
    await expect(publication.activeVersion()).rejects.toThrow('302')
    await expect(new Github('test', transport).releases('cfgate/cfgate')).rejects.toThrow('302')
    expect(transport).toHaveBeenCalledTimes(2)
    for (const [, init] of transport.mock.calls) expect(init?.redirect).toBe('manual')
  })
})
