import { env } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { expect, it } from 'vitest'
import { Coordinator } from '../../../src/runtime/coordinator'
import { Github } from '../../../src/docs/github'
import { makePlan, targetSchema } from '../../../src/docs/contracts'
import bootstrap from '../../../docs/bootstrap.json'

it('initializes against real Durable Object storage and schedules recovery', async () => {
  const stub = env.PROJECT_COORDINATOR.get(env.PROJECT_COORDINATOR.newUniqueId())
  const plan = await makePlan('a'.repeat(40), 'b'.repeat(64), [targetSchema.parse(bootstrap)])
  await runInDurableObject(stub, async (_, state) => {
    const coordinator = new Coordinator(state.storage, new Github(), {
      activeVersion: async () => 'version',
      requestBuild: async () => 'build',
      verifyCandidate: async () => {},
      deploy: async () => {},
    })
    await coordinator.bootstrap(plan, 'version', new Date().toISOString())
    expect((await coordinator.state()).initialized).toBe(true)
    expect(await state.storage.getAlarm()).not.toBeNull()
    await state.storage.deleteAlarm()
  })
})
