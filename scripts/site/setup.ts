import { execFileSync } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, lstat, mkdtemp, rm } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { z } from 'zod'

const origin = 'https://cfgate.io'
const worker = 'cfgate-service-worker'
const credentialsSchema = z
  .object({
    accountId: z.string().regex(/^[a-f0-9]{32}$/),
    DOCS_ADMIN_TOKEN: z.string().min(32),
    DOCS_BUILDER_TOKEN: z.string().min(32),
  })
  .strict()
type Credentials = z.infer<typeof credentialsSchema>

export async function credentials(directory: string, accountId: string): Promise<Credentials> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const dir = await lstat(directory)
  if (!dir.isDirectory() || (dir.mode & 0o077) !== 0)
    throw new Error('Activation directory must be private (mode 700), and not a symlink')
  const path = `${directory}/credentials.json`
  try {
    const info = await lstat(path)
    if (!info.isFile() || (info.mode & 0o077) !== 0)
      throw new Error('Activation credentials must be a private regular file (mode 600)')
    const stored = credentialsSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    if (stored.accountId !== accountId)
      throw new Error('Activation credentials belong to another account')
    return stored
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const value = credentialsSchema.parse({
    accountId,
    DOCS_ADMIN_TOKEN: randomBytes(32).toString('hex'),
    DOCS_BUILDER_TOKEN: randomBytes(32).toString('hex'),
  })
  // Exclusive creation prevents a second setup process from rotating our secrets.
  await writeFile(path, JSON.stringify(value), { flag: 'wx', mode: 0o600 })
  return value
}

export function productionTrigger(input: unknown, workerTag: string, triggerId: string) {
  const triggers = z
    .array(
      z.object({
        trigger_uuid: z.uuid(),
        external_script_id: z.string(),
        branch_includes: z.array(z.string()),
        branch_excludes: z.array(z.string()),
        repo_connection: z.object({
          provider_type: z.literal('github'),
          provider_account_name: z.literal('cfgate'),
          repo_name: z.literal('cfgate.io'),
        }),
      })
    )
    .parse(input)
  const trigger = triggers.find((t) => t.trigger_uuid === triggerId)
  if (
    !trigger ||
    trigger.external_script_id !== workerTag ||
    trigger.branch_includes.length !== 1 ||
    trigger.branch_includes[0] !== 'main' ||
    trigger.branch_excludes.length !== 0
  )
    throw new Error(
      'Select the website production trigger with only main included and no exclusions'
    )
  return trigger
}

export function validateHook(input: unknown, workerTag: string, hookId: string): void {
  const hook = z
    .object({
      deploy_hook_uuid: z.uuid(),
      external_script_id: z.string(),
      branch: z.string(),
    })
    .parse(input)
  if (
    hook.deploy_hook_uuid !== hookId ||
    hook.external_script_id !== workerTag ||
    hook.branch !== 'main'
  )
    throw new Error('Deploy hook must belong to this Worker and target main')
}

export async function activationStatus(
  response: Response,
  builderToken: string,
  install: boolean,
  secretNames: () => Promise<string[]>
): Promise<{ initialized: boolean } | undefined> {
  if (response.status === 401 || response.status === 404) {
    if (!install)
      throw new Error('Status unavailable; first installation requires --apply --install')
    const installed = await secretNames()
    if (installed.includes('DOCS_ADMIN_TOKEN') || installed.includes('DOCS_BUILDER_TOKEN'))
      throw new Error(
        'Runtime authentication is already configured; restore credentials or investigate propagation instead of reinstalling'
      )
    return undefined
  }
  if (!response.ok)
    throw new Error(
      `Activation status returned ${response.status}; preserve credentials and investigate`
    )
  const state = z
    .object({ initialized: z.boolean(), builderTokenDigest: z.string() })
    .parse(await response.json())
  if (state.builderTokenDigest !== createHash('sha256').update(builderToken).digest('hex'))
    throw new Error(
      'Stored builder credential differs from the deployed Worker; restore the matching credential'
    )
  return state
}

export interface ActivationSteps {
  status(): Promise<{ initialized: boolean } | undefined>
  deploy(): Promise<void>
  bootstrap(): Promise<void>
  configureBuild(): Promise<void>
}
export async function activate(steps: ActivationSteps): Promise<void> {
  let state = await steps.status()
  if (!state) {
    await steps.deploy()
    state = await steps.status()
    if (!state)
      throw new Error(
        'New Worker has not become available; retry setup without changing credentials'
      )
  }
  // Bootstrap enables alarms and access-triggered builds. Configure their credentials first.
  await steps.configureBuild()
  if (!state.initialized) await steps.bootstrap()
  if (!(await steps.status())?.initialized)
    throw new Error('Coordinator initialization was not confirmed')
}

