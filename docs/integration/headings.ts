import { visit } from 'unist-util-visit'
import { toString } from 'mdast-util-to-string'
import GithubSlugger from 'github-slugger'
import type { Root } from 'mdast'
import type { Plugin } from 'unified'

// The promoted H1 still participates in GitHub's duplicate-heading anchor sequence.
export const preserveHeadingIds: Plugin<[], Root> = () => {
  return (tree: Root) => {
    const slugger = new GithubSlugger()
    visit(tree, (node) => {
      if (node.type === 'html') {
        const title = /^<span id="([^"]+)">(?:<\/span>)?$/.exec(node.value)
        if (title) slugger.slug(title[1])
      }
      if (node.type === 'heading') {
        node.data ??= {}
        const data = node.data as { hProperties?: Record<string, unknown> }
        data.hProperties = { ...data.hProperties, id: slugger.slug(toString(node)) }
      }
    })
  }
}
