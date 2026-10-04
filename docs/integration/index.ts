import type { StarlightPlugin } from '@astrojs/starlight/types'
import type { DocsManifest } from '../../src/docs/contracts'
import { groups } from '../navigation'

export function cfgateDocs(manifest: DocsManifest): StarlightPlugin {
  return {
    name: 'cfgate-docs',
    hooks: {
      'config:setup'({ updateConfig, addRouteMiddleware }) {
        const sidebar = manifest.targets.flatMap((target) =>
          groups
            .map(([label, prefixes]) => ({
              label: manifest.targets.length > 1 ? `${target.operatorVersion}: ${label}` : label,
              items: manifest.pages
                .filter(
                  (page) =>
                    page.targetId === target.id &&
                    prefixes.some((p) =>
                      p.endsWith('/') ? page.docId.startsWith(p) : page.docId === p
                    )
                )
                .map((page) => ({ label: page.title, link: page.route.replace(/^\/docs/, '') })),
            }))
            .filter((group) => group.items.length)
        )
        const assigned = new Set(sidebar.flatMap((group) => group.items.map((page) => page.link)))
        if (manifest.pages.some((page) => !assigned.has(page.route.replace(/^\/docs/, ''))))
          throw new Error('Documentation page missing from navigation')
        addRouteMiddleware({ entrypoint: './integration/middleware.ts' })
        updateConfig({
          sidebar,
          components: {
            PageTitle: './components/PageTitle.astro',
            EditLink: './components/Source.astro',
          },
        })
      },
    },
  }
}
