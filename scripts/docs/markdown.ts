import { posix } from 'node:path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkStringify from 'remark-stringify'
import { visit } from 'unist-util-visit'
import { toString } from 'mdast-util-to-string'
import GithubSlugger from 'github-slugger'
import sanitizeHtml from 'sanitize-html'
import type { Root, Heading } from 'mdast'
import type { DocsTarget, SourcePin } from '../../src/docs/contracts.js'
import { docRoute } from '../../src/docs/contracts.js'
import { safePath } from '../../src/docs/github.js'

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkStringify, { fences: true })
export function headingIds(markdown: string): string[] {
  const slugger = new GithubSlugger()
  const ids: string[] = []
  visit(processor.parse(markdown), 'heading', (node) => {
    ids.push(slugger.slug(toString(node)))
  })
  return ids
}
export function normalizeMarkdown(
  markdown: string,
  path: string,
  source: SourcePin,
  target: DocsTarget,
  catalog: Map<string, string>,
  assets: Map<string, string>
): { title: string; markdown: string } {
  const tree = processor.parse(markdown) as Root
  const heading = tree.children.find((n): n is Heading => n.type === 'heading' && n.depth === 1)
  const title = heading ? toString(heading) : posix.basename(path, '.md')
  if (heading) {
    const id = new GithubSlugger().slug(title)
    tree.children.splice(tree.children.indexOf(heading), 1, {
      type: 'html',
      value: `<span id="${id}"></span>`,
    })
  }
  visit(tree, (node) => {
    if (node.type === 'yaml') throw new Error(`Imported frontmatter is not supported: ${path}`)
    if (node.type === 'html') {
      node.value = sanitizeHtml(node.value, {
        allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'details', 'summary', 'span'],
        allowedAttributes: {
          ...sanitizeHtml.defaults.allowedAttributes,
          '*': ['id'],
          img: ['src', 'alt', 'width', 'height'],
        },
      })
    }
    if (node.type !== 'link' && node.type !== 'image' && node.type !== 'definition') return
    const url = node.url
    if (/^(?:https?:|mailto:)/i.test(url)) return
    if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//'))
      throw new Error(`Unsupported link scheme in ${path}`)
    if (!url || url.startsWith('#')) return
    const [pathname, fragment] = url.split('#', 2)
    const decoded = decodeURIComponent(pathname.split('?')[0])
    const resolved = posix.normalize(posix.join(posix.dirname(path), decoded))
    safePath(resolved)
    const suffix = fragment ? `#${fragment}` : ''
    const doc = catalog.get(resolved) ?? catalog.get(`${resolved}/README.md`)
    if (doc !== undefined) node.url = docRoute(target, doc) + suffix
    else if (node.type === 'image') {
      const asset = assets.get(resolved)
      if (!asset) throw new Error(`Missing local image ${resolved}`)
      node.url = asset
    } else
      node.url = `https://github.com/${source.repository}/blob/${source.commit}/${resolved}${suffix}`
  })
  return { title, markdown: processor.stringify(tree) }
}
