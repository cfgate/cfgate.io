import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { projectHandler } from '../../../src/handlers/project'
import { loggerMiddleware } from '../../../src/middleware/logger'
import { projectSnapshot } from '../../../src/lib/project'
import type { AppEnv } from '../../../src/types'

const app = new Hono<AppEnv>()
app.use('*', loggerMiddleware)
app.get('/api/project', projectHandler)
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

  it('caches fallback responses and ignores query strings in the cache key', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429 }))
    vi.stubGlobal('fetch', fetcher)
    const ctx = createExecutionContext()
    const first = await app.request(`${key}?first=1`, {}, {}, ctx)
    expect(first.status).toBe(200)
    expect(first.headers.get('Cache-Control')).toBe('public, max-age=1800')
    expect(await first.json()).toEqual(projectSnapshot)
    await waitOnExecutionContext(ctx)
    expect(fetcher).toHaveBeenCalledTimes(3)
    const next = await app.request(`${key}?second=2`, {}, {}, createExecutionContext())
    expect(await next.json()).toEqual(projectSnapshot)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
})
