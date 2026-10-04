# cfgate.io

[![Website](https://img.shields.io/badge/website-cfgate.io-F6821F?style=flat&logo=cloudflare&logoColor=white)](https://cfgate.io) [![License](https://img.shields.io/github/license/cfgate/cfgate.io?style=flat)](LICENSE)

[![Build Status](https://img.shields.io/github/actions/workflow/status/cfgate/cfgate.io/ci.yml?branch=main&style=flat)](https://github.com/cfgate/cfgate.io/actions/workflows/ci.yml) [![Security Scan](https://img.shields.io/github/actions/workflow/status/cfgate/cfgate.io/security-scan.yml?branch=main&style=flat&label=security%20scan)](https://github.com/cfgate/cfgate.io/actions/workflows/security-scan.yml)

This repository serves the [cfgate website](https://cfgate.io), project information,
Go vanity imports, and Kubernetes release manifests through a Cloudflare Worker.
Operator installation and configuration belong in the
[cfgate documentation](https://github.com/cfgate/cfgate/tree/main/docs).

## Local development

Use `.node-version` for Node.js and the `packageManager` pin in `package.json` for
pnpm. Install dependencies and start the page preview:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The Astro preview serves pages. To test the Worker routes and built pages together:

```sh
pnpm build
pnpm exec wrangler dev --local
```

Neither preview deploys to Cloudflare. Project information uses public GitHub
endpoints; it does not require a provider token.

## Validation

Run the same checks used for pull requests, then validate the Worker bundle:

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm exec wrangler deploy --dry-run
```

Tests use the local Workers runtime through `@cloudflare/vitest-plugin`. Build the
pages before running the route suite. Release-proxy smoke tests contact GitHub and
accept upstream errors; they test route registration, not artifact availability.
The project-cache regressions use the application middleware, including request
IDs, and check cache misses, cache hits, concurrent requests, and dated fallbacks.

## Application structure

| Location                | Responsibility                                           |
| ----------------------- | -------------------------------------------------------- |
| `src/pages/`            | Static Astro pages                                       |
| `src/components/`       | Shared page structure, icons, and workflow illustrations |
| `src/content/`          | English, Chinese, and Hindi copy                         |
| `src/styles/global.css` | Semantic color, typography, and motion styles            |
| `src/scripts/`          | Browser enhancements and project-data refresh            |
| `src/index.ts`          | Worker routes and middleware                             |
| `src/handlers/`         | Project API, asset serving, redirects, and release proxy |
| `src/lib/project.ts`    | GitHub data fetching and validation                      |
| `src/data/project.json` | Dated fallback project information                       |

Astro renders the pages; Tailwind CSS supplies styling. The Worker serves the
built `dist` directory and these additional routes:

| Route                                                  | Behavior                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `/api/project`                                         | Release information, chart/operator pairing, and operator CI status                               |
| `/install.yaml`, `/crds.yaml`, `/crds/*`               | Proxy the corresponding GitHub `releases/latest` asset; upstream fetch cache lifetime is one hour |
| `/?go-get=1`, `/cfgate?go-get=1`, `/cfgate/*?go-get=1` | Go import metadata for `cfgate.io/cfgate`                                                         |
| `/cfgate`, `/cfgate/*`                                 | Browser redirects to pkg.go.dev                                                                   |

For a specific operator version, use that GitHub release's download links. The
release proxy does not select a version from the website's project-data response.

## Project-data refresh

Pages initially render the bundled snapshot. JavaScript requests `/api/project`
once per page load, with an eight-second timeout; it does not poll while the page
stays open. If the request fails, the displayed content remains unchanged.

On a Worker cache miss, the API fetches the operator and chart release lists,
reads `appVersion` from the published chart's `Chart.yaml`, and reads the latest
operator CI run on `main`. Those requests share a six-second deadline. Each list
contains up to three published releases, including prereleases. Release data and
CI data fall back independently if fetching or validation fails. Fallback data
keeps its original timestamp rather than presenting an old value as newly checked.

The Worker stores the resulting JSON for **30 minutes per Cloudflare location**,
including responses containing fallback data. The next request after expiry
refreshes it; there is no timer or release webhook. Query strings share the same
cache key. Concurrent misses share one refresh within a Worker instance, but
separate instances or locations may fetch independently. This cache is temporary
and can be evicted before its lifetime expires.

Browser responses use `Cache-Control: no-cache`, so subsequent page loads
revalidate with the Worker instead of adding a browser freshness period. The
stored Worker response has its own 30-minute cache directive. Request IDs are
added to a writable response; they are not stored in the project cache. Unhandled
errors return 503 with `no-store` and without stale cache or entity headers.

Cloudflare zone settings are separate from this repository. The observed zone
Browser Cache TTL is four hours; it previously lengthened the browser-facing
`max-age`. After deploying cache changes, verify the live headers rather than
assuming the repository alone controls every cache layer. Keep API errors
uncacheable and avoid a zone rule that overrides the API's revalidation policy.

Successful live sections report `source: github`; bundled sections report
`source: snapshot`. The page uses text nodes to display these values. Codecov
badges and Artifact Hub links are separate signals, not deployment health checks.

To update the snapshot, verify release tags, publication dates, the chart's
operator pairing, and the CI run's SHA, URL, and time. Save the retrieval time and
keep `source: snapshot`. Do not change timestamps for data that was not rechecked.

## Design and writing

Use semantic styles and shared components rather than page-specific copies.
Describe what users configure and what cfgate manages. Access protection is
opt-in; cfgate reconciles Cloudflare configuration and connector workloads, not
application Deployments. Keep installation instructions in the operator docs so
there is one maintained source for them.

Workflow captions and headings remain at least 12px across breakpoints. Anime.js
runs the introduction; CSS supplies card drift and hover or viewport motion.
Motion pauses offscreen and in hidden tabs, respects reduced-motion preferences,
and resumes after back/forward navigation. Gloss and highlights remain static.
Navigation and content work without JavaScript; copying requires the Clipboard API.

For visual changes, check all three languages at desktop and mobile widths,
keyboard focus, reduced motion, and disabled JavaScript. Set viewport dimensions
explicitly when a tiling window manager can resize the browser.

## Deployment

Cloudflare Workers Builds connects `cfgate/cfgate.io` to `cfgate-service-worker` in
the inherent.design account. A push to `main` builds and deploys independently of
GitHub Actions, so merge only after PR checks pass. GitHub Actions validates the
source; it does not publish the website.

The Worker's **Settings → Builds** configuration is:

| Setting           | Value                       |
| ----------------- | --------------------------- |
| Production branch | `main`                      |
| Root directory    | `/`                         |
| Build command     | `pnpm run build`            |
| Deploy command    | `pnpm exec wrangler deploy` |

The GitHub App grants repository access, and Cloudflare's build token authorizes
deployment. This connection does not use local SOPS credentials or GitHub Actions
deployment secrets. `wrangler.toml` defines the Worker, static assets, and domain.
`pnpm deploy` is the manual build-and-deploy path; do not use it as the deploy
command after Workers Builds has already run the build.

[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)
selects Node from `.node-version`; CI uses the same file. pnpm selects the
`packageManager` version in `package.json`. Keep these pins, `engines.node`, and
the lockfile consistent. Verify tool versions and the deployed commit in the
Cloudflare build history after an upgrade.

`pnpm tail` streams production logs when local Cloudflare authentication is
available. `pnpm tail:prod` is an alias; there is no named `production` environment.
To diagnose project refresh, inspect both `/api/project` and the page: successful
HTML delivery does not establish that the API refreshed its data.

## Dependency and security maintenance

Renovate proposes updates on Mondays; merges are manual. The current compatibility
constraints keep Vitest and its runner/snapshot packages on 4.1, TypeScript below
7, and Node/runtime types on 24.x. Recheck the Cloudflare test plugin, Astro checker,
and typescript-eslint before relaxing those constraints. Other major upgrades can
be proposed. Renovate's GitHub App must have access to the repository.

pnpm 12 uses `allowBuilds` in `pnpm-workspace.yaml` to permit the required native
build tools. Keep release-age exceptions scoped to reviewed versions.

The Security Scan workflow runs on PRs, main pushes, and weekly schedules. Trivy
checks source and lockfiles, including development dependencies, for HIGH and
CRITICAL vulnerabilities and secrets. Findings fail the job. Trusted runs upload
SARIF; fork PRs scan without uploading it. The action is pinned by commit, and
Renovate tracks the Trivy version. The equivalent local command is:

```sh
trivy fs --config trivy.yaml --scanners vuln,secret --severity HIGH,CRITICAL --exit-code 1 .
```

The time-limited exception in `.trivyignore.yaml` covers only
`http-cache-semantics@4.2.0` in the lockfile (CVE-2026-93748). Astro uses it to
calculate build-time image freshness; it does not pass visitor headers to the
reported stale-response path. The deployed Hono Worker does not include the
package. Reassess this exception before adding SSR or runtime image handling,
when updating Astro, or when it expires. The
[upstream discussion](https://github.com/kornelski/http-cache-semantics/issues/56)
is disputed; the exception is based on this project's usage, not a claim that the
package is fixed. Other findings still fail the scan.

## License

[Apache-2.0](LICENSE).
