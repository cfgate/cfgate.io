import { z } from 'zod'
import { valid } from 'semver'

export const commitSchema = z.string().regex(/^[a-f0-9]{40}$/)
export const versionSchema = z
  .string()
  .max(80)
  .refine((v) => !!valid(v), 'Expected semantic version')
export const sourceSchema = z
  .object({
    repository: z.enum(['cfgate/cfgate', 'cfgate/helm-chart']),
    ref: z.string().min(1).max(120),
    commit: commitSchema,
  })
  .strict()
export const targetSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9.-]+$/),
    channel: z.enum(['latest', 'next', 'version']),
    mount: z.string().regex(/^(?:next|v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)?$/),
    operatorVersion: versionSchema,
    operatorSource: sourceSchema,
    documentationSource: sourceSchema,
    chartSource: sourceSchema.optional(),
    chartVersion: versionSchema.optional(),
    locale: z.literal('en'),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      (v.channel === 'latest' && v.mount !== '') ||
      (v.channel === 'next' && v.mount !== 'next') ||
      (v.channel === 'version' && v.mount !== v.operatorVersion)
    )
      ctx.addIssue({ code: 'custom', message: 'Channel and mount disagree' })
    if (
      v.operatorSource.repository !== 'cfgate/cfgate' ||
      v.documentationSource.repository !== 'cfgate/cfgate' ||
      (v.chartSource && v.chartSource.repository !== 'cfgate/helm-chart') ||
      !!v.chartVersion !== !!v.chartSource
    )
      ctx.addIssue({ code: 'custom', message: 'Source roles disagree' })
  })
export const planSchema = z
  .object({
    schemaVersion: z.literal(1),
    generation: z.number().int().positive(),
    buildKey: z.string().regex(/^[a-f0-9]{64}$/),
    rendererCommit: commitSchema,
    policyDigest: z.string().regex(/^[a-f0-9]{64}$/),
    targets: z.array(targetSchema).min(1).max(8),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const field of ['id', 'mount'] as const)
      if (new Set(v.targets.map((t) => t[field])).size !== v.targets.length)
        ctx.addIssue({ code: 'custom', message: `Duplicate target ${field}` })
  })
export type SourcePin = z.infer<typeof sourceSchema>
export type DocsTarget = z.infer<typeof targetSchema>
export type DocsBuildPlan = z.infer<typeof planSchema>
export interface PageSource {
  repository: string
  commit: string
  path: string
}
export interface DocsPage {
  docId: string
  targetId: string
  locale: string
  route: string
  title: string
  source: PageSource
  generatedFrom?: PageSource[]
}
export interface DocsManifest extends DocsBuildPlan {
  builtAt: string
  pages: DocsPage[]
}
export interface PublishedDocs {
  plan: DocsBuildPlan
  workerVersionId: string
  builtAt: string
  deployedAt: string
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`
  return JSON.stringify(value)
}
export async function digest(value: unknown): Promise<string> {
  const data = new TextEncoder().encode(canonical(value))
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
}
export async function makePlan(
  rendererCommit: string,
  policyDigest: string,
  targets: DocsTarget[],
  generation = 1
): Promise<DocsBuildPlan> {
  const inputs = { rendererCommit, policyDigest, targets, schemaVersion: 1 as const }
  return planSchema.parse({ ...inputs, generation, buildKey: await digest(inputs) })
}
export async function validatePlan(input: unknown): Promise<DocsBuildPlan> {
  const plan = planSchema.parse(input)
  const expected = await makePlan(
    plan.rendererCommit,
    plan.policyDigest,
    plan.targets,
    plan.generation
  )
  if (expected.buildKey !== plan.buildKey) throw new Error('Build plan fingerprint mismatch')
  return plan
}
export function docRoute(target: DocsTarget, docId: string): string {
  if (!/^(?:[a-z0-9-]+\/)*[a-z0-9-]*$/.test(docId)) throw new Error('Invalid logical page ID')
  return ['/docs', target.mount, docId].filter(Boolean).join('/') + '/'
}
