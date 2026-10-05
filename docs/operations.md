# Documentation operations

Production documentation builds run in Cloudflare Workers Builds. GitHub Actions validates pull requests. Production activation requires the migration below; merging the code alone does not configure deploy hooks or credentials.

## What activation changes

Activation installs the coordinator once and connects the production builder to it. A Durable Object is Cloudflare-managed code and persistent storage attached to this Worker through a binding. You do not provision or maintain a separate server. The object stores observations, source plans and publication state; documentation HTML and `/docs/manifest.json` remain static site assets.

Routine deployments upload candidates, then ask the coordinator to publish eligible output. They do not recreate the object or its history. New Durable Object lifecycle migrations still require a reviewed maintenance deployment with `wrangler deploy`.

`DOCS_BUILDER_TOKEN` is a random application credential. The production build sends it to the Worker's claim, candidate and failure endpoints. The same value must exist in **two Cloudflare settings**: the Worker's runtime secrets and its production build trigger's secrets. GitHub Actions only validates the repository and does not need this token.

Build environment variables and runtime bindings are separate. Wrangler `[vars]` does not export arbitrary values into the shell running `pnpm build`. `.node-version` and `package.json`'s `packageManager` pin select tools; they are not secret provisioning mechanisms. Ordinary build configuration belongs in repository code. Secrets belong in the relevant Cloudflare settings.

## Repository configuration

`deployment.json` records the account, Worker, repository, production branch and webhook destinations. These identifiers are public. `secrets.enc.yaml` records credentials and the secret deploy-hook URL, encrypted with SOPS. `.sops.yaml` contains the existing public age recipients; their private keys stay with authorized operators.

This is the repository's desired activation configuration. It is not a backup of the Durable Object's live observations, leases or publication history. Committing credentials does not install them, and checking out an older encrypted file does not roll back Cloudflare. Setup checks the runtime configuration digest before changing build settings or enabling webhooks. A mismatch stops for investigation rather than rotating secrets implicitly.

### Required permissions

