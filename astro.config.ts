import { defineConfig } from 'astro/config'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  output: 'static',
  // Preserve HTML whitespace across the Astro 7 compiler migration.
  compressHTML: true,
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'zh', 'hi'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
})
