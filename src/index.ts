import type { AppEnv } from '@/types.js'
import { Hono } from 'hono'
import { docsBuildHandler, githubWebhook, coordinator, signalAccess } from './handlers/docs'
import type { Bindings } from './types'
export { ProjectCoordinator } from './runtime/project-coordinator'

// Middleware
import { loggerMiddleware } from '@/middleware/logger.js'
import { requestIdMiddleware } from '@/middleware/request-id.js'

// Handlers
import { errorHandler, notFoundHandler } from '@/handlers/error.js'
import { projectHandler } from '@/handlers/project.js'
import { landingHandler } from '@/handlers/landing.js'
import { PROXY_PATHS, proxyHandler } from '@/handlers/proxy.js'
import { redirectHandler } from '@/handlers/redirect.js'
import { isGoGetRequest, vanityHandler } from '@/handlers/vanity.js'

/**
 * cfgate.io Cloudflare Worker
 *
 * Serves:
 * - Go vanity imports for cfgate.io/cfgate
 * - GitHub release proxy for install manifests and CRDs
 * - Browser redirects to pkg.go.dev
 */
const app = new Hono<AppEnv>()

// Middleware stack (order matters)
app.use('*', loggerMiddleware)
app.use('*', requestIdMiddleware)

// Error handlers
app.onError(errorHandler)
app.notFound(notFoundHandler)

// Proxy routes (explicit paths, checked first)
for (const path in PROXY_PATHS) {
  app.get(path, proxyHandler)
}

app.get('/api/project', projectHandler)
app.post('/api/hooks/github', githubWebhook)
app.post('/internal/docs/*', docsBuildHandler)
app.use('*', async (c, next) => {
  if (c.req.method === 'GET' && (c.req.path === '/' || c.req.path.startsWith('/docs/')))
    signalAccess(c)
  await next()
  if (c.req.path.startsWith('/docs/')) {
    c.header(
      'Cache-Control',
      c.req.path.includes('/_astro/') || c.req.path.includes('/source-assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache'
    )
    if (c.req.path.endsWith('.svg'))
      c.header(
        'Content-Security-Policy',
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox"
      )
  }
})

// Root path handler
app.get('/', (c) => {
  if (isGoGetRequest(c)) {
    // Go module verification request
    return vanityHandler(c)
  }
  // Browser request
  return landingHandler(c)
})

// /cfgate routes (conditional on go-get query param)
app.get('/cfgate', (c) => {
  if (isGoGetRequest(c)) {
    return vanityHandler(c)
  }
  return redirectHandler(c)
})

// /cfgate/* wildcard (conditional on go-get query param)
app.get('/cfgate/*', (c) => {
  if (isGoGetRequest(c)) {
    return vanityHandler(c)
  }
  return redirectHandler(c)
})

// Export app type for RPC (if needed in future)
export type AppType = typeof app

export default Object.assign(app, {
  async scheduled(_event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    if (env.ENVIRONMENT === 'production')
      ctx.waitUntil(
        coordinator(env)?.fetch('https://coordinator/signal', { method: 'POST', body: '{}' }) ??
          Promise.resolve()
      )
  },
})
