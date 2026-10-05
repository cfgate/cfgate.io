import { describe, expect, it, vi } from 'vitest'
import { activate, activationStatus } from '../../scripts/site/setup'
import { productionTrigger } from '../../scripts/site/provision'

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
      configurationDigest: 'builder',
    }
    expect(
      await activationStatus(Response.json(body), 'builder', false, async () => [])
    ).toMatchObject({ initialized: true })
    await expect(
      activationStatus(Response.json(body), 'different', false, async () => [])
    ).rejects.toThrow('differs')
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
