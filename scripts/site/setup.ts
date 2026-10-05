import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, rm, mkdir, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { activationDigest } from '../../src/runtime/activation.js'
import { SecretStore, prepareSecrets } from './secrets.js'
import {
  deployment,
  cloudflareAPI,
  githubAPI,
  provisionCloudflare,
  provisionGithub,
} from './provision.js'

const origin = 'https://cfgate.io'
export async function activationStatus(
  response: Response,
  configurationDigest: string,
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
    .object({ initialized: z.boolean(), configurationDigest: z.string() })
    .parse(await response.json())
  if (state.configurationDigest !== configurationDigest)
    throw new Error(
      'Encrypted runtime configuration differs from the Worker; restore matching values or use a reviewed maintenance deployment'
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
  const modes = ['--prepare', '--provision', '--apply']
  if (
    args.some((arg) => ![...modes, '--install'].includes(arg)) ||
    args.filter((arg) => modes.includes(arg)).length > 1 ||
    (args.includes('--install') && !args.includes('--apply'))
  )
    throw new Error('Usage: pnpm run setup [--prepare | --provision | --apply [--install]]')
  if (!args.length) {
    console.log(`Setup plan (no writes):
1. --prepare generates missing application keys in SOPS-encrypted secrets.enc.yaml.
2. --provision discovers the main build trigger, creates/reuses its deploy hook,
   records their identities encrypted, and stages inactive GitHub release webhooks.
3. Commit and merge the configuration, then sync clean main.
4. --apply --install deploys and initializes once; --apply resumes after installation.

CLOUDFLARE_SETUP_TOKEN needs user-scoped Workers Builds Configuration Edit and
Workers Scripts Read. Existing CLOUDFLARE_API_TOKEN is used for deployment.
Account identity is in deployment.json. No age key is sent to Cloudflare or GitHub.
Hold production builds and wait for running builds before --apply.
See docs/operations.md for token creation and maintenance.`)
    return
  }
  if (process.env.CI || process.env.WORKERS_CI)
    throw new Error('Setup must run locally, outside CI')
  // Serialize setup commands. A hard interruption leaves this lock for deliberate inspection.
  await mkdir('.activation', { recursive: true, mode: 0o700 })
  if (!(await lstat('.activation')).isDirectory())
    throw new Error('Setup directory must not be a symlink')
  const lock = '.activation/setup.lock'
  await writeFile(lock, String(process.pid), { flag: 'wx', mode: 0o600 })
  try {
    const store = await new SecretStore().load()
    if (args.includes('--prepare')) {
      await prepareSecrets(store, deployment.accountId)
      console.log(
        'Application credentials are preserved in secrets.enc.yaml. Review and commit ciphertext only.'
      )
      return
    }
    for (const key of ['DOCS_ADMIN_TOKEN', 'DOCS_BUILDER_TOKEN', 'GITHUB_WEBHOOK_SECRET'])
      if (!store.values[key] || store.values[key].length < 32)
        throw new Error('Run setup --prepare first')
    const api = cloudflareAPI(store.values.CLOUDFLARE_SETUP_TOKEN)
    if (args.includes('--provision')) {
      // Each service can progress independently. Save successful work before reporting failures.
      const failures: string[] = []
      try {
        await provisionCloudflare(api, store, true)
        console.log('Cloudflare trigger and deploy hook recorded in encrypted configuration.')
      } catch (error) {
        failures.push(error instanceof Error ? error.message : 'Cloudflare provisioning failed')
      }
      try {
        await provisionGithub(githubAPI, store, false)
        console.log('GitHub release webhooks staged; existing hooks left unchanged.')
      } catch (error) {
        failures.push(error instanceof Error ? error.message : 'GitHub provisioning failed')
      }
      if (failures.length) throw new Error(failures.join('\n'))
      console.log('Provisioning complete. Commit encrypted configuration before activation.')
      return
    }
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
    if (head !== remote) throw new Error('Sync local main before activation')
    await provisionCloudflare(api, store, false)
    const token = store.values.CLOUDFLARE_API_TOKEN
    if (!token) throw new Error('Encrypted CLOUDFLARE_API_TOKEN is required for deployment')
    const secrets = {
      DOCS_ACCOUNT_ID: deployment.accountId,
      DOCS_DEPLOY_TOKEN: store.values.DOCS_DEPLOY_TOKEN || token,
      DOCS_BUILD_HOOK: z.string().min(1).parse(store.values.DOCS_BUILD_HOOK),
      DOCS_ADMIN_TOKEN: store.values.DOCS_ADMIN_TOKEN,
      DOCS_BUILDER_TOKEN: store.values.DOCS_BUILDER_TOKEN,
      GITHUB_WEBHOOK_SECRET: store.values.GITHUB_WEBHOOK_SECRET,
      GITHUB_READ_TOKEN: store.values.GITHUB_READ_TOKEN || '',
    }
    await cloudflareAPI(secrets.DOCS_DEPLOY_TOKEN)(
      `workers/scripts/${deployment.worker}/deployments`
    )
    const expectedDigest = await activationDigest(secrets)
    const request = (path: string) =>
      fetch(`${origin}/internal/docs/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secrets.DOCS_ADMIN_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      })
    await activate({
      async status() {
        return activationStatus(
          await request('status'),
          expectedDigest,
          args.includes('--install'),
          async () =>
            z
              .array(z.object({ name: z.string() }))
              .parse(await api(`workers/scripts/${deployment.worker}/secrets`))
              .map((s) => s.name)
        )
      },
      async deploy() {
        // Supplying secrets to this subprocess does not install setup or GitHub administrator tokens in the Worker.
        const env = {
          ...process.env,
          CLOUDFLARE_ACCOUNT_ID: deployment.accountId,
          CLOUDFLARE_API_TOKEN: token,
        }
        execFileSync('pnpm', ['run', 'build'], { stdio: 'inherit', env })
        execFileSync('pnpm', ['test'], { stdio: 'inherit', env })
        const temporary = await mkdtemp(join(tmpdir(), 'cfgate-deploy-'))
        try {
          const path = resolve(temporary, 'secrets.json')
          await writeFile(path, JSON.stringify(secrets), { mode: 0o600, flag: 'wx' })
          execFileSync('pnpm', ['exec', 'wrangler', 'deploy', '--secrets-file', path], {
            stdio: 'inherit',
            env,
          })
        } finally {
          await rm(temporary, { recursive: true, force: true })
        }
      },
      async bootstrap() {
        const response = await request('bootstrap')
        if (!response.ok)
          throw new Error(
            `Bootstrap returned ${response.status}; preserve encrypted credentials and investigate`
          )
      },
      async configureBuild() {
        await api(`builds/triggers/${store.values.DOCS_TRIGGER_ID}`, 'PATCH', {
          build_command: 'pnpm build',
          deploy_command: 'pnpm run deploy',
        })
        await api(
          `builds/triggers/${store.values.DOCS_TRIGGER_ID}/environment_variables`,
          'PATCH',
          {
            DOCS_BUILDER_TOKEN: { value: secrets.DOCS_BUILDER_TOKEN, is_secret: true },
          }
        )
      },
    })
    await provisionGithub(githubAPI, store, true)
    console.log(
      'Activation confirmed and release webhooks enabled. Production build settings are ready.'
    )
  } finally {
    await rm(lock, { force: true })
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof z.ZodError
        ? 'Invalid configuration; check setup inputs without logging secret values'
        : error instanceof Error
          ? error.message
          : 'Setup failed'
    )
    process.exitCode = 1
  })
}
