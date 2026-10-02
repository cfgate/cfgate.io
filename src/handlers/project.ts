import type { Context } from 'hono'
import type { AppEnv } from '@/types'
import { loadProjectData } from '@/lib/project'

let refresh: Promise<Response> | undefined

export async function projectHandler(c: Context<AppEnv>): Promise<Response> {
  c.var.logCtx.handler = 'project'
  // A fixed key prevents query strings from multiplying upstream requests.
  const key = new Request('https://cfgate.io/api/project')
  const cache = await caches.open('project-v1')
  const cached = await cache.match(key)
  if (cached) return cached
  // Coalesce misses within this isolate, including the cache-write window.
  refresh ??= (async () => {
    const data = await loadProjectData()
    const response = Response.json(data, {
      headers: { 'Cache-Control': 'public, max-age=1800' },
    })
    try {
      await cache.put(key, response.clone())
    } catch {
      // Cache availability must not prevent serving the fetched response.
    }
    return response
  })().finally(() => {
    refresh = undefined
  })
  return (await refresh).clone()
}
