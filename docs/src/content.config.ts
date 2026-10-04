import { defineCollection } from 'astro:content'
import { z } from 'astro/zod'
import { docsLoader } from '@astrojs/starlight/loaders'
import { docsSchema } from '@astrojs/starlight/schema'
export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        cfgate: z.object({
          docId: z.string(),
          targetId: z.string(),
          locale: z.string(),
          route: z.string(),
          version: z.string(),
          source: z.object({ repository: z.string(), commit: z.string(), path: z.string() }),
          generatedFrom: z
            .array(z.object({ repository: z.string(), commit: z.string(), path: z.string() }))
            .optional(),
        }),
      }),
    }),
  }),
}
