import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { DocsManifest } from '../../src/docs/contracts.js'

export async function outputDigest(): Promise<string> {
  const hash = createHash('sha256')
  async function walk(path: string) {
    for (const name of (await readdir(path, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const file = join(path, name.name)
      if (name.isDirectory()) await walk(file)
      else if (name.isFile()) {
        hash.update(file)
        hash.update(await readFile(file))
      } else throw new Error('Unexpected output file type')
    }
  }
  await walk('dist')
  return hash.digest('hex')
}
export async function validateOutput(): Promise<void> {
  const manifest: DocsManifest = JSON.parse(await readFile('dist/docs/manifest.json', 'utf8'))
  const routes = new Set(manifest.pages.map((page) => page.route))
  for (const page of manifest.pages) {
    const html = await readFile(`dist${page.route}index.html`, 'utf8')
    if (!html.includes(manifest.targets.find((t) => t.id === page.targetId)!.operatorVersion))
      throw new Error(`Missing edition identity: ${page.route}`)
    for (const link of html.matchAll(/(?:href|src)="(\/docs\/[^"?#]*)(?:[?#][^"]*)?"/g)) {
      const target = link[1]
      if (target.endsWith('/') && !routes.has(target))
        throw new Error(`Unexpected docs destination: ${target}`)
      if (!target.endsWith('/')) await readFile(`dist${decodeURI(target)}`)
    }
  }
  await writeFile(
    '.generated/validated.json',
    JSON.stringify({ buildKey: manifest.buildKey, outputDigest: await outputDigest() })
  )
}
