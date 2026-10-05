import { mkdtemp, rm, chmod, readFile, symlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  activate,
  credentials,
  productionTrigger,
  activationStatus,
  validateHook,
} from '../../scripts/site/setup'

const id = '11111111-1111-4111-8111-111111111111'
describe('local activation', () => {
  it('installs over an unconfigured legacy 401 only with explicit first-install intent', async () => {
    const names = vi.fn(async () => [])
    expect(
      await activationStatus(new Response(null, { status: 401 }), 'builder', true, names)
    ).toBeUndefined()
    expect(names).toHaveBeenCalledOnce()
    await expect(
      activationStatus(new Response(null, { status: 401 }), 'builder', false, names)
    ).rejects.toThrow('--install')
    for (const key of ['DOCS_ADMIN_TOKEN', 'DOCS_BUILDER_TOKEN'])
      await expect(
        activationStatus(new Response(null, { status: 401 }), 'builder', true, async () => [key])
      ).rejects.toThrow('already configured')
    await expect(
      activationStatus(new Response(null, { status: 403 }), 'builder', true, names)
    ).rejects.toThrow('403')
  })
  it('rejects stale credentials and tolerates an authenticated completed installation', async () => {
    const body = {
      initialized: true,
      builderTokenDigest: createHash('sha256').update('builder').digest('hex'),
    }
    expect(
      await activationStatus(Response.json(body), 'builder', false, async () => [])
    ).toMatchObject({ initialized: true })
    await expect(
      activationStatus(Response.json(body), 'different', false, async () => [])
    ).rejects.toThrow('differs')
  })
  it('checks hook identity and main branch without triggering a build', () => {
    const hook = { deploy_hook_uuid: id, external_script_id: 'worker', branch: 'main' }
    expect(() => validateHook(hook, 'worker', id)).not.toThrow()
    expect(() => validateHook({ ...hook, branch: 'dev' }, 'worker', id)).toThrow()
    expect(() => validateHook(hook, 'other-worker', id)).toThrow()
    expect(() => validateHook(hook, 'worker', '22222222-2222-4222-8222-222222222222')).toThrow()
  })

  it('retains private credentials across retries and refuses another account', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cfgate-activation-'))
    try {
      const first = await credentials(directory, 'a'.repeat(32))
      expect(await credentials(directory, 'a'.repeat(32))).toEqual(first)
      expect(first.DOCS_BUILDER_TOKEN).not.toBe(first.DOCS_ADMIN_TOKEN)
      await expect(credentials(directory, 'b'.repeat(32))).rejects.toThrow('another account')
      expect(JSON.parse(await readFile(`${directory}/credentials.json`, 'utf8'))).toEqual(first)
      await chmod(`${directory}/credentials.json`, 0o644)
      await expect(credentials(directory, 'a'.repeat(32))).rejects.toThrow('private regular file')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('does not follow an activation directory symlink', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'cfgate-activation-'))
    try {
      await symlink(parent, `${parent}/alias`)
      await expect(credentials(`${parent}/alias`, 'a'.repeat(32))).rejects.toThrow('not a symlink')
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
  it('rejects preview, mixed-branch and unrelated triggers', () => {
    const trigger = {
      trigger_uuid: id,
      external_script_id: 'worker',
      branch_includes: ['main'],
      branch_excludes: [],
      repo_connection: {
        provider_type: 'github',
        provider_account_name: 'cfgate',
        repo_name: 'cfgate.io',
      },
    }
    expect(productionTrigger([trigger], 'worker', id)).toEqual(trigger)
    for (const change of [
      { branch_includes: ['*'] },
      { branch_includes: ['main', 'dev'] },
      { branch_excludes: ['dev'] },
      { external_script_id: 'another-worker' },
      {
        repo_connection: {
          provider_type: 'github',
          provider_account_name: 'someone',
          repo_name: 'else',
        },
      },
    ])
      expect(() => productionTrigger([{ ...trigger, ...change }], 'worker', id)).toThrow()
  })
  it('resumes after a lost bootstrap response without deploying or initializing again', async () => {
    let state: { initialized: boolean } | undefined
    const steps = {
      status: vi.fn(async () => state),
      deploy: vi.fn(async () => {
        state = { initialized: false }
      }),
      bootstrap: vi.fn(async () => {
        state = { initialized: true }
        throw new Error('lost response')
      }),
      configureBuild: vi.fn(async () => {}),
    }
    await expect(activate(steps)).rejects.toThrow('lost response')
    expect(steps.configureBuild).toHaveBeenCalledTimes(1)
    await activate(steps)
    expect(steps.deploy).toHaveBeenCalledTimes(1)
    expect(steps.bootstrap).toHaveBeenCalledTimes(1)
    expect(steps.configureBuild).toHaveBeenCalledTimes(2)
  })
  it('keeps the coordinator dormant until production build configuration succeeds', async () => {
    const steps = {
      status: vi.fn(async () => ({ initialized: false })),
      deploy: vi.fn(async () => {}),
      bootstrap: vi.fn(async () => {}),
      configureBuild: vi.fn(async () => {
        throw new Error('settings failed')
      }),
    }
    await expect(activate(steps)).rejects.toThrow('settings failed')
    expect(steps.bootstrap).not.toHaveBeenCalled()
  })
  it('retries build settings without changing initialized state', async () => {
    const steps = {
      status: vi.fn(async () => ({ initialized: true })),
      deploy: vi.fn(async () => {}),
      bootstrap: vi.fn(async () => {}),
      configureBuild: vi.fn(async () => {}).mockRejectedValueOnce(new Error('unavailable')),
    }
    await expect(activate(steps)).rejects.toThrow('unavailable')
    await activate(steps)
    expect(steps.deploy).not.toHaveBeenCalled()
    expect(steps.bootstrap).not.toHaveBeenCalled()
    expect(steps.configureBuild).toHaveBeenCalledTimes(2)
  })
  it('does not interpret authentication or network failures as a missing Worker', async () => {
    const steps = {
      status: vi.fn(async () => {
        throw new Error('unauthorized')
      }),
      deploy: vi.fn(async () => {}),
      bootstrap: vi.fn(async () => {}),
      configureBuild: vi.fn(async () => {}),
    }
    await expect(activate(steps)).rejects.toThrow('unauthorized')
    expect(steps.deploy).not.toHaveBeenCalled()
    expect(steps.configureBuild).not.toHaveBeenCalled()
  })
})
