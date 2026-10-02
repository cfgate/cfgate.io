# cfgate.io

[![CI](https://img.shields.io/github/actions/workflow/status/cfgate/cfgate.io/ci.yml?style=flat)](https://github.com/cfgate/cfgate.io/actions/workflows/ci.yml) [![License](https://img.shields.io/github/license/cfgate/cfgate.io?style=flat)](LICENSE)

Project website, Go vanity imports, and release proxy for [cfgate](https://github.com/cfgate/cfgate).

## Stack

- [Astro](https://astro.build) 7 static site with Tailwind CSS 4
- [Cloudflare Workers](https://workers.cloudflare.com) hosting
- Go vanity import meta tags (`go get cfgate.io/cfgate`)
- Release artifact proxy (`/install.yaml`, `/crds.yaml`, `/crds/*`)

## Development

Use Node.js 24 and the pnpm version pinned in `package.json`.

```sh
pnpm install
pnpm dev
```

`pnpm dev` previews Astro pages only. To exercise the Worker routes and built
assets together:

```sh
pnpm build
pnpm exec wrangler dev --local
```

## Validation

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm exec wrangler deploy --dry-run
```

Tests run locally in the Workers runtime using `@cloudflare/vitest-plugin`.
The route suite needs built assets; its release-proxy smoke checks contact GitHub
and accept upstream errors, so they do not establish release artifact availability.

Keep Vitest and its runner/snapshot packages on compatible 4.1 releases until the
Cloudflare plugin supports Vitest 5. TypeScript 6 is the supported intersection of
Astro's checker and typescript-eslint; TypeScript 7 is not yet supported by those
packages. Node types follow the Node 24 runtime. pnpm 12 uses `allowBuilds` in
`pnpm-workspace.yaml`; only the existing native build tools are allowed. Explicit
release-age exceptions are version-scoped to the selected upgrades.

## Website design

The landing page is static Astro, with shared English, Chinese, and Hindi copy in
`src/content/home.ts`. `Home.astro` composes the page; `WorkflowArt.astro` and
`Icon.astro` supply the small reusable illustrations. Semantic color, typography,
and motion roles live in `src/styles/global.css`.

Anime.js provides a one-shot introduction, respects reduced motion, and cleans up
on page exit. Gloss and highlights are static CSS. Content and navigation work
without JavaScript; the copy button is enabled only when the Clipboard API is
available. Keep the Configure → Secure → Deploy story clear that Access is opt-in
and cfgate reconciles infrastructure configuration, not application workloads.

Before shipping visual changes, inspect all three languages on desktop and mobile,
keyboard focus, reduced motion, and the no-JavaScript fallback. Browser viewport
sizes must be set explicitly when a tiling window manager is active.

## Deploy

Deployed automatically via Cloudflare Workers Git integration on push to `main`.
