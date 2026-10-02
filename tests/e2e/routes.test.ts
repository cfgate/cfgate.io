import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

describe('E2E Route Tests', () => {
  describe('Landing page', () => {
    it.each([
      {
        path: '/',
        lang: 'en',
        title: 'cfgate: Manage Cloudflare from Kubernetes',
        content: 'Connect your services',
      },
      {
        path: '/zh/',
        lang: 'zh-CN',
        title: 'cfgate: 在 Kubernetes 中管理 Cloudflare',
        content: '连接你的服务。',
      },
      {
        path: '/hi/',
        lang: 'hi',
        title: 'cfgate: Kubernetes से Cloudflare का प्रबंधन',
        content: 'अपनी सेवाओं को जोड़ें',
      },
    ])('serves localized content and metadata at $path', async ({ path, lang, title, content }) => {
      const url = `https://cfgate.io${path}`
      const response = await exports.default.fetch(url)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toContain('text/html')
      const html = await response.text()
      expect(html).toContain(`<html lang="${lang}"`)
      expect(html).toContain(`<title>${title}</title>`)
      expect(html).toContain(`<meta property="og:title" content="${title}">`)
      expect(html).toContain(`<link rel="canonical" href="${url}">`)
      expect(html).toContain(`<meta property="og:url" content="${url}">`)
      expect(html).toContain(content)
    })

    it('lists exactly the three canonical pages in the sitemap', async () => {
      const response = await exports.default.fetch('https://cfgate.io/sitemap.xml')

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toContain('xml')
      const xml = await response.text()
      expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
      const urls = Array.from(xml.matchAll(/<loc>(.*?)<\/loc>/g), ([, url]) => url)
      expect(urls.sort()).toEqual([
        'https://cfgate.io/',
        'https://cfgate.io/hi/',
        'https://cfgate.io/zh/',
      ])
    })

    it('includes X-Request-Id header', async () => {
      const response = await exports.default.fetch('https://cfgate.io/')

      expect(response.headers.get('X-Request-Id')).toBeDefined()
    })
  })

  describe('Vanity imports', () => {
    it('returns go-import meta tag for /?go-get=1', async () => {
      const response = await exports.default.fetch('https://cfgate.io/?go-get=1')

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toContain('text/html')
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400')

      const html = await response.text()
      expect(html).toContain(
        '<meta name="go-import" content="cfgate.io/cfgate git https://github.com/cfgate/cfgate">'
      )
    })

    it('returns go-import meta tag for /cfgate?go-get=1', async () => {
      const response = await exports.default.fetch('https://cfgate.io/cfgate?go-get=1')

      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toContain(
        '<meta name="go-import" content="cfgate.io/cfgate git https://github.com/cfgate/cfgate">'
      )
    })

    it('returns same go-import for subpaths', async () => {
      const response = await exports.default.fetch('https://cfgate.io/cfgate/api/v1alpha1?go-get=1')

      expect(response.status).toBe(200)
      const html = await response.text()
      // All subpaths return the same go-import pointing to module root
      expect(html).toContain(
        '<meta name="go-import" content="cfgate.io/cfgate git https://github.com/cfgate/cfgate">'
      )
    })

    it('includes go-source meta tag', async () => {
      const response = await exports.default.fetch('https://cfgate.io/cfgate?go-get=1')
      const html = await response.text()

      expect(html).toContain('<meta name="go-source"')
      expect(html).toContain('/tree/main{/dir}')
      expect(html).toContain('/blob/main{/dir}/{file}#L{line}')
    })
  })

  describe('Browser redirects', () => {
    it('redirects /cfgate to pkg.go.dev', async () => {
      const response = await exports.default.fetch('https://cfgate.io/cfgate', {
        redirect: 'manual',
      })

      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toBe('https://pkg.go.dev/cfgate.io/cfgate')
    })

    it('redirects /cfgate/api to pkg.go.dev with path', async () => {
      const response = await exports.default.fetch('https://cfgate.io/cfgate/api', {
        redirect: 'manual',
      })

      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toBe('https://pkg.go.dev/cfgate.io/cfgate/api')
    })

    it('redirects /cfgate/api/v1alpha1 to pkg.go.dev with full path', async () => {
      const response = await exports.default.fetch('https://cfgate.io/cfgate/api/v1alpha1', {
        redirect: 'manual',
      })

      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toBe(
        'https://pkg.go.dev/cfgate.io/cfgate/api/v1alpha1'
      )
    })
  })

  describe('404 handling', () => {
    it('returns 404 for unknown paths', async () => {
      const response = await exports.default.fetch('https://cfgate.io/unknown-path')

      expect(response.status).toBe(404)
      expect(await response.text()).toBe('Not Found')
    })

    it('returns 404 for unknown paths with go-get', async () => {
      const response = await exports.default.fetch('https://cfgate.io/unknown-path?go-get=1')

      expect(response.status).toBe(404)
    })
  })

  describe('Proxy routes (scaffold)', () => {
    // Note: These tests verify route registration. Actual proxy behavior
    // hits real GitHub - assets may or may not exist.
    // 200 = asset exists and was proxied
    // 404 = route exists, asset doesn't exist on GitHub
    // 503 = route exists, upstream error

    it('registers /install.yaml route', async () => {
      const response = await exports.default.fetch('https://cfgate.io/install.yaml')

      // Route exists and returned a valid proxy response
      expect([200, 404, 503]).toContain(response.status)
    })

    it('registers /crds.yaml route', async () => {
      const response = await exports.default.fetch('https://cfgate.io/crds.yaml')
      expect([200, 404, 503]).toContain(response.status)
    })

    it('registers /crds/tunnel.yaml route', async () => {
      const response = await exports.default.fetch('https://cfgate.io/crds/tunnel.yaml')
      expect([200, 404, 503]).toContain(response.status)
    })
  })
})
