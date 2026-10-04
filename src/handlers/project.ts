import type { Context } from 'hono'
import type { AppEnv } from '@/types'
import { loadProjectData } from '@/lib/project'

let refresh: Promise<string> | undefined
const responseHeaders = {
  'Content-Type': 'application/json',
  // Revalidate each page visit; the Worker cache owns the refresh interval.
  'Cache-Control': 'no-cache',
}

export async function projectHandler(c: Context<AppEnv>): Promise<Response> {
  c.var.logCtx.handler = 'project'
  // A fixed key prevents query strings from multiplying upstream requests.
  const key = new Request('https://cfgate.io/api/project')
  const cache = await caches.open('project-v1')
  const cached = await cache.match(key)
  if (cached) return new Response(cached.body, { headers: responseHeaders })
  // Coalesce misses within this isolate, including the cache-write window.
  refresh ??= (async () => {
    const data = await loadProjectData()
    const body = JSON.stringify(data)
    try {
      await cache.put(
        key,
        new Response(body, {
          headers: { ...responseHeaders, 'Cache-Control': 'public, max-age=1800' },
        })
      )
    } catch {
      // Cache availability must not prevent serving the fetched response.
    }
    return body
  })().finally(() => {
    refresh = undefined
  })
  // Worker response streams belong to their request; only plain data can be shared.
  return new Response(await refresh, { headers: responseHeaders })
}
