import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import YAML from 'yaml'
import { SecretStore, prepareSecrets, type SecretCodec } from '../../scripts/site/secrets'
import {
  deployment,
  provisionCloudflare,
  provisionGithub,
  cloudflareAPI,
  type API,
} from '../../scripts/site/provision'
import { activationDigest } from '../../src/runtime/activation'

const id = '11111111-1111-4111-8111-111111111111'
const hook = {
  deploy_hook_uuid: id,
  external_script_id: 'tag',
  branch: 'main',
  deploy_hook_name: deployment.deployHookName,
}
const trigger = {
  trigger_uuid: id,
  external_script_id: 'tag',
  branch_includes: ['main'],
  branch_excludes: [],
  repo_connection: {
    provider_type: 'github',
    provider_account_name: 'cfgate',
    repo_name: 'cfgate.io',
  },
}
async function fixture(
  run: (store: SecretStore, directory: string, codec: SecretCodec) => Promise<void>
) {
  const directory = await mkdtemp(join(tmpdir(), 'cfgate-secrets-test-'))
  let values = { ORIGINAL: 'preserved' }
  const codec: SecretCodec = {
    decrypt: () => ({ ...values }),
    encrypt: vi.fn((next) => {
      values = next as typeof values
      return YAML.stringify({
        ...Object.fromEntries(Object.keys(next).map((k) => [k, 'ENC[test]'])),
        sops: { test: true },
      })
    }),
  }
  const path = join(directory, 'secrets.enc.yaml')
  await writeFile(path, 'original ciphertext')
  try {
    await run(await new SecretStore(path, codec).load(), directory, codec)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
function provider(overrides: Record<string, unknown> = {}) {
  return vi.fn<API>(async (path, method = 'GET') => {
    if (path === 'workers/scripts') return [{ id: deployment.worker, tag: 'tag' }]
    if (path.endsWith('/triggers')) return [trigger]
    if (path.endsWith(`/deploy_hooks/${id}`)) return hook
    if (path.endsWith('/deploy_hooks')) return method === 'POST' ? hook : []
    if (path in overrides) return overrides[path]
    throw new Error('unexpected request')
  })
}
describe('encrypted setup state', () => {
  it('generates once, preserves existing credentials and writes only ciphertext', async () => {
    await fixture(async (store, directory, codec) => {
      await prepareSecrets(store, deployment.accountId, join(directory, 'absent'))
      const first = { ...store.values }
      expect(first.DOCS_ADMIN_TOKEN).toHaveLength(64)
      expect(first.DOCS_ADMIN_TOKEN).not.toBe(first.DOCS_BUILDER_TOKEN)
      await prepareSecrets(store, deployment.accountId, join(directory, 'absent'))
      expect(store.values).toEqual(first)
      expect(codec.encrypt).toHaveBeenCalledOnce()
      const disk = await readFile(store.path, 'utf8')
      for (const value of Object.values(first)) expect(disk).not.toContain(value)
      expect(first.ORIGINAL).toBe('preserved')
    })
  })
  it('imports matching legacy credentials without silently rotating conflicting ones', async () => {
    await fixture(async (store, directory) => {
      const path = join(directory, 'legacy.json')
      const legacy = {
        accountId: deployment.accountId,
        DOCS_ADMIN_TOKEN: 'a'.repeat(64),
        DOCS_BUILDER_TOKEN: 'b'.repeat(64),
      }
      await writeFile(path, JSON.stringify(legacy))
      await prepareSecrets(store, deployment.accountId, path)
      expect(store.values.DOCS_ADMIN_TOKEN).toBe(legacy.DOCS_ADMIN_TOKEN)
      await writeFile(path, JSON.stringify({ ...legacy, DOCS_BUILDER_TOKEN: 'c'.repeat(64) }))
      await expect(prepareSecrets(store, deployment.accountId, path)).rejects.toThrow('disagree')
      await expect(prepareSecrets(store, '0'.repeat(32), path)).rejects.toThrow('Cannot import')
    })
  })
  it('rejects plaintext output, concurrent edits and symlink inputs', async () => {
    await fixture(async (store, directory, codec) => {
      vi.mocked(codec.encrypt).mockReturnValueOnce('NEW: plaintext\nsops: {}')
      await expect(store.update({ NEW: 'plaintext' })).rejects.toThrow('unencrypted')
      await writeFile(store.path, 'someone else changed this')
      await expect(store.update({ NEW: 'value' })).rejects.toThrow('changed during setup')
      expect(await readFile(store.path, 'utf8')).toBe('someone else changed this')
      const alias = join(directory, 'alias')
      await symlink(store.path, alias)
      await expect(new SecretStore(alias, codec).load()).rejects.toThrow('regular file')
    })
  })
  it('includes signing and publication credentials in runtime drift detection', async () => {
    const current = {
      DOCS_BUILDER_TOKEN: 'builder',
      GITHUB_WEBHOOK_SECRET: 'signer',
      DOCS_DEPLOY_TOKEN: 'deploy',
    }
    const digest = await activationDigest(current)
    for (const key of Object.keys(current))
      expect(await activationDigest({ ...current, [key]: 'different' })).not.toBe(digest)
    const withLocalToken = { ...current, CLOUDFLARE_SETUP_TOKEN: 'local only' }
    expect(await activationDigest(withLocalToken)).toBe(digest)
  })
})
describe('remote provisioning', () => {
  it('records the discovered trigger and hook encrypted, then validates without writes', async () => {
    await fixture(async (store) => {
      const api = provider()
      await provisionCloudflare(api, store, true)
      expect(store.values.DOCS_TRIGGER_ID).toBe(id)
      expect(store.values.DOCS_BUILD_HOOK).toContain(id)
      expect(api.mock.calls.filter(([, method]) => method === 'POST')).toHaveLength(1)
      api.mockClear()
      await provisionCloudflare(api, store, false)
      expect(api.mock.calls.every(([, method]) => !method || method === 'GET')).toBe(true)
    })
  })
  it('recovers an existing named hook after an interrupted checkpoint', async () => {
    await fixture(async (store) => {
      const api = provider()
      const base = api.getMockImplementation()!
      api.mockImplementation(async (path, method, body) =>
        path.endsWith('/deploy_hooks') ? [hook] : base(path, method, body)
      )
      await provisionCloudflare(api, store, true)
      expect(api.mock.calls.every(([, method]) => method !== 'POST')).toBe(true)
      expect(store.values.DOCS_BUILD_HOOK).toContain(id)
      api.mockImplementation(async (path, method, body) =>
        path.endsWith(`/deploy_hooks/${id}`) ? { ...hook, branch: 'dev' } : base(path, method, body)
      )
      await expect(provisionCloudflare(api, store, false)).rejects.toThrow('must match')
    })
  })
  it('refuses ambiguous hooks and unrecorded activation', async () => {
    await fixture(async (store) => {
      await expect(provisionCloudflare(provider(), store, false)).rejects.toThrow('--provision')
      const api = provider()
      const base = api.getMockImplementation()!
      api.mockImplementation(async (path, method, body) =>
        path.endsWith('/deploy_hooks') ? [hook, hook] : base(path, method, body)
      )
      await expect(provisionCloudflare(api, store, true)).rejects.toThrow('Ambiguous')
      expect(api.mock.calls.every(([, method]) => method !== 'POST')).toBe(true)
    })
  })
  it('stages inactive release-only hooks and leaves existing hooks untouched until activation', async () => {
    await fixture(async (store) => {
      store.values.GITHUB_WEBHOOK_SECRET = 's'.repeat(64)
      const api = vi.fn<API>(async () => [])
      await provisionGithub(api, store, false)
      const writes = api.mock.calls.filter(([, method]) => method === 'POST')
      expect(writes).toHaveLength(2)
      for (const [, , body] of writes)
        expect(body).toMatchObject({
          active: false,
          events: ['release'],
          config: { secret: 's'.repeat(64), insecure_ssl: '0' },
        })
      api.mockClear().mockResolvedValue([{ id: 12, config: { url: deployment.webhookURL } }])
      await provisionGithub(api, store, false)
      expect(api.mock.calls.every(([, method]) => !method)).toBe(true)
      api.mockClear()
      await provisionGithub(api, store, true)
      expect(api.mock.calls.filter(([, method]) => method === 'PATCH')).toHaveLength(2)
    })
  })
  it('adds release notifications without replacing existing or concurrent subscriptions', async () => {
    await fixture(async (store) => {
      store.values.GITHUB_WEBHOOK_SECRET = 's'.repeat(64)
      const subscriptions = new Map(
        deployment.webhookRepositories.map((repo) => [repo, ['workflow_run']])
      )
      const api: API = async (path, method, input) => {
        const repo = deployment.webhookRepositories.find((repo) => path.startsWith(`${repo}/`))!
        if (!method) {
          // Another administrator adds an event after the inventory snapshot.
          subscriptions.get(repo)!.push('issues')
          return [{ id: 12, events: ['workflow_run'], config: { url: deployment.webhookURL } }]
        }
        const body = input as { events?: string[]; add_events?: string[] }
        if (body.events) subscriptions.set(repo, body.events)
        else
          subscriptions.set(repo, [
            ...new Set([...subscriptions.get(repo)!, ...(body.add_events ?? [])]),
          ])
        return {}
      }
      await provisionGithub(api, store, true)
      for (const events of subscriptions.values())
        expect(events).toEqual(['workflow_run', 'issues', 'release'])
    })
  })
  it('rejects duplicate webhook destinations and sanitizes provider errors', async () => {
    await fixture(async (store) => {
      store.values.GITHUB_WEBHOOK_SECRET = 's'.repeat(64)
      const api = vi.fn<API>(async () =>
        [1, 2].map((id) => ({ id, config: { url: deployment.webhookURL } }))
      )
      await expect(provisionGithub(api, store, true)).rejects.toThrow('Multiple matching')
      expect(api).toHaveBeenCalledOnce()
    })
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response('sensitive provider response', { status: 401 })
    )
    await expect(cloudflareAPI('token', fetcher)('workers/scripts')).rejects.toThrow(
      'Cloudflare request failed (401)'
    )
    await expect(cloudflareAPI('', fetcher)('workers/scripts')).rejects.toThrow('user-scoped')
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
