import { execFileSync } from 'node:child_process'
import { z } from 'zod'
import configInput from '../../deployment.json'
import { SecretStore } from './secrets.js'

export const deployment = z
  .object({
    schemaVersion: z.literal(1),
    accountId: z.string().regex(/^[a-f0-9]{32}$/),
    worker: z.literal('cfgate-service-worker'),
    repository: z.literal('cfgate/cfgate.io'),
    branch: z.literal('main'),
    deployHookName: z.string().min(1).max(58),
    webhookURL: z.literal('https://cfgate.io/api/hooks/github'),
    webhookRepositories: z.array(z.enum(['cfgate/cfgate', 'cfgate/helm-chart'])).length(2),
  })
  .parse(configInput)
export type API = (path: string, method?: string, body?: unknown) => Promise<unknown>
export function cloudflareAPI(token: string, fetcher = fetch): API {
  return async (path, method = 'GET', body) => {
    if (!token)
      throw new Error(
        'Add a user-scoped CLOUDFLARE_SETUP_TOKEN with Workers Builds Configuration Edit and Workers Scripts Read to secrets.enc.yaml'
      )
    const response = await fetcher(
      `https://api.cloudflare.com/client/v4/accounts/${deployment.accountId}/${path}`,
      {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      }
    )
    if (!response.ok)
      throw new Error(
        `Cloudflare request failed (${response.status}); check token type and permissions`
      )
    const data = z
      .object({ success: z.boolean(), result: z.unknown() })
      .parse(await response.json())
    if (!data.success) throw new Error('Cloudflare rejected setup request')
    return data.result
  }
}
export const githubAPI: API = async (path, method = 'GET', body) => {
  try {
    const args = ['api', `repos/${path}`, '--method', method]
    if (body !== undefined) args.push('--input', '-')
    return JSON.parse(
      execFileSync('gh', args, {
        encoding: 'utf8',
        input: body === undefined ? undefined : JSON.stringify(body),
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    )
  } catch {
    throw new Error(
      'GitHub webhook request failed; gh needs Webhooks write on cfgate/cfgate and cfgate/helm-chart'
    )
  }
}
const triggerSchema = z.object({
  trigger_uuid: z.uuid(),
  external_script_id: z.string(),
  branch_includes: z.array(z.string()),
  branch_excludes: z.array(z.string()),
  repo_connection: z.object({
    provider_type: z.string(),
    provider_account_name: z.string(),
    repo_name: z.string(),
  }),
})
export function productionTrigger(input: unknown, workerTag: string, expected?: string) {
  const matches = z
    .array(triggerSchema)
    .parse(input)
    .filter(
      (t) =>
        t.external_script_id === workerTag &&
        t.branch_includes.length === 1 &&
        t.branch_includes[0] === 'main' &&
        t.branch_excludes.length === 0 &&
        t.repo_connection.provider_type === 'github' &&
        t.repo_connection.provider_account_name === 'cfgate' &&
        t.repo_connection.repo_name === 'cfgate.io'
    )
  if (matches.length !== 1 || (expected && matches[0].trigger_uuid !== expected))
    throw new Error(
      'Expected exactly one website main-only production trigger; review changed or ambiguous identity'
    )
  return matches[0]
}
const hookSchema = z.object({
  deploy_hook_uuid: z.uuid(),
  external_script_id: z.string(),
  branch: z.string(),
  deploy_hook_name: z.string(),
})
export async function provisionCloudflare(
  api: API,
  store: SecretStore,
  create: boolean
): Promise<void> {
  const scripts = z
    .array(z.object({ id: z.string(), tag: z.string() }))
    .parse(await api('workers/scripts'))
  const tag = scripts.find((s) => s.id === deployment.worker)?.tag
  if (!tag) throw new Error('Website Worker was not found in the configured account')
  const trigger = productionTrigger(
    await api(`builds/workers/${tag}/triggers`),
    tag,
    store.values.DOCS_TRIGGER_ID
  )
  const path = `builds/workers/${deployment.worker}/deploy_hooks`
  let hook: z.infer<typeof hookSchema>
  if (store.values.DOCS_BUILD_HOOK) {
    const match =
      /^https:\/\/api\.cloudflare\.com\/client\/v4\/workers\/builds\/deploy_hooks\/([a-f0-9-]{36})$/.exec(
        store.values.DOCS_BUILD_HOOK
      )
    if (!match) throw new Error('Invalid encrypted deploy-hook URL')
    hook = hookSchema.parse(await api(`${path}/${z.uuid().parse(match[1])}`))
    if (hook.deploy_hook_uuid !== match[1]) throw new Error('Deploy hook identity changed')
  } else {
    if (!create)
      throw new Error('Run setup --provision and commit the encrypted hook before activation')
    const matches = z
      .array(hookSchema)
      .parse(await api(path))
      .filter((h) => h.deploy_hook_name === deployment.deployHookName)
    if (matches.length > 1)
      throw new Error('Ambiguous named deploy hooks; inspect before continuing')
    hook =
      matches[0] ??
      hookSchema.parse(
        await api(path, 'POST', { branch: 'main', deploy_hook_name: deployment.deployHookName })
      )
  }
  if (
    hook.branch !== 'main' ||
    hook.external_script_id !== tag ||
    hook.deploy_hook_name !== deployment.deployHookName
  )
    throw new Error('Deploy hook must match the configured Worker, branch and name')
  if (create)
    await store.update({
      DOCS_TRIGGER_ID: trigger.trigger_uuid,
      DOCS_BUILD_HOOK: `https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/${hook.deploy_hook_uuid}`,
    })
  else if (store.values.DOCS_TRIGGER_ID !== trigger.trigger_uuid)
    throw new Error('Production trigger has not been recorded; run setup --provision')
}
export async function provisionGithub(
  api: API,
  store: SecretStore,
  active: boolean
): Promise<void> {
  const secret = z.string().min(32).parse(store.values.GITHUB_WEBHOOK_SECRET)
  for (const repo of deployment.webhookRepositories) {
    const hooks: { id: number; config: { url: string } }[] = []
    for (let page = 1; page <= 10; page++) {
      const batch = z
        .array(z.object({ id: z.number().int().positive(), config: z.object({ url: z.string() }) }))
        .parse(await api(`${repo}/hooks?per_page=100&page=${page}`))
      hooks.push(...batch)
      if (batch.length < 100) break
      if (page === 10) throw new Error('Webhook inventory exceeds setup limit')
    }
    const matching = hooks.filter((h) => h.config.url === deployment.webhookURL)
    if (matching.length > 1)
      throw new Error('Multiple matching GitHub webhooks; inspect before continuing')
    const body = {
      name: 'web',
      active,
      events: ['release'],
      config: { url: deployment.webhookURL, content_type: 'json', insecure_ssl: '0', secret },
    }
    if (matching.length) {
      // Staging must not rotate the secret or disable a working hook.
      if (active)
        await api(`${repo}/hooks/${matching[0].id}`, 'PATCH', {
          active: true,
          config: body.config,
          // Add on the server instead of replacing a possibly stale event inventory.
          add_events: ['release'],
        })
    } else {
      await api(`${repo}/hooks`, 'POST', body)
    }
  }
}
