import { describe, it, expect } from 'vitest'
import bootstrap from '../../docs/bootstrap.json'
import { targetSchema } from '../../src/docs/contracts'
import { normalizeMarkdown } from '../../scripts/docs/markdown'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { preserveHeadingIds } from '../../docs/integration/headings'
import { validateExamples } from '../../scripts/docs/examples'
import { schemaReference } from '../../scripts/docs/reference'
const target = targetSchema.parse(bootstrap)
describe('source-aware Markdown', () => {
  it('rewrites AST links and references, preserves snippets, and pins external source links', () => {
    const source =
      '# Example\n\n[Policy](cloudflare-access-policy.md#tokens)\n\n[Code][source]\n\n[source]: ../api/v1alpha1/types.go\n\n```md\n[x](untouched.md)\n```\n'
    const result = normalizeMarkdown(
      source,
      'docs/example.md',
      target.operatorSource,
      target,
      new Map([['docs/cloudflare-access-policy.md', 'reference/cloudflare-access-policy']]),
      new Map()
    )
    expect(result.title).toBe('Example')
    expect(result.markdown).toContain('/docs/reference/cloudflare-access-policy/#tokens')
    expect(result.markdown).toContain(`${target.operatorSource.commit}/api/v1alpha1/types.go`)
    expect(result.markdown).toContain('[x](untouched.md)')
    expect(result.markdown).toContain('id="example"')
    expect(result.markdown).not.toContain('# Example')
  })
  it('omits live repository badges without removing article images', () => {
    const result = normalizeMarkdown(
      '# Release\n\n[![Latest](https://img.shields.io/github/v/release/cfgate/cfgate)](https://github.com/cfgate/cfgate/releases/latest)\n\n![Diagram](https://example.com/diagram.svg)',
      'README.md',
      target.operatorSource,
      target,
      new Map(),
      new Map()
    )
    expect(result.markdown).not.toContain('shields.io')
    expect(result.markdown).toContain('example.com/diagram.svg')
  })
  it('preserves anchors when the promoted page title is repeated below', async () => {
    const content = normalizeMarkdown(
      '# Example\n\n## Example\n\n## Example',
      'docs/x.md',
      target.operatorSource,
      target,
      new Map(),
      new Map()
    )
    const processor = unified().use(remarkParse).use(preserveHeadingIds)
    const tree = await processor.run(processor.parse(content.markdown))
    const headings = tree.children.filter((node) => node.type === 'heading')
    expect(
      headings.map((node) => (node.data as { hProperties?: { id?: string } })?.hProperties?.id)
    ).toEqual(['example-1', 'example-2'])
  })
  it('rejects a missing Markdown page instead of hiding it behind a source link', () => {
    expect(() =>
      normalizeMarkdown(
        '# X\n\n[Missing](missing.md)',
        'docs/x.md',
        target.operatorSource,
        target,
        new Map(),
        new Map()
      )
    ).toThrow('Missing documentation page')
  })
  it('allows an intentionally unlisted Markdown file only when the pinned tree contains it', () => {
    const result = normalizeMarkdown(
      '# X\n\n[Changes](CHANGELOG.md)',
      'README.md',
      target.operatorSource,
      target,
      new Map(),
      new Map(),
      new Set(['CHANGELOG.md'])
    )
    expect(result.markdown).toContain(`${target.operatorSource.commit}/CHANGELOG.md`)
  })
  it('rejects unknown cfgate example identities while allowing other Kubernetes resources', () => {
    const schema = `spec:
  group: cfgate.io
  names: {kind: CloudflareTunnel}
  versions:
    - name: v1alpha1
      schema:
        openAPIV3Schema: {type: object}
`
    for (const [apiVersion, kind] of [
      ['cfgate.io/v99', 'CloudflareTunnel'],
      ['cfgate.io/v1alpha1', 'CloudflareTunnell'],
      ['cfgat.io/v1alpha1', 'CloudflareTunnel'],
    ]) {
      expect(() =>
        validateExamples(
          new Map([
            ['config/crd/bases/tunnels.yaml', schema],
            ['examples/basic/tunnel.yaml', `apiVersion: ${apiVersion}\nkind: ${kind}`],
          ])
        )
      ).toThrow('Unknown cfgate resource identity')
    }
    expect(
      validateExamples(
        new Map([
          ['config/crd/bases/tunnels.yaml', schema],
          [
            'examples/basic/resources.yaml',
            'apiVersion: v1\nkind: Service\n---\napiVersion: external.example.com/v1\nkind: CloudflareRecord\n---\napiVersion: cfgate.io/v1alpha1\nkind: CloudflareTunnel',
          ],
        ])
      )
    ).toBe(1)
  })
  it('isolates historical fixture links by logical page identity', () => {
    const historical = targetSchema.parse({
      ...target,
      id: 'old',
      channel: 'version',
      mount: target.operatorVersion,
    })
    const result = normalizeMarkdown(
      '# Old\n\n[DNS](cloudflare-dns.md)',
      'docs/example.md',
      target.operatorSource,
      historical,
      new Map([['docs/cloudflare-dns.md', 'reference/cloudflare-dns']]),
      new Map()
    )
    expect(result.markdown).toContain(`/docs/${target.operatorVersion}/reference/cloudflare-dns/`)
  })
  it('does not execute imported HTML or accept script links', () => {
    const result = normalizeMarkdown(
      '# X\n\n<script>alert(1)</script>',
      'docs/x.md',
      target.operatorSource,
      target,
      new Map(),
      new Map()
    )
    expect(result.markdown).not.toContain('script')
    expect(() =>
      normalizeMarkdown(
        '# X\n\n[x](javascript:alert)',
        'docs/x.md',
        target.operatorSource,
        target,
        new Map(),
        new Map()
      )
    ).toThrow('scheme')
  })
  it('renders required arrays, maps, schema defaults, nullable fields and CEL separately', () => {
    const yaml = `kind: CustomResourceDefinition\nspec:\n  names: {kind: Widget, plural: widgets}\n  versions:\n    - name: v1\n      served: true\n      schema:\n        openAPIV3Schema:\n          type: object\n          required: [spec]\n          properties:\n            spec:\n              type: object\n              properties:\n                names:\n                  type: array\n                  items: {type: string, nullable: true, default: item}\n                labels:\n                  type: object\n                  additionalProperties: {type: string}\n                  x-kubernetes-validations:\n                    - rule: self.size() < 4\n`
    const result = schemaReference(yaml)[0].markdown
    expect(result).toContain('`spec` | object | yes')
    expect(result).toContain('`spec.names[]`')
    expect(result).toContain('accepts null')
    expect(result).toContain('`spec.labels[key]`')
    expect(result).toContain('self.size() < 4')
  })
})

