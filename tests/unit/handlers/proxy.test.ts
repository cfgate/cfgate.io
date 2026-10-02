import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { proxyHandler } from '../../../src/handlers/proxy.js'
import { loggerMiddleware } from '../../../src/middleware/logger.js'
import type { AppEnv } from '../../../src/types.js'

const app = new Hono<AppEnv>()
app.use('*', loggerMiddleware)
app.get('*', proxyHandler)

afterEach(() => vi.unstubAllGlobals())

describe('release artifact proxy', () => {
  it.each([
    ['/install.yaml', 'install.yaml'],
    ['/crds.yaml', 'crds.yaml'],
    ['/crds/tunnel.yaml', 'cloudflaretunnels.yaml'],
    ['/crds/dns.yaml', 'cloudflarednses.yaml'],
    ['/crds/access.yaml', 'cloudflareaccesspolicies.yaml'],
    ['/crds/access-application.yaml', 'cloudflareaccessapplications.yaml'],
  ])('maps %s to a published release asset', async (path, asset) => {
    const fetch = vi.fn().mockResolvedValue(new Response('kind: CustomResourceDefinition'))
    vi.stubGlobal('fetch', fetch)
    const response = await app.request(path)
    expect(fetch).toHaveBeenCalledWith(
      `https://github.com/cfgate/cfgate/releases/latest/download/${asset}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/yaml')
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe(
      'kind: CustomResourceDefinition'
    )
  })

  it.each([
    [404, 404],
    [403, 503],
    [500, 503],
  ])('maps upstream %s to %s', async (upstream, expected) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: upstream })))
    expect((await app.request('/install.yaml')).status).toBe(expected)
  })

  it('does not fetch unrecognized paths', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect((await app.request('/other.yaml')).status).toBe(404)
    expect(fetch).not.toHaveBeenCalled()
  })
})
