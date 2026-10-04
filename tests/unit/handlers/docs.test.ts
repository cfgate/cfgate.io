import { describe, it, expect, vi } from 'vitest'
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import app from '../../../src/index'
import { secretMatches } from '../../../src/handlers/docs'

const delivery = '11111111-1111-4111-8111-111111111111'
const secret = 'test-webhook-secret'
async function signature(body: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return (
    'sha256=' +
    [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  )
}
function bindings() {
  const fetcher = vi.fn(async () => Response.json({ accepted: true }, { status: 202 }))
  return {
    fetcher,
    env: {
      ENVIRONMENT: 'production' as const,
      GITHUB_WEBHOOK_SECRET: secret,
      DOCS_BUILDER_TOKEN: 'builder',
      DOCS_ADMIN_TOKEN: 'admin',
      PROJECT_COORDINATOR: {
        idFromName: () => 'id',
        get: () => ({ fetch: fetcher }),
      } as unknown as DurableObjectNamespace,
    },
  }
}
describe('documentation request boundaries', () => {
  it('accepts a verified release notification only after durable acknowledgement', async () => {
    const { env, fetcher } = bindings()
    const body = JSON.stringify({ action: 'published', repository: { full_name: 'cfgate/cfgate' } })
    const response = await app.request(
      'https://cfgate.io/api/hooks/github',
      {
        method: 'POST',
        body,
        headers: {
          'X-Hub-Signature-256': await signature(body),
          'X-GitHub-Delivery': delivery,
          'X-GitHub-Event': 'release',
        },
      },
      env
    )
    expect(response.status).toBe(202)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('rejects altered payloads, unexpected repositories and unsigned traffic', async () => {
    for (const repo of ['cfgate/cfgate', 'someone/else']) {
      const { env, fetcher } = bindings()
      const body = JSON.stringify({ action: 'published', repository: { full_name: repo } })
      const response = await app.request(
        'https://cfgate.io/api/hooks/github',
        {
          method: 'POST',
          body,
          headers: {
            'X-Hub-Signature-256': await signature(repo === 'cfgate/cfgate' ? body + ' ' : body),
            'X-GitHub-Delivery': delivery,
            'X-GitHub-Event': 'release',
          },
        },
        env
      )
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(fetcher).not.toHaveBeenCalled()
    }
  })
  it('ignores product branch pushes and validates body bounds', async () => {
    const { env, fetcher } = bindings()
    const body = JSON.stringify({ repository: { full_name: 'cfgate/cfgate' } })
    const response = await app.request(
      'https://cfgate.io/api/hooks/github',
      {
        method: 'POST',
        body,
        headers: {
          'X-Hub-Signature-256': await signature(body),
          'X-GitHub-Delivery': delivery,
          'X-GitHub-Event': 'push',
        },
      },
      env
    )
    expect(response.status).toBe(202)
    expect(fetcher).not.toHaveBeenCalled()
    const oversized = await app.request(
      'https://cfgate.io/api/hooks/github',
      {
        method: 'POST',
        body: 'x'.repeat(65537),
        headers: { 'X-Hub-Signature-256': 'sha256=' + 'a'.repeat(64) },
      },
      env
    )
    expect(oversized.status).toBe(400)
  })
  it('separates admin credentials from builder credentials and disallows preview writes', async () => {
    const { env, fetcher } = bindings()
    for (const url of [
      'https://cfgate.io/internal/docs/reconcile',
      'https://preview.example/internal/docs/builds/claim',
    ]) {
      const response = await app.request(
        url,
        { method: 'POST', body: '{}', headers: { Authorization: 'Bearer builder' } },
        env
      )
      expect([401, 403]).toContain(response.status)
    }
    expect(fetcher).not.toHaveBeenCalled()
    expect(await secretMatches('', '')).toBe(false)
  })
  it('does not cache deployed documentation identity with observed project data', async () => {
    const { env } = bindings()
    let servedVersion = 'v1.0.0'
    const project = { documentation: { observedLatest: 'v2.0.0', state: 'building' } }
    env.PROJECT_COORDINATOR = {
      idFromName: () => 'id',
      get: () => ({ fetch: async () => Response.json(project) }),
    } as unknown as DurableObjectNamespace
    const assets = {
      fetch: async () =>
        Response.json({
          buildKey: servedVersion,
          targets: [{ channel: 'latest', operatorVersion: servedVersion }],
        }),
    } as unknown as Fetcher
    for (const version of ['v1.0.0', 'v2.0.0']) {
      servedVersion = version
      const ctx = createExecutionContext()
      const response = await app.request(
        'https://cfgate.io/api/project',
        {},
        { ...env, ASSETS: assets },
        ctx
      )
      expect(
        ((await response.json()) as typeof project & { documentation: { servedVersion: string } })
          .documentation.servedVersion
      ).toBe(version)
      expect(response.headers.get('Cache-Control')).toBe('no-cache')
      await waitOnExecutionContext(ctx)
    }
  })
  it('returns a real 404 for unpublished documentation editions', async () => {
    const response = await app.request('https://cfgate.io/docs/v0.1.0/does-not-exist/', {}, {})
    expect(response.status).toBe(404)
    expect(await response.text()).toContain('Documentation not published')
  })
})
