import { defineRouteMiddleware, type StarlightRouteData } from '@astrojs/starlight/route-data'
import manifest from '../../.generated/docs-manifest.json'

export const onRequest = defineRouteMiddleware((context) => {
  const data = context.locals.starlightRoute
  const page = manifest.pages.find((page) => page.route === context.url.pathname)
  if (!page) return
  const allowed = new Set(
    manifest.pages.filter((p) => p.targetId === page.targetId).map((p) => p.route)
  )
  type Entry = StarlightRouteData['sidebar'][number]
  function filter(entries: Entry[]): Entry[] {
    return entries.flatMap((entry): Entry[] => {
      if (entry.type === 'link') return allowed.has(entry.href) ? [entry] : []
      const entries = filter(entry.entries)
      return entries.length ? [{ ...entry, entries }] : []
    })
  }
  data.sidebar = filter(data.sidebar)
  for (const side of ['prev', 'next'] as const)
    if (data.pagination[side] && !allowed.has(data.pagination[side]!.href))
      data.pagination[side] = undefined
})
