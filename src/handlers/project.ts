import type { Context } from 'hono'
import type { AppEnv } from '@/types'
import { loadProjectData } from '@/lib/project'

export async function projectHandler(c: Context<AppEnv>): Promise<Response> {
  c.var.logCtx.handler = 'project'
  // A fixed key prevents query strings from multiplying upstream requests.
  const key = new Request('https://cfgate.io/api/project')
  const cache = await caches.open('project-v1')
  const cached = await cache.match(key)
  if (cached) return cached
  const data = await loadProjectData()
  const response = Response.json(data, {
    headers: { 'Cache-Control': 'public, max-age=1800' },
  })
  c.executionCtx.waitUntil(
    cache.put(key, response.clone()).catch(() => {
      // Cache availability must not prevent serving the fetched response.
    })
  )
  return response
}
