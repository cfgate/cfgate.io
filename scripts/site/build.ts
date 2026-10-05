import { writeFile, mkdir, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { validatePlan } from '../../src/docs/contracts.js'
import { Github } from '../../src/docs/github.js'
import { localPlan, prepare } from '../docs/prepare.js'

export async function coordinatorRequest(path: string, body: unknown): Promise<Response> {
  if (!process.env.DOCS_BUILDER_TOKEN)
    throw new Error('DOCS_BUILDER_TOKEN is required for production builds')
  const response = await fetch(`https://cfgate.io/internal/docs/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.DOCS_BUILDER_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
    redirect: 'error',
  })
  if (!response.ok) throw new Error(`Documentation coordinator returned ${response.status}`)
  return response
}
if (process.argv[1]?.endsWith('/build.ts')) {
  const production = process.env.WORKERS_CI === '1' && process.env.WORKERS_CI_BRANCH === 'main'
  const pathIndex = process.argv.indexOf('--plan')
  const explicitPlan = pathIndex < 0 ? undefined : process.argv[pathIndex + 1]
  if (production && explicitPlan) throw new Error('Production builds must claim a coordinator plan')
  const renderer = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const id = process.env.WORKERS_CI_BUILD_UUID || randomUUID()
  await mkdir('.generated', { recursive: true })
  await rm('.generated/build-claim.json', { force: true })
  await rm('.generated/validated.json', { force: true })
  try {
    const plan = production
      ? await validatePlan(
          await (
            await coordinatorRequest('builds/claim', { buildId: id, rendererCommit: renderer })
          ).json()
        )
      : await localPlan(explicitPlan)
    if (plan.rendererCommit !== renderer) throw new Error('Renderer checkout differs from plan')
    if (production)
      await writeFile(
        '.generated/build-claim.json',
        JSON.stringify({ id, buildKey: plan.buildKey })
      )
    await prepare(plan, new Github(process.env.GITHUB_TOKEN))
    for (const args of [
      ['exec', 'astro', 'check'],
      ['exec', 'astro', 'check', '--root', 'docs'],
      ['exec', 'tsc', '--noEmit', '-p', 'tsconfig.docs.json'],
      ['exec', 'astro', 'build'],
      ['docs:build'],
      ['exec', 'tsx', 'scripts/site/assemble.ts'],
    ])
      execFileSync('pnpm', args, { stdio: 'inherit' })
    const { validateOutput } = await import('./validate.js')
    await validateOutput()
  } catch (error) {
    if (production) await coordinatorRequest(`builds/${id}/failure`, {}).catch(() => undefined)
    throw error
  }
}
