/** Compare desired credentials without exposing values through the administrative API. */
export const activationKeys = [
  'DOCS_ACCOUNT_ID',
  'DOCS_ADMIN_TOKEN',
  'DOCS_BUILDER_TOKEN',
  'DOCS_BUILD_HOOK',
  'DOCS_DEPLOY_TOKEN',
  'GITHUB_WEBHOOK_SECRET',
  'GITHUB_READ_TOKEN',
] as const
export async function activationDigest(
  values: Partial<Record<(typeof activationKeys)[number], string>>
): Promise<string> {
  const encoded = JSON.stringify(activationKeys.map((key) => [key, values[key] ?? '']))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encoded))
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}
