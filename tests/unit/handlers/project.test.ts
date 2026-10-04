import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../../src/index'
import { projectSnapshot } from '../../../src/lib/project'
const key = 'https://cfgate.io/api/project'
beforeEach(async () => {
  await (await caches.open('project-v1')).delete(key)
})
afterEach(() => vi.unstubAllGlobals())

describe('project endpoint cache', () => {
  it('shares one refresh across simultaneous cache misses and permits later refreshes', async () => {
    let release: () => void = () => {
      /* replaced by the promise executor */
    }
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetcher = vi.fn<typeof fetch>(async () => {
      await gate
      return new Response(null, { status: 429 })
    })
    vi.stubGlobal('fetch', fetcher)
    const firstContext = createExecutionContext()
    const secondContext = createExecutionContext()
    const first = app.request(`${key}?first=1`, {}, {}, firstContext)
    const second = app.request(`${key}?second=2`, {}, {}, secondContext)
    await vi.waitFor(() => expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(3))
    release()
    const responses = await Promise.all([first, second])
    await Promise.all([waitOnExecutionContext(firstContext), waitOnExecutionContext(secondContext)])
    expect(fetcher).toHaveBeenCalledTimes(3)
    for (const response of responses) expect(await response.json()).toEqual(projectSnapshot)

    await (await caches.open('project-v1')).delete(key)
    const nextContext = createExecutionContext()
    const next = await app.request(key, {}, {}, nextContext)
    await waitOnExecutionContext(nextContext)
    expect(await next.json()).toEqual(projectSnapshot)
    expect(fetcher).toHaveBeenCalledTimes(6)
  })

  it('reads preview edition identity from assets even when metadata is cached', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429 }))
    vi.stubGlobal('fetch', fetcher)
    let version = 'v1.0.0'
    const env = {
      ASSETS: {
        fetch: async () =>
          Response.json({
            buildKey: version,
            targets: [{ channel: 'latest', operatorVersion: version }],
          }),
      } as unknown as Fetcher,
    }
    for (const current of ['v1.0.0', 'v1.1.0']) {
      version = current
      const response = await app.request(key, {}, env, createExecutionContext())
      expect(
        ((await response.json()) as { documentation: { servedVersion: string } }).documentation
          .servedVersion
      ).toBe(current)
    }
    expect(fetcher).toHaveBeenCalledTimes(3)
    const cached = await (await caches.open('project-v1')).match(key)
    expect(await cached?.json()).not.toHaveProperty('documentation')
  })

  it('caches fallback responses and ignores query strings in the cache key', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429 }))
    vi.stubGlobal('fetch', fetcher)
    const ctx = createExecutionContext()
    const first = await app.request(`${key}?first=1`, {}, {}, ctx)
    expect(first.status).toBe(200)
    expect(first.headers.get('Cache-Control')).toBe('no-cache')
    expect(first.headers.get('X-Request-Id')).toBeTruthy()
    expect(await first.json()).toEqual(projectSnapshot)
    await waitOnExecutionContext(ctx)
    expect(fetcher).toHaveBeenCalledTimes(3)
    const next = await app.request(`${key}?second=2`, {}, {}, createExecutionContext())
    expect(next.status).toBe(200)
    expect(next.headers.get('Cache-Control')).toBe('no-cache')
    expect(next.headers.get('X-Request-Id')).toBeTruthy()
    expect(next.headers.get('X-Request-Id')).not.toBe(first.headers.get('X-Request-Id'))
    expect(await next.json()).toEqual(projectSnapshot)
    const stored = await (await caches.open('project-v1')).match(key)
    expect(stored?.headers.get('Cache-Control')).toBe('public, max-age=1800')
    expect(stored?.headers.has('X-Request-Id')).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
})
