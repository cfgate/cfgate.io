import { cp, readFile, access, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { DocsManifest } from '../../src/docs/contracts.js'

const manifest: DocsManifest = JSON.parse(await readFile('.generated/docs-manifest.json', 'utf8'))
await cp('.build/docs', 'dist/docs', { recursive: true })
for (const page of manifest.pages) await access(resolve('dist', `.${page.route}`, 'index.html'))
for (const target of manifest.targets) {
  if (target.channel !== 'latest') continue
  for (const forbidden of ['next', target.operatorVersion]) {
    if (
      !manifest.targets.some((t) => t.mount === forbidden) &&
      (await readdir('dist/docs')).includes(forbidden)
    )
      throw new Error(`Unexpected edition: ${forbidden}`)
  }
}
for (const page of [
  'dist/index.html',
  'dist/project/index.html',
  'dist/releases/index.html',
  'dist/docs/manifest.json',
])
  await access(page)
console.log(`Assembled ${manifest.pages.length} documentation pages alongside the website`)
