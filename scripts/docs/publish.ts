import { readFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { z } from 'zod'
import { coordinatorRequest } from './build.js'
import { outputDigest } from './validate.js'
import { validatePlan } from '../../src/docs/contracts.js'

if (process.env.WORKERS_CI !== '1' || process.env.WORKERS_CI_BRANCH !== 'main')
  throw new Error('Publication requires a production Workers Build')
const claim = z
  .object({ id: z.uuid(), buildKey: z.string() })
  .parse(JSON.parse(await readFile('.generated/build-claim.json', 'utf8')))
try {
  const manifest = JSON.parse(await readFile('dist/docs/manifest.json', 'utf8'))
  const { pages: _pages, builtAt, ...input } = manifest
  const plan = await validatePlan(input)
  const validation = JSON.parse(await readFile('.generated/validated.json', 'utf8'))
  if (
    claim.buildKey !== plan.buildKey ||
    validation.buildKey !== plan.buildKey ||
    validation.outputDigest !== (await outputDigest())
  )
    throw new Error('Candidate assets differ from validated output')
  if (
    plan.rendererCommit !== execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  )
    throw new Error('Candidate renderer differs from plan')
  // Renew neither a lease nor source selection by running the renderer again.
  const eligible = await validatePlan(
    await (
      await coordinatorRequest('builds/claim', {
        buildId: claim.id,
        rendererCommit: plan.rendererCommit,
      })
    ).json()
  )
  if (eligible.buildKey !== plan.buildKey || eligible.generation !== plan.generation)
    throw new Error('Build was superseded before upload')
  const path = resolve('.generated/version-upload.jsonl')
  await rm(path, { force: true })
  execFileSync(
    'pnpm',
    [
      'exec',
      'wrangler',
      'versions',
      'upload',
      '--tag',
      plan.buildKey.slice(0, 24),
      '--message',
      plan.buildKey,
    ],
    { stdio: 'inherit', env: { ...process.env, WRANGLER_OUTPUT_FILE_PATH: path } }
  )
  const record = (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .find((record) => record.type === 'version-upload')
  const versionId = z.uuid().parse(record?.version_id)
  await coordinatorRequest(`builds/${claim.id}/candidate`, {
    buildKey: plan.buildKey,
    workerVersionId: versionId,
    builtAt,
    validated: true,
  })
  console.log(`Published validated documentation candidate ${versionId}`)
} catch (error) {
  await coordinatorRequest(`builds/${claim.id}/failure`, {}).catch(() => undefined)
  throw error
}