Only the Builds setup token needs to be created separately for this installation. Create a **user API token** under [My Profile > API Tokens](https://dash.cloudflare.com/profile/api-tokens), using a custom template:

- Name: `cfgate.io-builds-setup`.
- Account permissions: **Workers Builds Configuration: Edit** and **Workers Scripts: Read**.
- Account resources: include only the account recorded in `deployment.json`.

Store it as `CLOUDFLARE_SETUP_TOKEN` using `sops secrets.enc.yaml`. Do not put the token in `deployment.json`, shell history or a pull-request description. Cloudflare's Builds API requires a user-scoped token; the existing account-owned deployment token cannot replace it. The API calls this Builds permission `Workers CI Write`; see the [Builds API reference](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/).

The existing encrypted `CLOUDFLARE_API_TOKEN` remains the Wrangler deployment credential. It needs Workers Scripts edit access and the permissions required to deploy this Worker's existing routes. Setup uses it for runtime candidate publication too, unless `DOCS_DEPLOY_TOKEN` supplies a separate account-scoped Workers Scripts read/write token. Setup can test read access before installation; that check does not prove write access.

GitHub setup uses the local `gh` login. It needs **Webhooks: write** on `cfgate/cfgate` and `cfgate/helm-chart`, or the classic `admin:repo_hook` scope. An authorized login with that scope needs no new GitHub token. Setup never copies this administrator credential into the Worker or build environment. Cloudflare's GitHub App connection remains a separate authorization: it must already connect this Worker to `cfgate/cfgate.io` with `main` as its production branch.

## First deployment

Preparation can run on the reviewed development branch. It does not deploy the site:

```sh
pnpm install --frozen-lockfile
pnpm run setup                # Print the plan without writes
pnpm run setup --prepare      # Generate missing application secrets in SOPS
pnpm run setup --provision    # Record Cloudflare identities; stage inactive webhooks
```

With the repository's Mise task, prefix commands with `mise run`, for example `mise run pnpm run setup --prepare`. Setup reads the encrypted file directly through SOPS, so a value updated in the file is not shadowed by an older environment variable. No private age key is sent to GitHub Actions or Workers Builds.

`--prepare` generates independent admin, builder and webhook-signing secrets. Existing values are preserved. If `.activation/credentials.json` exists from the earlier setup implementation, matching-account credentials are imported; conflicting values stop the operation. After verifying the encrypted copy, remove or securely archive that old plaintext file. New setup runs do not create it.

`--provision` discovers the single main-only build trigger belonging to the configured Worker and repository. It creates or reuses the named main deploy hook, then records its URL and trigger identity in SOPS. A later run validates those recorded identities. It also creates inactive, release-only GitHub webhooks for both product repositories. Existing hooks at the configured URL are left unchanged during preparation. Cloudflare and GitHub steps can succeed independently; if one fails, fix its access and retry with the same file. A lost creation response can be recovered by discovering the named hook on the next run.

Review and commit `deployment.json`, `.sops.yaml` and the encrypted file with the implementation. Before merging and activating:

1. Hold automatic production builds and wait for active production builds to finish. Keep the Git connection intact and temporarily set its production build command to `exit 1`. Disconnecting removes the trigger; reconnecting creates a new identity that must be verified and recorded before setup can resume. Setup restores the production commands. This stops new production work without removing the live deployment.
2. Merge the reviewed PR, then sync a clean local `main`.
3. Review the operator and chart pins in `docs/bootstrap.json`, then run:

```sh
mise run pnpm run setup --apply --install
```

Use `--apply` alone when resuming after installation. The first installation needs explicit `--install` because the older Worker may return 404 or 401 for the status endpoint. Setup checks Cloudflare secret metadata and refuses to replace an existing admin or builder credential. An authentication failure is not permission to overwrite credentials.

Setup builds and tests the site, then deploys the Worker, static assets, Durable Object migration and runtime secrets together with `wrangler deploy --secrets-file`. It verifies the installed configuration, configures `pnpm build` and `pnpm run deploy` on the production trigger, and installs its matching builder token. Only then does it initialize the coordinator from the deployed manifest and enable the signed GitHub webhooks. Preview commands and unrelated build variables remain unchanged. Use `pnpm exec wrangler preview` for the preview command.

If installation already completed, setup verifies its state and resumes without redeploying the initial edition. If propagation still exposes the old endpoint while Cloudflare reports installed credentials, wait and retry with the same encrypted values. An older docs-enabled deployment or a deliberate secret rotation requires a reviewed maintenance procedure; `--install` does not bypass existing authentication.

After success, restore any separate dashboard pause control and check `/docs/manifest.json`, `/api/project` and the next production build. Production builds can now claim plans and publish eligible candidates. The setup command does not need to run before each deployment.

### Partial failure and local files

These steps are resumable, not atomic across Cloudflare and GitHub. A failure can leave an installed Worker, configured build trigger or one enabled webhook. Retry with the same encrypted configuration. An initialized coordinator is never reset, and setup does not replace newer documentation with bootstrap content. If code deployment succeeds but initialization fails, investigate the Worker logs, deploy any tested code correction with existing secrets preserved, then resume `--apply`. Do not remove credentials or reinstall to bypass the guard.

A local `.activation/setup.lock` prevents concurrent setup commands. After a hard termination, confirm that no setup process is running before removing the stale lock. A hard termination during deployment can leave a private `cfgate-deploy-*` directory in the operating system's temporary directory. Remove that directory after confirming it is no longer in use. Its secrets file is plaintext; ordinary completion removes it. Repository updates use ciphertext-only temporary files and refuse observed concurrent edits. Do not edit secrets while setup is running.

## Credential placement

| Value                    | Source and destination                                     | Purpose                                          |
| ------------------------ | ---------------------------------------------------------- | ------------------------------------------------ |
| `CLOUDFLARE_SETUP_TOKEN` | SOPS; local setup only                                     | Discover and configure Builds                    |
| `CLOUDFLARE_API_TOKEN`   | SOPS; local Wrangler deployment                            | Install code, assets and runtime settings        |
| `DOCS_TRIGGER_ID`        | Discovered; SOPS                                           | Select the production build trigger              |
| `DOCS_BUILDER_TOKEN`     | Generated; SOPS, Worker and production build secret        | Claims, candidates and failure reports           |
| `DOCS_ADMIN_TOKEN`       | Generated; SOPS and Worker                                 | Initialization, status and manual reconciliation |
| `DOCS_ACCOUNT_ID`        | Derived from `deployment.json`; Worker                     | Publication API account                          |
| `DOCS_DEPLOY_TOKEN`      | Optional SOPS override, otherwise deployment token; Worker | Verify and publish candidates                    |
| `DOCS_BUILD_HOOK`        | Created/discovered; SOPS and Worker                        | Request a production build                       |
| `GITHUB_WEBHOOK_SECRET`  | Generated; SOPS, Worker and two repository hooks           | Authenticate release notifications               |
| `GITHUB_READ_TOKEN`      | Optional read-only SOPS value; Worker                      | Raise GitHub metadata request limits             |
| `GITHUB_TOKEN`           | Optional read-only build variable, configured separately   | Read pinned sources during a build               |

The Worker's **Settings > Variables and Secrets** holds runtime credentials. **Settings > Builds > Variables and Secrets** holds build credentials. Setup installs the builder value in both places; no manual copy is needed. Workers Builds retains its normal Cloudflare upload credential independently of these application secrets.

The `cfgate/cfgate` repository uses an Actions secret named `MISE_SOPS_AGE_KEY` for operator release/E2E decryption. It is not shared automatically with this repository or Cloudflare. Website Actions use GitHub's automatic read token for validation, with no SOPS decryption or production publication. Preview builds receive no production publication credentials; their Wrangler configuration removes the coordinator binding and sets `ENVIRONMENT=staging`. Mutation endpoints also require the production hostname.

## GitHub notifications

Setup subscribes both product repositories to release events at `https://cfgate.io/api/hooks/github`, using JSON, TLS verification and the generated signing secret. Hooks stay inactive until the receiving Worker is initialized. New hooks subscribe only to releases. For existing hooks, setup adds release notifications without replacing other subscriptions, including optional workflow-run notifications for CI freshness.

A product release sends a signed notification to the website Worker. The Worker validates the raw body, repository, event/action and delivery ID, then asks the Durable Object to persist a reconciliation request. The coordinator rechecks GitHub rather than trusting the notification's version. When pinned inputs change, it calls the Cloudflare deploy hook. Workers Builds claims a plan, builds and uploads a candidate, and asks the coordinator to publish it. GitHub does not send Markdown to the object or deploy the website directly.

Duplicate and out-of-order events do not select a deployment. Product pushes are ignored while `next` is disabled. The handler returns 202 after durable acceptance; its 64 KiB body limit rejects oversized events. The hourly schedule and access-triggered stale checks remain recovery paths for missed notifications. Check repository webhook delivery results when diagnosing delays.

## Routine builds

A production Workers Build claims a plan using its build UUID and checked-out renderer commit. Claims reject an older renderer, unavailable sources or another active build lease. The builder fetches only that plan's sources, checks the complete site, records an output digest, and uploads a Worker version. The coordinator rechecks release eligibility and current website `main` before publishing at 100 percent traffic.

No product-repository documentation workflow is needed. Do not replace the production deploy command with `wrangler deploy`: that bypasses candidate eligibility checks. Policy changes that affect plan interpretation and Durable Object lifecycle changes require a reviewed maintenance deployment before routine guarded builds can use them. Ordinary renderer/style changes use the normal build path.

Read the published source identity at `/docs/manifest.json`. `/api/project` reports mutable observed/desired versions alongside the served version read from the current deployment's assets. A newer observed release does not relabel older HTML.

For authenticated diagnostics, POST `{}` to `/internal/docs/status` using the admin token. It reports initialization, phase, the last reconciliation error and the next check time without returning credentials.

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
