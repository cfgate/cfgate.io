import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import linksValidator from 'starlight-links-validator'
import githubAlerts from 'starlight-github-alerts'
import { cfgateDocs } from './integration'
import { preserveHeadingIds } from './integration/headings'

const manifest = JSON.parse(
  readFileSync(new URL('../.generated/docs-manifest.json', import.meta.url), 'utf8')
)
export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  site: 'https://cfgate.io',
  base: '/docs',
  trailingSlash: 'always',
  output: 'static',
  markdown: { remarkPlugins: [preserveHeadingIds] },
  outDir: fileURLToPath(new URL('../.build/docs', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../.build/docs-cache', import.meta.url)),
  integrations: [
    starlight({
      title: 'cfgate',
      description: 'Released cfgate documentation',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/cfgate/cfgate' }],
      defaultLocale: 'root',
      locales: { root: { label: 'English', lang: 'en' } },
      customCss: ['./src/styles/docs.css'],
      lastUpdated: false,
      plugins: [cfgateDocs(manifest), githubAlerts(), linksValidator()],
    }),
  ],
})
