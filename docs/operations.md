# Documentation operations

Production documentation builds run in Cloudflare Workers Builds. GitHub Actions validates pull requests. Production activation requires the migration below; merging the code alone does not configure deploy hooks or credentials.

## First deployment

Pause automatic production builds while introducing the coordinator. Keep the current website deployment online. After the reviewed code reaches `main`:

1. Sync a clean local `main` checkout. Review `docs/bootstrap.json`; its commits must identify the intended released operator and matching chart.
2. Run `pnpm install --frozen-lockfile`, `pnpm build` and `pnpm test` locally. The local build uses the explicit bootstrap pins and does not claim production work.
3. Deploy once with `pnpm deploy:bootstrap`. This runs `wrangler deploy`, which installs the `ProjectCoordinator` Durable Object migration. Routine version upload cannot perform that lifecycle migration.
4. Install the production Worker secrets below. Create a deploy hook for the website's `main` branch in Workers **Settings > Builds > Deploy Hooks**. Keep its URL secret.
5. Configure the production build command as `pnpm build` and deploy command as `pnpm docs:publish`. Set the production build's `DOCS_BUILDER_TOKEN` to the same secret used by the Worker. Keep the preview command as `npx wrangler preview`; previews use the checked-in pins and have no coordinator binding.
6. Seed the coordinator from the deployed asset manifest, then enable automatic builds and repository webhooks.

The seeding request has no caller-supplied source plan. The Worker reads its own assets and version metadata, and the coordinator checks that Cloudflare is serving that version:

```sh
curl --fail-with-body -X POST https://cfgate.io/internal/docs/bootstrap \
  -H "Authorization: Bearer $DOCS_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' --data '{}'
```

Set secrets through the dashboard or interactive Wrangler prompts, for example `pnpm exec wrangler secret put DOCS_BUILDER_TOKEN`. Do not commit them or print them in build logs.

| Secret                  | Installed in                                       | Purpose                                                                         |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------- |
| `GITHUB_READ_TOKEN`     | Production Worker                                  | Optional read-only GitHub token for metadata                                    |
| `GITHUB_TOKEN`          | Build environment                                  | Optional read-only token for pinned source retrieval                            |
| `GITHUB_WEBHOOK_SECRET` | Production Worker and repository webhook settings  | HMAC verification                                                               |
| `DOCS_BUILD_HOOK`       | Production Worker                                  | Secret Cloudflare build-hook URL for `main`                                     |
| `DOCS_ACCOUNT_ID`       | Production Worker                                  | Cloudflare account containing the website Worker                                |
| `DOCS_DEPLOY_TOKEN`     | Production Worker                                  | Cloudflare Workers Scripts read/write for candidate verification and deployment |
| `DOCS_BUILDER_TOKEN`    | Production Worker and production build environment | Claims, candidates and failure reports                                          |
| `DOCS_ADMIN_TOKEN`      | Production Worker and administrator's secret store | Bootstrap, source checks and explicit rebuilds                                  |

Workers Builds also needs its normal Cloudflare upload credentials. Scope credentials to the smallest available account/repository permissions. Build jobs remain trusted: their Cloudflare upload credential can have broader platform capabilities than the application guard. Do not supply production build or deployment secrets to pull-request builds. The repository's preview configuration removes the coordinator binding and uses `ENVIRONMENT=staging`; mutation handlers also require the production hostname.

Use `.node-version` and `package.json`'s `packageManager` pin for build tools. No manually maintained Node/pnpm version variables are required.

## GitHub notifications

Create repository webhooks on `cfgate/cfgate` and `cfgate/helm-chart` with:

- payload URL `https://cfgate.io/api/hooks/github`
- content type `application/json`
- the shared `GITHUB_WEBHOOK_SECRET`
- release events; optionally workflow-run completion events for project CI information

Do not subscribe to every event. Product pushes are ignored while `next` is disabled. The handler verifies the original UTF-8 request body, expected repository, event/action and delivery ID, persists a bounded receipt, then returns 202. Duplicate and out-of-order events request authoritative observation; they never directly select a deployment.

The 64 KiB webhook body limit is intentional. Oversized events are rejected; the hourly schedule still discovers releases. Review GitHub delivery results when diagnosing missed notifications.

## Routine builds

A production Workers Build claims a plan using its build UUID and checked-out renderer commit. Claims reject an older renderer, unavailable sources or another active build lease. The builder fetches only that plan's sources, checks the complete site, records an output digest, and uploads a Worker version. The coordinator rechecks release eligibility and current website `main` before publishing at 100 percent traffic.

No product-repository documentation workflow is needed. Do not replace the production deploy command with `wrangler deploy`: that bypasses candidate eligibility checks. Policy changes that affect plan interpretation and Durable Object lifecycle changes require a reviewed maintenance deployment before routine guarded builds can use them. Ordinary renderer/style changes use the normal build path.

Read the published source identity at `/docs/manifest.json`. `/api/project` reports mutable observed/desired versions alongside the served version read from the current deployment's assets. A newer observed release does not relabel older HTML.

For a source check:

```sh
curl --fail-with-body -X POST https://cfgate.io/internal/docs/reconcile \
  -H "Authorization: Bearer $DOCS_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' --data '{}'
```

To retry unchanged inputs after correcting an external build problem, use `{"forceRebuild":true}`. This resets the five-attempt budget and creates a new generation. It is rejected while a build or uncertain publication is active. Visitors cannot force builds.

## Failure recovery

| Observation                       | Action                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `waiting-for-sources`             | Check GitHub access, release publication, matching chart and source-tag identity. Current docs stay online.                           |
| `build-requested` without a claim | Check the hook's `main` branch, build logs and production builder token. The persisted lease limits repeated requests.                |
| `failed`                          | Inspect Workers Builds logs. Fix source, validation or build configuration, then explicitly retry if the attempt budget is exhausted. |
| Candidate rejected as superseded  | Expected when a new release or renderer arrived. Let the current desired build complete.                                              |
| `publishing` remains unresolved   | Inspect Cloudflare's active deployment before acting. Do not publish a newer candidate speculatively.                                 |

For an unresolved publication, an administrator can confirm and activate the already recorded candidate in Cloudflare, then request reconciliation. Once that same version is observed at 100 percent, the coordinator records success and can proceed. If the candidate is unusable, pause build triggers and investigate the stored publication intent before a deliberate maintenance recovery. Do not delete the Durable Object to clear an error; it owns source history and pending publication state.

Counters in `/api/project` distinguish checks, no-op observations, requested builds, failures, superseded jobs and successful publications. Workers logs provide request IDs and coordinator errors. The deployed manifest records build time; it does not claim that product prose was edited at that time.

## Caching and retention

Moving docs HTML and the manifest use `no-cache`. Content-hashed assets can use immutable caching. Pagefind files revalidate with the deployment. There is no custom HTML cache in front of Workers Assets.

Prepared Markdown, downloaded data and intermediate output are ignored by Git. Cleanup is safe after a build: remove `.generated`, `.build`, `docs/src/content/docs` and `docs/public`. Historical source snapshots are not stored. Cloudflare's retained Worker versions are a separate platform history and may contain prior assets.

A rollback is a deployment operation, not deletion of coordinator history. Pause automatic publication first and preserve any uncertain operation. Re-enable guarded publication only after the active deployment and coordinator state are reconciled.
