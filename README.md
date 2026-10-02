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

## Deploy

Deployed automatically via Cloudflare Workers Git integration on push to `main`.
