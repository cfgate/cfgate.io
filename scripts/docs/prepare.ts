import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { stringify, parseAllDocuments } from 'yaml'
import { validateExamples } from './examples.js'
import { Github, safePath, boundedText } from '../../src/docs/github.js'
import {
  digest,
  makePlan,
  targetSchema,
  validatePlan,
  docRoute,
  type DocsBuildPlan,
  type DocsManifest,
  type SourcePin,
} from '../../src/docs/contracts.js'
import { docsPolicy } from '../../src/docs/policy.js'
import { documentIds } from '../../docs/navigation.js'
import { normalizeMarkdown } from './markdown.js'
import { schemaReference, helmReference } from './reference.js'

const treeSchema = z.object({
  truncated: z.boolean(),
  tree: z.array(
    z.object({ path: z.string(), mode: z.string(), type: z.string(), size: z.number().optional() })
  ),
})
export async function sourceFiles(
  github: Github,
  source: SourcePin,
  inventory = new Set<string>()
): Promise<Map<string, string>> {
  const tree = treeSchema.parse(
    await github.get(`/repos/${source.repository}/git/trees/${source.commit}?recursive=1`)
  )
  if (tree.truncated) throw new Error('Incomplete source tree')
  for (const entry of tree.tree)
    if (entry.type === 'blob' && entry.mode === '100644') inventory.add(entry.path)
  const entries = tree.tree.filter((e) =>
    source.repository === 'cfgate/helm-chart'
      ? ['Chart.yaml', 'values.yaml', 'README.md'].includes(e.path)
      : ['README.md', 'CONTRIBUTING.md'].includes(e.path) ||
        /^(docs\/.*\.(md|svg)|examples\/.*\.(md|yaml)|config\/crd\/bases\/.*\.yaml)$/.test(e.path)
  )
  if (entries.length > 180 || entries.reduce((sum, e) => sum + (e.size ?? 0), 0) > 16 * 1024 * 1024)
    throw new Error('Source inventory too large')
  const files = new Map<string, string>()
  for (let offset = 0; offset < entries.length; offset += 6) {
    const batch = await Promise.all(
      entries.slice(offset, offset + 6).map(async (e) => {
        safePath(e.path)
        if (e.mode !== '100644' || e.type !== 'blob')
          throw new Error(`Non-regular source file: ${e.path}`)
        return [e.path, await github.text(source, e.path)] as const
      })
    )
    for (const [path, content] of batch) files.set(path, content)
  }
  return new Map([...files].sort(([a], [b]) => a.localeCompare(b)))
}
async function output(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}
export async function prepare(
  plan: DocsBuildPlan,
  github: Github,
  root = process.cwd()
): Promise<DocsManifest> {
  await validatePlan(plan)
  if (plan.policyDigest !== (await digest(docsPolicy)))
    throw new Error('Build policy differs from coordinator; deploy policy migration first')
  const manifest: DocsManifest = { ...plan, builtAt: new Date().toISOString(), pages: [] }
  const contentRoot = resolve(root, 'docs/src/content/docs')
  const publicRoot = resolve(root, 'docs/public')
  await rm(contentRoot, { recursive: true, force: true })
  await rm(publicRoot, { recursive: true, force: true })
  await mkdir(contentRoot, { recursive: true })
  await mkdir(publicRoot, { recursive: true })
  await output(
    `${publicRoot}/favicon.svg`,
    await readFile(resolve(root, 'public/favicon.svg'), 'utf8')
  )
  for (const target of plan.targets) {
    const inventory = new Set<string>()
    const files = await sourceFiles(github, target.documentationSource, inventory)
    const catalog = new Map<string, string>()
    for (const path of files.keys())
      if (path.endsWith('.md')) {
        if (!(path in documentIds))
          throw new Error(`Assign navigation or exclude new document explicitly: ${path}`)
        catalog.set(path, documentIds[path])
      }
    const assets = new Map<string, string>()
    for (const [path, contents] of files)
      if (path.endsWith('.svg')) {
        if (
          /<(?:script|foreignObject)\b|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|javascript:)/i.test(
            contents
          )
        )
          throw new Error(`Unsafe SVG: ${path}`)
        const name = `${await digest(contents)}.svg`
        assets.set(path, `/docs/source-assets/${name}`)
        await output(`${publicRoot}/source-assets/${name}`, contents)
      }
    const add = async (
      docId: string,
      title: string,
      markdown: string,
      source: SourcePin,
      path: string,
      generated = false
    ) => {
      const route = docRoute(target, docId)
      const pageSource = { repository: source.repository, commit: source.commit, path }
      const page = {
        docId,
        targetId: target.id,
        locale: target.locale,
        route,
        title,
        source: pageSource,
        ...(generated ? { generatedFrom: [pageSource] } : {}),
      }
      manifest.pages.push(page)
      const frontmatter = stringify({
        title,
        slug: [target.mount, docId].filter(Boolean).join('/') || '',
        editUrl: false,
        cfgate: { ...page, version: target.operatorVersion },
      })
      await output(
        `${contentRoot}/${[target.mount, docId || 'index'].filter(Boolean).join('/')}.md`,
        `---\n${frontmatter}---\n\n${markdown}`
      )
    }
    for (const [path, docId] of catalog) {
      const normalized = normalizeMarkdown(
        files.get(path)!,
        path,
        target.documentationSource,
        target,
        catalog,
        assets,
        inventory
      )
      await add(docId, normalized.title, normalized.markdown, target.documentationSource, path)
    }
    // Schemas and examples always come from the software revision, even with a prose-only override.
    const product =
      target.operatorSource.commit === target.documentationSource.commit
        ? files
        : await sourceFiles(github, target.operatorSource)
    const checked = validateExamples(product)
    console.log(`Validated ${checked} complete cfgate examples against released schemas`)
    const release = (
      target.channel === 'next'
        ? {}
        : await github.get(
            `/repos/${target.operatorSource.repository}/releases/tags/${encodeURIComponent(target.operatorSource.ref)}`
          )
    ) as { assets?: { name: string }[] }
    if (release.assets?.some((asset) => asset.name === 'crds.yaml')) {
      const response = await fetch(
        `https://github.com/${target.operatorSource.repository}/releases/download/${encodeURIComponent(target.operatorSource.ref)}/crds.yaml`,
        { signal: AbortSignal.timeout(20000) }
      )
      if (!response.ok) throw new Error(`Released schemas returned ${response.status}`)
      const released = parseAllDocuments(await boundedText(response, 6 * 1024 * 1024)).map(
        (document) => document.toJS()
      )
      for (const [path, yaml] of product)
        if (path.startsWith('config/crd/bases/')) {
          const source = parseAllDocuments(yaml)[0].toJS()
          const asset = released.find((crd) => crd.metadata?.name === source.metadata.name)
          if (!asset || (await digest(asset.spec)) !== (await digest(source.spec)))
            throw new Error(`Released schema asset differs from pinned source: ${path}`)
        }
    }
    for (const [path, yaml] of product)
      if (path.startsWith('config/crd/bases/')) {
        for (const reference of schemaReference(yaml))
          await add(
            `schemas/${reference.name}`,
            reference.title,
            reference.markdown,
            target.operatorSource,
            path,
            true
          )
      }
    if (target.chartSource) {
      const chartInventory = new Set<string>()
      const chart = await sourceFiles(github, target.chartSource, chartInventory)
      const { parse } = await import('yaml')
      const metadata = parse(chart.get('Chart.yaml')!)
      const { valid } = await import('semver')
      if (
        valid(metadata.appVersion) !== valid(target.operatorVersion) ||
        valid(metadata.version) !== valid(target.chartVersion)
      )
        throw new Error('Pinned chart does not match target')
      await add(
        'helm/values',
        `Helm ${target.chartVersion} values`,
        helmReference(chart.get('values.yaml')!),
        target.chartSource,
        'values.yaml',
        true
      )
      const helmDocs = normalizeMarkdown(
        chart.get('README.md')!,
        'README.md',
        target.chartSource,
        target,
        new Map(),
        new Map(),
        chartInventory
      )
      await add(
        'helm/installation',
        `Helm ${target.chartVersion}`,
        helmDocs.markdown,
        target.chartSource,
        'README.md'
      )
    }
  }
  await output(resolve(root, '.generated/docs-manifest.json'), JSON.stringify(manifest, null, 2))
  await output(`${publicRoot}/manifest.json`, JSON.stringify(manifest, null, 2))
  return manifest
}
export async function localPlan(path?: string): Promise<DocsBuildPlan> {
  if (path) return validatePlan(JSON.parse(await readFile(path, 'utf8')))
  const target = targetSchema.parse(JSON.parse(await readFile('docs/bootstrap.json', 'utf8')))
  const renderer = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  return makePlan(renderer, await digest(docsPolicy), [target])
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const planPath = process.argv.indexOf('--plan')
  const plan = await localPlan(planPath < 0 ? undefined : process.argv[planPath + 1])
  await prepare(plan, new Github(process.env.GITHUB_TOKEN))
  console.log(`Prepared ${plan.targets.length} documentation target(s): ${plan.buildKey}`)
}
