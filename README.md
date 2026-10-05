# cfgate.io

[![Website](https://img.shields.io/badge/website-cfgate.io-F6821F?style=flat&logo=cloudflare&logoColor=white)](https://cfgate.io) [![License](https://img.shields.io/github/license/cfgate/cfgate.io?style=flat)](LICENSE)

[![Build Status](https://img.shields.io/github/actions/workflow/status/cfgate/cfgate.io/ci.yml?branch=main&style=flat)](https://github.com/cfgate/cfgate.io/actions/workflows/ci.yml) [![Security Scan](https://img.shields.io/github/actions/workflow/status/cfgate/cfgate.io/security-scan.yml?branch=main&style=flat&label=security%20scan)](https://github.com/cfgate/cfgate.io/actions/workflows/security-scan.yml)

cfgate.io serves the project website, released operator documentation, project information, Go vanity imports and Kubernetes release manifests through one Cloudflare Worker.

[Website](https://cfgate.io) · [Released documentation](https://cfgate.io/docs/) · [Architecture](docs/architecture.md) · [Deployment and recovery](docs/operations.md)

## Local development

Use `.node-version` and the `packageManager` pin in `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm exec wrangler dev --local --var ENVIRONMENT:development
```

This builds the marketing pages and one released documentation edition, then serves the complete Worker locally. Sources come from the commits in `docs/bootstrap.json`; a local build never publishes or claims production work. Set a read-only `GITHUB_TOKEN` if unauthenticated GitHub limits interrupt source retrieval.

For page-only development, use `pnpm dev` for the marketing site or `pnpm docs:dev` for Starlight. A complete custom build plan can be supplied with `pnpm build --plan /path/to/plan.json`; its renderer commit and policy digest must match the checkout.

## Validation

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm exec wrangler versions upload --dry-run
```

The build validates pinned schemas, complete example resources, internal documentation links, assembled routes and asset references. Partial YAML snippets are preserved as authored; schema checks are not Kubernetes admission, CEL execution or live operator tests.

Worker tests run in the local Cloudflare runtime. Node tests cover source selection, imports, historical fixtures, publication races and interruption recovery. Build before running route tests. Release-proxy smoke tests contact GitHub and accept upstream errors; they establish route registration rather than artifact availability.

## Application structure

| Location                                            | Responsibility                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| `src/pages`, `src/components`, `src/content`        | Marketing pages, project views and localized copy                    |
| `src/styles/tokens.css`                             | Shared colors, type, spacing, sizing and interaction roles           |
| `src/styles/global.css`                             | Homepage and project-page compositions                               |
| `src/index.ts`, `src/handlers`                      | Worker routing, APIs, assets and proxies                             |
| `src/docs`                                          | Validated source contracts, release policy and GitHub reads          |
| `src/runtime`                                       | Durable coordination and guarded Cloudflare publication              |
| `scripts/docs`                                      | Pinned-source preparation and reference generation                   |
| `scripts/site`                                      | Whole-site build, assembly, validation, activation and publication   |
| `docs/astro.config.ts`, `docs/integration`          | Isolated Starlight renderer and cfgate integration                   |
| `deployment.json`, `.sops.yaml`, `secrets.enc.yaml` | Account and activation configuration; credentials encrypted with age |
| `docs/bootstrap.json`                               | Explicit local/initial source pins                                   |
| `src/data/project.json`                             | Dated project-data fallback                                          |

The marketing homepage stays at `/`. Documentation lives at `/docs/`; no `/docs/next/` or historical edition is published initially. Source links identify the actual release commit. Generated references identify their schema or chart source.

## Refresh and publication

The Durable Object owns project observations and build coordination. Pages initially render bundled fallback data, then request `/api/project` once per visit. The endpoint returns stored information immediately and signals a background check when stale. Release and CI failures preserve their last successful data separately.

Access checks use a 30-minute threshold. An hourly schedule and signed GitHub release webhooks provide independent triggers. Changed normalized inputs request a Cloudflare Workers Build; unchanged observations do not. A successful compilation is uploaded as a candidate and published only if its release, renderer, generation and lease remain eligible.

The served documentation version comes from the deployed manifest, never from the newest observed release. Failed or superseded builds leave the previous edition online. Run `pnpm run setup` to inspect the one-time activation plan. [Operations](docs/operations.md) describes token permissions, encrypted preparation with `--prepare`, hook provisioning with `--provision`, and activation with `--apply --install` after merging. The repository preserves desired setup configuration; the Durable Object retains live publication state. Setup is a local administrative operation; routine publication uses `pnpm run deploy` inside Workers Builds. Pull requests and GitHub Actions do not publish production.

When the coordinator binding is absent, previews retain the legacy project-data cache and dated snapshot fallback. The browser revalidates the API on each visit; its per-location Worker cache lasts 30 minutes. This fallback cache is not publication authority.

## Other routes

| Route                                                  | Behavior                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| `/api/project`                                         | Observed releases, chart pairing, CI and served-documentation identity |
| `/docs/manifest.json`                                  | Static source and renderer provenance for this deployment              |
| `/api/hooks/github`                                    | Signed, bounded release/workflow notifications                         |
| `/internal/docs/*`                                     | Authenticated build and administrative operations                      |
| `/install.yaml`, `/crds.yaml`, `/crds/*`               | GitHub `releases/latest` asset proxy with a one-hour upstream cache    |
| `/?go-get=1`, `/cfgate?go-get=1`, `/cfgate/*?go-get=1` | Go import metadata                                                     |
| `/cfgate`, `/cfgate/*`                                 | Browser redirects to pkg.go.dev                                        |

The release proxy remains independent of documentation selection. Use version-specific GitHub download links when installation must match a particular edition.

## Design and writing

Reuse semantic roles for color, type, spacing, sizing, borders and motion. Derive repeated values from shared bases where that preserves a clear relationship. Keep homepage composition rules separate from documentation styles; retain Starlight's reading layout, keyboard navigation, search and mobile controls.

Describe what users configure and what cfgate manages. Keep product guidance in the product repository and website deployment instructions here. Imported release prose is not silently replaced with newer `main` content. Configuration snippets and operational warnings retain their source identity.

Homepage motion pauses offscreen and in hidden tabs and respects reduced-motion preferences. Documentation navigation and content work without JavaScript; search and clipboard controls require it.

## Security and dependencies

Renovate proposes dependency updates. CI runs lint, type checks, builds and tests. Trivy checks vulnerabilities and secrets. The narrowly scoped `http-cache-semantics` advisory exception in `.trivyignore.yaml` documents its build-only applicability and expiry; re-evaluate it when that dependency or Astro's image-cache behavior changes.

Keep read-only source credentials, webhook secrets, build authentication and deployment authority separate. Preview builds receive no production publication credentials. Review Cloudflare zone cache rules separately from repository headers when investigating stale responses.

## License

[Apache-2.0](LICENSE).
