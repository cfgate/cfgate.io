import type { APIRoute } from 'astro'
import { locales } from '@/content/home'

export const GET: APIRoute = () =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...locales.map(({ href }) => href), '/releases/', '/project/'].map((href) => `  <url><loc>https://cfgate.io${href}</loc></url>`).join('\n')}
</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } }
  )
