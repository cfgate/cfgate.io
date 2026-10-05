import type { Context } from 'hono'
import { z } from 'zod'
import type { AppEnv, Bindings } from '../types.js'
import { validatePlan } from '../docs/contracts'
import { boundedText } from '../docs/github.js'
import { claimSchema, candidateSchema } from '../runtime/project-coordinator.js'

export function coordinator(env: Bindings): DurableObjectStub | undefined {
  return env.PROJECT_COORDINATOR?.get(env.PROJECT_COORDINATOR.idFromName('project'))
}
export function production(request: Request, env: Bindings): boolean {
  return env.ENVIRONMENT === 'production' && new URL(request.url).hostname === 'cfgate.io'
}
export async function secretMatches(actual: string, expected: string): Promise<boolean> {
  if (!actual || !expected) return false
  const hash = async (s: string) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  const [a, b] = await Promise.all([hash(actual), hash(expected)])
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i]
  return difference === 0
}
export async function docsBuildHandler(c: Context<AppEnv>): Promise<Response> {
  if (!production(c.req.raw, c.env)) return c.text('Read-only environment', 403)
  const reconcile = [
    '/internal/docs/reconcile',
    '/internal/docs/bootstrap',
    '/internal/docs/status',
  ].includes(c.req.path)
  const expected = reconcile ? c.env.DOCS_ADMIN_TOKEN : c.env.DOCS_BUILDER_TOKEN
  if (
    !(await secretMatches(
      c.req.header('Authorization') ?? '',
      expected ? `Bearer ${expected}` : ''
    ))
  )
    return c.text('Unauthorized', 401)
  const stub = coordinator(c.env)
  if (!stub) return c.text('Coordinator unavailable', 503)
  let path = c.req.path.replace('/internal/docs', '')
  try {
    const text = await boundedText(c.req.raw, 4096)
    const body = text ? JSON.parse(text) : {}
    if (path === '/status') {
      z.object({}).strict().parse(body)
      c.header('Cache-Control', 'no-store')
      return stub.fetch('https://coordinator/status', { method: 'POST' })
    }
    if (path === '/bootstrap') {
      z.object({}).strict().parse(body)
      if (!c.env.ASSETS || !c.env.CF_VERSION_METADATA)
        return c.text('Bootstrap bindings unavailable', 503)
      const manifest = (await (
        await c.env.ASSETS.fetch('https://cfgate.io/docs/manifest.json')
      ).json()) as Record<string, unknown>
      const { pages: _pages, builtAt, ...input } = manifest
      const plan = await validatePlan(input)
      return stub.fetch('https://coordinator/bootstrap', {
        method: 'POST',
        body: JSON.stringify({ plan, builtAt, versionId: c.env.CF_VERSION_METADATA.id }),
      })
    }
    if (path === '/builds/claim') {
      claimSchema.parse(body)
      path = '/claim'
    } else if (path.endsWith('/candidate')) candidateSchema.parse(body)
    else if (path === '/reconcile')
      z.object({ forceRebuild: z.boolean().optional() }).strict().parse(body)
    else if (path.endsWith('/failure')) z.object({}).strict().parse(body)
    else return c.text('Not found', 404)
    c.header('Cache-Control', 'no-store')
    return stub.fetch(`https://coordinator${path}`, { method: 'POST', body: JSON.stringify(body) })
  } catch {
    return c.text('Invalid request', 400)
  }
}
const webhookSchema = z.object({
  action: z.string().optional(),
  repository: z.object({ full_name: z.enum(['cfgate/cfgate', 'cfgate/helm-chart']) }),
})
export async function githubWebhook(c: Context<AppEnv>): Promise<Response> {
  if (!production(c.req.raw, c.env) || !c.env.GITHUB_WEBHOOK_SECRET)
    return c.text('Webhook unavailable', 503)
  const signature = c.req.header('X-Hub-Signature-256') ?? ''
  if (!/^sha256=[a-f0-9]{64}$/.test(signature)) return c.text('Unauthorized', 401)
  try {
    const text = await boundedText(c.req.raw, 65536)
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(c.env.GITHUB_WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )
    const bytes = Uint8Array.from(signature.slice(7).match(/../g)!, (b) => parseInt(b, 16))
    if (!(await crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(text))))
      return c.text('Unauthorized', 401)
    const body = webhookSchema.parse(JSON.parse(text))
    const event = c.req.header('X-GitHub-Event')
    const relevant =
      (event === 'release' &&
        ['published', 'released', 'prereleased', 'edited', 'deleted', 'unpublished'].includes(
          body.action ?? ''
        )) ||
      (event === 'workflow_run' && body.action === 'completed')
    if (!relevant) return c.json({ ignored: true }, 202)
    const delivery = z.uuid().parse(c.req.header('X-GitHub-Delivery'))
    const stub = coordinator(c.env)
    if (!stub) return c.text('Coordinator unavailable', 503)
    return await stub.fetch('https://coordinator/signal', {
      method: 'POST',
      body: JSON.stringify({ delivery }),
    })
  } catch {
    return c.text('Invalid webhook', 400)
  }
}
let lastSignal = 0
export function signalAccess(c: Context<AppEnv>): void {
  if (!production(c.req.raw, c.env) || Date.now() - lastSignal < 60000) return
  const stub = coordinator(c.env)
  if (!stub) return
  lastSignal = Date.now()
  c.executionCtx.waitUntil(
    stub
      .fetch('https://coordinator/access', { method: 'POST', body: '{}' })
      .then(() => undefined)
      .catch(() => undefined)
  )
}
export async function servedDocumentation(env: Bindings): Promise<unknown> {
  if (!env.ASSETS) return undefined
  const response = await env.ASSETS.fetch('https://cfgate.io/docs/manifest.json')
  if (!response.ok) return undefined
  const value = z
    .object({
      buildKey: z.string(),
      targets: z.array(z.object({ channel: z.string(), operatorVersion: z.string() })),
    })
    .parse(await response.json())
  return {
    servedVersion: value.targets.find((t) => t.channel === 'latest')?.operatorVersion,
    servedBuildKey: value.buildKey,
  }
}
