/**
 * Type definitions for cfgate.io Worker
 */

/**
 * Environment bindings from wrangler.toml
 */
export interface Bindings {
  ENVIRONMENT?: 'development' | 'staging' | 'production'
  ASSETS?: Fetcher
  CF_VERSION_METADATA?: { id: string }
  PROJECT_COORDINATOR?: DurableObjectNamespace
  GITHUB_READ_TOKEN?: string
  GITHUB_WEBHOOK_SECRET?: string
  DOCS_ACCOUNT_ID?: string
  DOCS_DEPLOY_TOKEN?: string
  DOCS_BUILD_HOOK?: string
  DOCS_BUILDER_TOKEN?: string
  DOCS_ADMIN_TOKEN?: string
}

/**
 * Request-scoped variables set by middleware
 */
export interface Variables {
  requestId: string
  logCtx: LogContext
}

/**
 * Event logging context accumulated throughout request lifecycle
 */
export interface LogContext {
  requestId: string
  cfRay: string
  method: string
  path: string
  timestamp: string
  handler?: string
  upstream?: string
  status?: number
  durationMs?: number
  error?: ErrorInfo
}

/**
 * Error details for logging
 */
export interface ErrorInfo {
  name: string
  message: string
  stack?: string
}

/**
 * Typed Hono environment
 */
export interface AppEnv {
  Bindings: Bindings
  Variables: Variables
}