describe('selective prepared editions', () => {
  it('prepares two pinned fixtures without generating next or retaining source snapshots', async () => {
    const { mkdtemp, mkdir, writeFile, readFile, readdir, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { vi } = await import('vitest')
    const { prepare } = await import('../../scripts/docs/prepare')
    const { Github } = await import('../../src/docs/github')
    const { makePlan, digest } = await import('../../src/docs/contracts')
    const { docsPolicy } = await import('../../src/docs/policy')
    const root = await mkdtemp(join(tmpdir(), 'cfgate-docs-'))
    try {
      await mkdir(join(root, 'public'))
      await writeFile(join(root, 'public/favicon.svg'), '<svg/>')
      const github = new Github()
      vi.spyOn(github, 'get').mockImplementation(async (path) =>
        path.includes('/git/trees/')
          ? {
              truncated: false,
              tree: [{ path: 'README.md', mode: '100644', type: 'blob', size: 20 }],
            }
          : { assets: [] }
      )
      vi.spyOn(github, 'text').mockImplementation(
        async (source) => `# ${source.ref}\n\nPinned fixture.\n`
      )
      const { chartSource: _chartSource, chartVersion: _chartVersion, ...base } = target
      const old = targetSchema.parse({
        ...base,
        id: 'old',
        channel: 'version',
        mount: 'v0.1.0',
        operatorVersion: 'v0.1.0',
        operatorSource: { ...base.operatorSource, commit: 'a'.repeat(40), ref: 'v0.1.0' },
        documentationSource: { ...base.documentationSource, commit: 'a'.repeat(40), ref: 'v0.1.0' },
      })
      const manifest = await prepare(
        await makePlan('b'.repeat(40), await digest(docsPolicy), [base, old]),
        github,
        root
      )
      expect(manifest.pages.map((p) => p.route)).toEqual(['/docs/', '/docs/v0.1.0/'])
      expect(await readFile(join(root, 'docs/src/content/docs/v0.1.0/index.md'), 'utf8')).toContain(
        'v0.1.0'
      )
      expect(await readdir(join(root, 'docs/src/content/docs'))).toEqual(['index.md', 'v0.1.0'])
      expect(await readdir(root)).not.toContain('sources')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
