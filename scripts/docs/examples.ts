import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { parseAllDocuments } from 'yaml'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { visit } from 'unist-util-visit'

export function validateExamples(files: Map<string, string>): number {
  const ajv = new Ajv({ strict: false, allErrors: true, useDefaults: true })
  addFormats(ajv)
  const schemas = new Map()
  const groups = new Set<string>()
  const kinds = new Set<string>()
  for (const [path, contents] of files)
    if (path.startsWith('config/crd/bases/')) {
      const crd = parseAllDocuments(contents)[0].toJS()
      groups.add(crd.spec.group)
      kinds.add(crd.spec.names.kind)
      for (const version of crd.spec.versions)
        schemas.set(
          `${crd.spec.group}/${version.name}:${crd.spec.names.kind}`,
          ajv.compile(version.schema.openAPIV3Schema)
        )
    }
  let checked = 0
  function substitutePlaceholders(value: unknown) {
    if (!value || typeof value !== 'object') return
    for (const [key, item] of Object.entries(value)) {
      if (
        (key === 'id' || key === 'accountId') &&
        ['your-account-id', 'zone123abc', 'a1b2c3d4...'].includes(item)
      )
        (value as Record<string, unknown>)[key] = '0'.repeat(32)
      else substitutePlaceholders(item)
    }
  }
  function check(yaml: string, path: string) {
    for (const document of parseAllDocuments(yaml)) {
      if (document.errors.length)
        throw new Error(`Invalid example YAML: ${path}: ${document.errors[0].message}`)
      const value = document.toJS()
      if (!value || typeof value !== 'object' || !value.apiVersion || !value.kind) continue
      substitutePlaceholders(value)
      const validate = schemas.get(`${value.apiVersion}:${value.kind}`)
      if (
        !validate &&
        (groups.has(String(value.apiVersion).split('/')[0]) ||
          kinds.has(value.kind) ||
          String(value.kind).startsWith('Cloudflare'))
      )
        throw new Error(
          `Unknown cfgate resource identity: ${path}: ${value.apiVersion}:${value.kind}`
        )
      if (validate && !validate(value))
        throw new Error(
          `Example does not match released schema: ${path}: ${JSON.stringify(validate.errors)}`
        )
      if (validate) checked++
    }
  }
  for (const [path, contents] of files) {
    if (path.startsWith('examples/') && path.endsWith('.yaml')) check(contents, path)
    if (path.endsWith('.md'))
      visit(unified().use(remarkParse).parse(contents), 'code', (node) => {
        if (
          (node.lang === 'yaml' || node.lang === 'yml') &&
          /^apiVersion:/m.test(node.value) &&
          /^kind:/m.test(node.value)
        )
          check(node.value, path)
      })
  }
  return checked
}
