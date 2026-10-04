import type { Context, ErrorHandler, NotFoundHandler } from 'hono'

import type { AppEnv } from '@/types.js'

/**
 * Not found handler
 *
 * Returns 404 for unmatched routes.
 */
export const notFoundHandler: NotFoundHandler<AppEnv> = async (c: Context<AppEnv>) => {
  if (c.env.ASSETS) {
    const asset = await c.env.ASSETS.fetch(c.req.raw)
    if (asset.status !== 404) {
      c.var.logCtx.handler = 'asset'
      return new Response(asset.body, asset)
    }
  }

  c.var.logCtx.handler = '404'
  return c.text('Not Found', 404)
}

/**
 * Error handler
 *
 * Catches unhandled exceptions and returns 503.
 * Logs error details via logCtx.
 */
export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  // Accumulate error in log context
  c.var.logCtx.error = {
    name: err.name,
    message: err.message,
    stack: err.stack,
  }
  c.var.logCtx.handler = 'error'

  // Hono preserves existing response headers when replacing a response.
  // A failed cached response must not retain its freshness or entity metadata.
  for (const name of [
    'Age',
    'CF-Cache-Status',
    'ETag',
    'Last-Modified',
    'Expires',
    'Content-Length',
    'Content-Encoding',
    'Content-Range',
    'Accept-Ranges',
    'CDN-Cache-Control',
    'Cloudflare-CDN-Cache-Control',
  ])
    c.header(name, undefined)
  c.header('Cache-Control', 'no-store')
  return c.text('Service Unavailable', 503)
}
