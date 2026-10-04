import { Hono } from 'hono'
import { expect, it } from 'vitest'
import { errorHandler } from '../../../src/handlers/error'
import { loggerMiddleware } from '../../../src/middleware/logger'
import { requestIdMiddleware } from '../../../src/middleware/request-id'
import type { AppEnv } from '../../../src/types'

it('does not preserve cache or entity headers after a downstream response fails', async () => {
  const app = new Hono<AppEnv>()
  app.use('*', loggerMiddleware, requestIdMiddleware)
  app.onError(errorHandler)
  app.use('*', async (_c, next) => {
    await next()
    throw new Error('after response')
  })
  const stale = {
    Age: '120',
    'CF-Cache-Status': 'HIT',
    ETag: 'old',
    Expires: 'Wed, 01 Jan 2031 00:00:00 GMT',
    'Last-Modified': 'Wed, 01 Jan 2020 00:00:00 GMT',
    'Content-Length': '999',
    'Content-Encoding': 'gzip',
    'Content-Range': 'bytes 0-9/999',
    'Accept-Ranges': 'bytes',
    'CDN-Cache-Control': 'max-age=3600',
    'Cloudflare-CDN-Cache-Control': 'max-age=3600',
  }
  app.get(
    '/',
    () =>
      new Response('cached data', {
        headers: { ...stale, 'Cache-Control': 'public, max-age=1800' },
      })
  )
  const response = await app.request('https://cfgate.io/')
  expect(response.status).toBe(503)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('Content-Type')).toContain('text/plain')
  for (const name of Object.keys(stale)) expect(response.headers.has(name), name).toBe(false)
  expect(response.headers.get('X-Request-Id')).toBeTruthy()
  expect(await response.text()).toBe('Service Unavailable')
})
