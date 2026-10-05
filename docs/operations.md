# Documentation operations

Production documentation builds run in Cloudflare Workers Builds. GitHub Actions validates pull requests. Production activation requires the migration below; merging the code alone does not configure deploy hooks or credentials.

## What activation changes

Activation installs the coordinator once and connects the production builder to it. A Durable Object is Cloudflare-managed code and persistent storage attached to this Worker through a binding. You do not provision or maintain a separate server. The object stores observations, source plans and publication state; documentation HTML and `/docs/manifest.json` remain static site assets.

Routine deployments upload candidates, then ask the coordinator to publish eligible output. They do not recreate the object or its history. New Durable Object lifecycle migrations still require a reviewed maintenance deployment with `wrangler deploy`.

`DOCS_BUILDER_TOKEN` is a random application credential. The production build sends it to the Worker's claim, candidate and failure endpoints. The same value must exist in **two Cloudflare settings**: the Worker's runtime secrets and its production build trigger's secrets. GitHub Actions only validates the repository and does not need this token.

Build environment variables and runtime bindings are separate. Wrangler `[vars]` does not export arbitrary values into the shell running `pnpm build`. `.node-version` and `package.json`'s `packageManager` pin select tools; they are not secret provisioning mechanisms. Ordinary build configuration belongs in repository code. Secrets belong in the relevant Cloudflare settings.

## First deployment

The local setup command configures an existing website Worker and its existing production Git connection. It does not create the Cloudflare GitHub App authorization, generate a Cloudflare API token, create a deploy hook or configure GitHub webhooks.

Before applying setup:

1. Pause automatic production builds and wait for active builds to finish. Keep the current deployment online throughout preparation.
2. Merge the reviewed setup code, then sync a clean local `main`. Review the released operator and chart pins in `docs/bootstrap.json`.
3. Create a deploy hook for this Worker's `main` branch under **Settings > Builds > Deploy Hooks**.
4. Supply the environment below through your local secret manager. This repository's `mise.toml` can load `secrets.enc.yaml`; a local SOPS key decrypts that file. Do not transfer the age key into Workers Builds just to configure the builder token.

| Local variable          | Purpose                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID` | Account containing `cfgate-service-worker`; an identifier, not a secret                                                                                             |
| `CLOUDFLARE_API_TOKEN`  | User-scoped setup token with Workers Builds Configuration Edit, Workers Scripts Edit and the permissions needed by Wrangler for this Worker's routes and deployment |
| `DOCS_TRIGGER_ID`       | UUID of this Worker's production build trigger, selecting only `main`                                                                                               |
| `DOCS_BUILD_HOOK`       | Secret URL of the `main` deploy hook                                                                                                                                |
| `DOCS_DEPLOY_TOKEN`     | Separate runtime token with Workers Scripts read/write in this account; used for candidate verification and publication                                             |

Cloudflare's Builds API requires a user-scoped token; an account-scoped token can fail even when Worker deployment works. The setup token and the build system's own upload token have different roles. See the [Builds API reference](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/) for trigger IDs and permissions.

```sh
pnpm install --frozen-lockfile
pnpm setup             # Print the plan; no writes or credentials required
pnpm setup --apply     # Apply from clean, current main with the variables above
```

With Mise-managed secrets, run `mise run pnpm setup --apply` instead. Setup generates separate builder/admin tokens once and retains them in `.activation/credentials.json` with owner-only access. The directory is ignored by Git. Back it up in your secret manager; it contains plaintext credentials, not encrypted SOPS data. Reuse it on retries, and restore it when moving setup to another host. Do not delete it to fix an authentication failure.

The command validates the account, Worker and production trigger. If the coordinator is absent and the site has no documentation manifest, it builds and tests the site, then deploys the Worker, assets, migration and runtime secrets together using `wrangler deploy --secrets-file`. If that deployment already completed, a retry observes its status and continues without deploying again. An authenticated bootstrap request reads the Worker's own manifest and verifies its active Cloudflare version before recording publication state.

After initialization is confirmed, setup configures `pnpm build` and `pnpm deploy` on the production trigger and installs the matching `DOCS_BUILDER_TOKEN` as a build secret. It leaves preview settings unchanged. Resume automatic builds after setup succeeds; preview deployments should continue using `npx wrangler preview`.

These steps are resumable, not a transaction across Cloudflare services. Failed configuration can leave partial setup that needs a retry with the same credentials. An initialized coordinator is never reset, and setup does not redeploy the original edition over newer documentation. Setup is not a general secret-rotation or migration tool. Authentication failures, unknown deployment state and conflicting bootstrap requests stop it for investigation.

If the process is forcibly terminated during deployment, a private temporary secrets file can remain under `.activation/deploy-*`. Remove that temporary directory after recovery; preserve `credentials.json`. Do not run setup concurrently or resume automatic builds during activation.

## Credential placement

| Variable                | Installed in                                                       | Purpose                                                       |
| ----------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| `DOCS_BUILDER_TOKEN`    | Worker and production Workers Builds trigger, by setup             | Claims, candidates and failure reports                        |
| `DOCS_ADMIN_TOKEN`      | Worker and local credential store, by setup                        | Initialization, status and manual reconciliation              |
| `DOCS_ACCOUNT_ID`       | Worker, by setup                                                   | Account identifier for publication API calls                  |
| `DOCS_DEPLOY_TOKEN`     | Worker, by setup                                                   | Verify and publish candidates                                 |
| `DOCS_BUILD_HOOK`       | Worker, by setup                                                   | Request a production build                                    |
| `GITHUB_READ_TOKEN`     | Optional Worker secret; forwarded if supplied during initial setup | Read-only metadata access                                     |
| `GITHUB_TOKEN`          | Optional build variable, configured separately                     | Read-only pinned source retrieval                             |
| `GITHUB_WEBHOOK_SECRET` | Worker and repository webhook settings                             | HMAC verification; forwarded if supplied during initial setup |

The Worker's **Settings > Variables and Secrets** holds runtime credentials. **Settings > Builds > Variables and Secrets** holds build credentials. Setup uses the Builds API to install the shared builder value; there is no need to copy it manually. Existing unrelated build variables are preserved.

The `cfgate/cfgate` operator repository uses an Actions secret named `MISE_SOPS_AGE_KEY` for release/E2E decryption. That secret is not automatically shared with this repository or Cloudflare. This website's Actions workflow uses GitHub's automatic token for source reads and performs no SOPS decryption or production publication.

Preview builds must not receive production publication credentials. Their Wrangler configuration removes the coordinator binding and uses `ENVIRONMENT=staging`; mutation endpoints also require the production hostname. Workers Builds retains its normal Cloudflare upload credential independently of application authentication.

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
