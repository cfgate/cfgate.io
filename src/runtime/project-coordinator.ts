import { DurableObject } from 'cloudflare:workers'
import { z } from 'zod'
import type { Bindings } from '../types.js'
import { Github, boundedText } from '../docs/github.js'
import { commitSchema, validatePlan } from '../docs/contracts.js'
import { Coordinator, Conflict } from './coordinator.js'
import { CloudflarePublication } from './provider.js'

export const claimSchema = z.object({ buildId: z.uuid(), rendererCommit: commitSchema }).strict()
export const candidateSchema = z
  .object({
    buildKey: z.string().regex(/^[a-f0-9]{64}$/),
    workerVersionId: z.uuid(),
    builtAt: z.iso.datetime(),
    validated: z.literal(true),
  })
  .strict()
export class ProjectCoordinator extends DurableObject<Bindings> {
  private coordinator: Coordinator
  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env)
    this.coordinator = new Coordinator(
      ctx.storage,
      new Github(env.GITHUB_READ_TOKEN),
      new CloudflarePublication(
        env.DOCS_ACCOUNT_ID ?? '',
        env.DOCS_DEPLOY_TOKEN ?? '',
        env.DOCS_BUILD_HOOK ?? ''
      )
    )
  }
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    try {
      if (request.method === 'GET' && path === '/project') {
        const state = await this.coordinator.state()
        return Response.json({
          ...state.project,
          documentation: {
            observedLatest: state.observedLatest,
            desiredVersion: state.desired?.targets[0].operatorVersion,
            state: state.phase,
            lastSuccessfulReleaseCheckAt: state.lastReleaseCheck,
            counters: state.counters,
            lastPublicationDelayMs: state.lastPublicationDelayMs,
          },
        })
      }
      if (this.env.ENVIRONMENT !== 'production')
        return new Response('Read-only environment', { status: 403 })
      if (path === '/signal' || path === '/access') {
        const body = z
          .object({ delivery: z.uuid().optional() })
          .strict()
          .parse(JSON.parse(await boundedText(request, 1024)))
        await this.coordinator.signal(body.delivery, path === '/access')
      } else if (path === '/reconcile') {
        const body = z
          .object({ forceRebuild: z.boolean().optional() })
          .strict()
          .parse(JSON.parse(await boundedText(request, 1024)))
        if (body.forceRebuild) await this.coordinator.forceRebuild()
        await this.coordinator.signal()
      } else if (path === '/bootstrap') {
        const body = z
          .object({ plan: z.unknown(), versionId: z.uuid(), builtAt: z.iso.datetime() })
          .strict()
          .parse(JSON.parse(await boundedText(request, 16384)))
        await this.coordinator.bootstrap(
          await validatePlan(body.plan),
          body.versionId,
          body.builtAt
        )
      } else if (path === '/claim') {
        const body = claimSchema.parse(JSON.parse(await boundedText(request, 1024)))
        return Response.json(await this.coordinator.claim(body.buildId, body.rendererCommit))
      } else if (/^\/builds\/[\da-f-]+\/candidate$/.test(path)) {
        const id = z.uuid().parse(path.split('/')[2])
        const body = candidateSchema.parse(JSON.parse(await boundedText(request, 4096)))
        await this.coordinator.candidate(id, body.buildKey, body.workerVersionId, body.builtAt)
      } else if (/^\/builds\/[\da-f-]+\/failure$/.test(path)) {
        await this.coordinator.failure(z.uuid().parse(path.split('/')[2]))
      } else return new Response('Not found', { status: 404 })
      return Response.json({ accepted: true }, { status: 202 })
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        return new Response('Invalid request', { status: 400 })
      if (error instanceof Conflict) return new Response(error.message, { status: 409 })
      console.error(
        'docs_coordinator_error',
        error instanceof Error ? error.message : 'Unknown error'
      )
      return new Response('Coordinator unavailable', { status: 503 })
    }
  }
  async alarm(): Promise<void> {
    if (this.env.ENVIRONMENT === 'production') await this.coordinator.reconcile()
  }
}
