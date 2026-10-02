# cfgate.io

[![Website](https://img.shields.io/badge/website-cfgate.io-F6821F?style=flat&logo=cloudflare&logoColor=white)](https://cfgate.io) [![License](https://img.shields.io/github/license/cfgate/cfgate.io?style=flat)](LICENSE)

[![Build Status](https://img.shields.io/github/actions/workflow/status/cfgate/cfgate.io/ci.yml?branch=main&style=flat)](https://github.com/cfgate/cfgate.io/actions/workflows/ci.yml) [![Security Scan](https://img.shields.io/github/actions/workflow/status/cfgate/cfgate.io/security-scan.yml?branch=main&style=flat&label=security%20scan)](https://github.com/cfgate/cfgate.io/actions/workflows/security-scan.yml)

Project website, Go vanity imports, and release proxy for [cfgate](https://github.com/cfgate/cfgate).

## Stack

- [Astro](https://astro.build) 7 static site with Tailwind CSS 4
- [Cloudflare Workers](https://workers.cloudflare.com) hosting
- Go vanity import meta tags (`go get cfgate.io/cfgate`)
- Release artifact proxy (`/install.yaml`, `/crds.yaml`, `/crds/*`)

## Development

Use the Node.js version in `.node-version` and the pnpm version pinned by
`packageManager` in `package.json`.

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
and motion roles live in `src/styles/global.css`. Keep copy concrete and direct:
describe what users configure and what cfgate manages, without repeated slogans.
Keep workflow headings and card captions at least 12px across breakpoints.

Anime.js provides a one-shot introduction, respects reduced motion, and cleans up
on page exit. Gloss and highlights are static CSS. Content and navigation work
without JavaScript; the copy button is enabled only when the Clipboard API is
available. Keep the Configure → Secure → Deploy story clear that Access is opt-in
and cfgate reconciles infrastructure configuration, not application workloads.

Before shipping visual changes, inspect all three languages on desktop and mobile,
keyboard focus, reduced motion, and the no-JavaScript fallback. Browser viewport
sizes must be set explicitly when a tiling window manager is active.

## Deploy

Cloudflare Workers Builds connects `cfgate/cfgate.io` to the existing
`cfgate-service-worker` in the inherent.design account. Pushes to `main` build and
deploy to `cfgate.io`. GitHub Actions validates changes; Cloudflare handles
deployment. Merge after PR checks pass: a push to `main` triggers deployment
independently of GitHub Actions.

Settings live under **Workers & Pages → cfgate-service-worker → Settings → Builds**:

| Setting           | Value                       |
| ----------------- | --------------------------- |
| Production branch | `main`                      |
| Root directory    | `/` (repository root)       |
| Build command     | `pnpm run build`            |
| Deploy command    | `pnpm exec wrangler deploy` |

The GitHub App grants repository access; Cloudflare's generated build token
authorizes deployment. Local SOPS credentials and GitHub Actions deployment
secrets are not required. `wrangler.toml` defines the Worker, `dist` assets, and
custom domain. The deploy command above avoids repeating the build already run
by the build command; `pnpm run deploy` remains the manual build-and-deploy path.

[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)
selects Node from `.node-version`; GitHub Actions uses the same file. pnpm's
[version management](https://pnpm.io/settings/cli#pmonfail) selects the
`packageManager` pin in `package.json`. Tool versions are maintained in Git.
When upgrading, update these pins and the lockfile as appropriate, keeping Node
within `engines.node`. Verify the selected versions and deployed commit in
Cloudflare's build history.

Use `pnpm tail` (or its `pnpm tail:prod` alias) for production logs. Production
uses the root Wrangler configuration; there is no named `production` environment.

## Project information

The homepage example and the English `/releases/` and `/project/` pages complement
the existing GitHub documentation. They do not maintain a second installation
guide. Other homepage languages label links to these English pages explicitly.

`src/data/project.json` is a dated, verified fallback snapshot. Static pages render
it without JavaScript. `GET /api/project` refreshes GitHub releases, reads the
published chart tag's `Chart.yaml` for its operator pairing, and retrieves the
operator's latest main-branch CI run. Requests share a six-second deadline; the
Worker caches the result for 30 minutes per Cloudflare location. Concurrent cache
misses share one in-progress refresh within each Worker instance, including the
cache write; separate instances can still refresh independently. The shared value
is serialized JSON, so each request creates its own Worker response stream. Release and CI
failures fall back independently, preserving the snapshot's original timestamps.
The cache is an optimization, not persistent storage. Unauthenticated GitHub rate
limits can result in fallback data. No provider credentials are needed.

The browser uses text nodes to update these fields; it never renders provider
Markdown or HTML. Codecov's main-branch badge and report are separate from the
GitHub CI result. Artifact Hub links provide package discovery. These signals are
not deployment health checks or blanket release certifications.

When refreshing the bundled snapshot, verify published tags and dates against the
two repositories' release APIs, read `appVersion` from the matching chart tag, and
record the CI run URL, full SHA, update time, and retrieval time. Keep `source` set
to `snapshot`; runtime refreshes identify successfully fetched data as `github`.
Do not advance timestamps when retaining old data.

## Dependency maintenance and security

`renovate.json` follows the project's Monday update schedule with manual merges.
Vitest stays below 5, TypeScript below 7, and Node/runtime types on 24.x until the
compatibility constraints above are reevaluated. Other major upgrades can be
proposed for review. Renovate requires its GitHub App to have repository access.

The Security Scan workflow runs Trivy on PRs, main pushes, and weekly schedules.
It scans the source and lockfile, including development dependencies, for HIGH
and CRITICAL vulnerabilities and secrets. Build/cache directories are excluded.
Findings fail the job; SARIF is uploaded for trusted repository runs. Fork PRs
still scan but skip the upload. The action is pinned by commit, and Renovate tracks
the Trivy binary version. Run the equivalent check locally with Trivy 0.74.0:

```sh
trivy fs --config trivy.yaml --scanners vuln,secret --severity HIGH,CRITICAL --exit-code 1 .
```
