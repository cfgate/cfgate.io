import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

describe('assembled documentation routes', () => {
  it('serves pinned docs, search assets and a matching static manifest', async () => {
    const response = await exports.default.fetch('https://cfgate.io/docs/manifest.json')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-cache')
    const manifest = (await response.json()) as {
      targets: { operatorVersion: string }[]
      pages: { route: string }[]
    }
    expect(manifest.targets).toHaveLength(1)
    const page = await exports.default.fetch('https://cfgate.io/docs/reference/cloudflare-tunnel/')
    const html = await page.text()
    expect(page.status).toBe(200)
    expect(html).toContain(manifest.targets[0].operatorVersion)
    expect(html).toContain('View released source')
    expect(html).not.toContain('/docs/docs/')
    const search = await exports.default.fetch('https://cfgate.io/docs/pagefind/pagefind.js')
    expect(search.status).toBe(200)
    expect(
      manifest.pages.every((page) => !page.route.includes('/next/') && !page.route.includes('/v0.'))
    ).toBe(true)
  })
  it('does not redirect an unpublished historical edition to current content', async () => {
    const response = await exports.default.fetch(
      'https://cfgate.io/docs/v0.1.0/reference/cloudflare-tunnel/'
    )
    expect(response.status).toBe(404)
    expect(response.headers.get('Location')).toBeNull()
  })
})
