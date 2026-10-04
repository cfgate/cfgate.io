import { parseAllDocuments, stringify } from 'yaml'

interface Schema {
  type?: string
  description?: string
  required?: string[]
  properties?: Record<string, Schema>
  items?: Schema
  additionalProperties?: Schema | boolean
  default?: unknown
  enum?: unknown[]
  nullable?: boolean
  [key: string]: unknown
}
function cell(value: unknown): string {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\n', '<br />')
}
export function schemaReference(yaml: string): { name: string; title: string; markdown: string }[] {
  return parseAllDocuments(yaml).map((document) => {
    if (document.errors.length) throw new Error('Invalid CRD YAML')
    const crd = document.toJS()
    if (crd?.kind !== 'CustomResourceDefinition') throw new Error('Expected CRD')
    const rows: string[] = []
    function walk(schema: Schema, path: string, required: boolean, depth = 0) {
      if (depth > 32 || rows.length > 5000) throw new Error('Schema reference exceeds bounds')
      const constraints = Object.fromEntries(
        Object.entries(schema).filter(
          ([k]) =>
            k.startsWith('x-kubernetes-') ||
            [
              'minimum',
              'maximum',
              'minLength',
              'maxLength',
              'pattern',
              'minItems',
              'maxItems',
              'format',
              'oneOf',
              'anyOf',
              'allOf',
              'not',
            ].includes(k)
        )
      )
      rows.push(
        `| \`${cell(path)}\` | ${cell(schema.type ?? (schema['x-kubernetes-int-or-string'] ? 'integer or string' : 'any'))} | ${required ? 'yes' : 'no'} | ${schema.default === undefined ? '*none*' : `\`${cell(JSON.stringify(schema.default))}\``} | ${cell(schema.description)} |`
      )
      if (schema.enum)
        rows.push(`\nAllowed values for \`${path}\`: \`${cell(JSON.stringify(schema.enum))}\`.\n`)
      if (schema.nullable) rows.push(`\n\`${path}\` accepts null.\n`)
      if (Object.keys(constraints).length)
        rows.push(`\nValidation for \`${path}\`:\n\n\`\`\`yaml\n${stringify(constraints)}\`\`\`\n`)
      for (const [key, child] of Object.entries(schema.properties ?? {}))
        walk(
          child,
          path ? `${path}.${key}` : key,
          schema.required?.includes(key) ?? false,
          depth + 1
        )
      if (schema.items) walk(schema.items, `${path}[]`, false, depth + 1)
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object')
        walk(schema.additionalProperties, `${path}[key]`, false, depth + 1)
    }
    for (const version of crd.spec.versions) {
      if (!version.served) continue
      rows.push(
        `## ${version.name}\n\n| Field | Type | Required in parent | Schema default | Description |\n| --- | --- | --- | --- | --- |`
      )
      walk(version.schema.openAPIV3Schema, '', false)
    }
    // Each field is a separate section so complex validations cannot break tables.
    const body = rows
      .map((row, index) =>
        row.startsWith('| `')
          ? `\n${index > 0 ? '| Field | Type | Required in parent | Schema default | Description |\n| --- | --- | --- | --- | --- |\n' : ''}${row}\n`
          : row
      )
      .join('\n')
    return {
      name: crd.spec.names.plural.toLowerCase(),
      title: `${crd.spec.names.kind} schema`,
      markdown: `These fields come from the released CRD. Required means required when its parent object is present. Schema defaults do not describe every runtime fallback.\n\n${body}`,
    }
  })
}
export function helmReference(values: string): string {
  return `The chart's commented values are the configuration reference. User overrides remain authoritative during upgrades.\n\n\`\`\`yaml\n${values.trim()}\n\`\`\`\n`
}
