import { mkdtemp, rm, chmod, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { activate, credentials, productionTrigger } from '../../scripts/site/setup'

const id = '11111111-1111-4111-8111-111111111111'
describe('local activation', () => {
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
    expect(steps.configureBuild).not.toHaveBeenCalled()
    await activate(steps)
    expect(steps.deploy).toHaveBeenCalledTimes(1)
    expect(steps.bootstrap).toHaveBeenCalledTimes(1)
    expect(steps.configureBuild).toHaveBeenCalledTimes(1)
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
