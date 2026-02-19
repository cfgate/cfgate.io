# cfgate.io

[![CI](https://img.shields.io/github/actions/workflow/status/cfgate/cfgate.io/ci.yml?style=flat)](https://github.com/cfgate/cfgate.io/actions/workflows/ci.yml) [![License](https://img.shields.io/github/license/cfgate/cfgate.io?style=flat)](LICENSE)

Project website, Go vanity imports, and release proxy for [cfgate](https://github.com/cfgate/cfgate).

## Stack

- [Astro](https://astro.build) static site
- [Cloudflare Workers](https://workers.cloudflare.com) hosting
- Go vanity import meta tags (`go get cfgate.io/cfgate`)
- Release artifact proxy (`/releases/latest/*`)

## Development

```sh
pnpm install
pnpm dev
```

## Deploy

Deployed automatically via Cloudflare Workers Git integration on push to `main`.