async function main() {
  const args = process.argv.slice(2)
  if (args.some((arg) => !['--apply', '--install'].includes(arg)))
    throw new Error('Usage: pnpm run setup [--apply [--install]]')
  if (!args.includes('--apply')) {
    console.log(`One-time activation plan (no writes):
1. Validate a clean production checkout and Cloudflare production trigger.
2. Retain generated builder/admin credentials in private .activation/credentials.json.
3. Install the first Worker, assets, migration and runtime secrets together if absent.
4. Set production build authentication and commands, then initialize the coordinator.

For first installation, use --apply --install. For retries, use --apply.
Pause automatic production builds and wait for running builds to finish before either.
Required environment: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN,
DOCS_TRIGGER_ID, DOCS_BUILD_HOOK and DOCS_DEPLOY_TOKEN.
Keep .activation/ backed up securely. See docs/operations.md for permissions and recovery.`)
    return
  }
  if (process.env.CI || process.env.WORKERS_CI)
    throw new Error('Activation must run locally, outside CI')
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim()
  if (git('branch', '--show-current') !== 'main' || git('status', '--porcelain'))
    throw new Error('Activation requires a clean main checkout')
  const head = git('rev-parse', 'HEAD')
  const remote = git(
    '-c',
    'credential.helper=!gh auth git-credential',
    'ls-remote',
    'https://github.com/cfgate/cfgate.io.git',
    'refs/heads/main'
  ).split(/\s/)[0]
  if (head !== remote) throw new Error('Sync local main with cfgate/cfgate.io before activation')
  const env = z
    .object({
      CLOUDFLARE_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/),
      CLOUDFLARE_API_TOKEN: z.string().min(1),
      DOCS_TRIGGER_ID: z.uuid(),
      DOCS_DEPLOY_TOKEN: z.string().min(1),
      DOCS_BUILD_HOOK: z
        .string()
        .regex(
          /^https:\/\/api\.cloudflare\.com\/client\/v4\/workers\/builds\/deploy_hooks\/[a-zA-Z0-9_-]+$/
        ),
    })
    .parse(process.env)
  const account = env.CLOUDFLARE_ACCOUNT_ID
  async function api(path: string, body?: unknown, token = env.CLOUDFLARE_API_TOKEN) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,
      {
        method: body === undefined ? 'GET' : 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      }
    )
    // Do not log provider payloads, which can contain credentials or hook URLs.
    if (!response.ok)
      throw new Error(
        `Cloudflare setup request failed (${response.status}); check user-token permissions`
      )
    const result = z
      .object({ success: z.boolean(), result: z.unknown() })
      .parse(await response.json())
    if (!result.success) throw new Error('Cloudflare rejected setup request')
    return result.result
  }
  const scripts = z
    .array(z.object({ id: z.string(), tag: z.string() }))
    .parse(await api('workers/scripts'))
  const tag = scripts.find((s) => s.id === worker)?.tag
  if (!tag) throw new Error('Existing cfgate-service-worker was not found in this account')
  productionTrigger(await api(`builds/workers/${tag}/triggers`), tag, env.DOCS_TRIGGER_ID)
  await api(`builds/triggers/${env.DOCS_TRIGGER_ID}/environment_variables`)
  const hookId = z.uuid().parse(new URL(env.DOCS_BUILD_HOOK).pathname.split('/').at(-1))
  validateHook(await api(`builds/workers/${worker}/deploy_hooks/${hookId}`), tag, hookId)
  await api(`workers/scripts/${worker}/deployments`, undefined, env.DOCS_DEPLOY_TOKEN)
  const secretNames = async () =>
    z
      .array(z.object({ name: z.string() }))
      .parse(await api(`workers/scripts/${worker}/secrets`))
      .map((s) => s.name)

  const stored = await credentials('.activation', account)
  async function request(path: string): Promise<Response> {
    return fetch(`${origin}/internal/docs/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stored.DOCS_ADMIN_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    })
  }
  await activate({
    async status() {
      return activationStatus(
        await request('status'),
        stored.DOCS_BUILDER_TOKEN,
        args.includes('--install'),
        secretNames
      )
    },
    async deploy() {
      console.log('Building and checking the complete site for initial deployment')
      execFileSync('pnpm', ['build'], { stdio: 'inherit' })
      execFileSync('pnpm', ['test'], { stdio: 'inherit' })
      const temporary = await mkdtemp('.activation/deploy-')
      const secretsPath = resolve(temporary, 'secrets.json')
      const secrets = {
        DOCS_ACCOUNT_ID: account,
        DOCS_DEPLOY_TOKEN: env.DOCS_DEPLOY_TOKEN,
        DOCS_BUILD_HOOK: env.DOCS_BUILD_HOOK,
        DOCS_ADMIN_TOKEN: stored.DOCS_ADMIN_TOKEN,
        DOCS_BUILDER_TOKEN: stored.DOCS_BUILDER_TOKEN,
        ...(process.env.GITHUB_READ_TOKEN
          ? { GITHUB_READ_TOKEN: process.env.GITHUB_READ_TOKEN }
          : {}),
        ...(process.env.GITHUB_WEBHOOK_SECRET
          ? { GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET }
          : {}),
      }
      try {
        await writeFile(secretsPath, JSON.stringify(secrets), { mode: 0o600, flag: 'wx' })
        execFileSync('pnpm', ['exec', 'wrangler', 'deploy', '--secrets-file', secretsPath], {
          stdio: 'inherit',
        })
      } finally {
        await rm(temporary, { recursive: true, force: true })
      }
    },
    async bootstrap() {
      const response = await request('bootstrap')
      if (!response.ok)
        throw new Error(
          `Bootstrap returned ${response.status}; retry with the same credentials after investigating`
        )
    },
    async configureBuild() {
      await api(`builds/triggers/${env.DOCS_TRIGGER_ID}`, {
        build_command: 'pnpm build',
        deploy_command: 'pnpm run deploy',
      })
      await api(`builds/triggers/${env.DOCS_TRIGGER_ID}/environment_variables`, {
        DOCS_BUILDER_TOKEN: { value: stored.DOCS_BUILDER_TOKEN, is_secret: true },
      })
    },
  })
  console.log(
    'Activation confirmed. Production build settings are configured; previews were not changed. Resume production builds.'
  )
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof z.ZodError
        ? 'Invalid setup configuration; check required environment values'
        : error instanceof Error
          ? error.message
          : 'Setup failed'
    )
    process.exitCode = 1
  })
}
