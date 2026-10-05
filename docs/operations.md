# Deployment and maintenance

This guide owns the website's setup and deployment procedures. Start with the [system overview and workflow diagrams](architecture.md) for the connections between GitHub, Workers Builds, the website Worker and its Durable Object.

Production builds run in Cloudflare Workers Builds. GitHub Actions validates changes but does not deploy them or gate Cloudflare publication. First-time activation connects the builder and coordinator; merging code alone does not configure that connection.

## Procedure index

| Situation                               | Procedure                                         | Expected result                                                            |
| --------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| New maintainer or workstation           | [Local access](#local-access)                     | Existing encrypted configuration can be read without replacing credentials |
| First coordinator installation          | [First activation](#first-activation)             | Worker, coordinator, Builds and webhooks are connected                     |
| Website change or product release       | [Routine publication](#routine-publication)       | An eligible build is published with its source identity                    |
| Expiring or missing credential          | [Credential maintenance](#credential-maintenance) | Repository and consuming services agree on the new value                   |
| Disconnected or replaced Git connection | [Connection recovery](#connection-recovery)       | The new trigger identity is deliberately recorded                          |
| Build or publication failure            | [Diagnosis and recovery](#diagnosis-and-recovery) | Existing publication is retained while the failure is resolved             |

`deployment.json` contains public account, Worker, repository and webhook identities. `secrets.enc.yaml` contains SOPS-encrypted credentials and the secret deploy-hook URL. These files describe desired setup configuration, not the Durable Object's live history. A Git checkout or secret commit does not update Cloudflare by itself.

## Local access

Run commands from the `cfgate.io` repository. Install Git, GitHub CLI, SOPS, and the Node/pnpm versions selected by `.node-version` and `package.json`. Mise is optional; the repository's task runs pnpm with the encrypted environment loaded.

Obtain an authorized private age identity for the recipient already recorded in `.sops.yaml`. Configure SOPS through its standard age key file or `SOPS_AGE_KEY_FILE`. A newly generated key cannot decrypt the existing file. Adding a maintainer recipient requires an existing authorized key holder to update the encrypted file; replacing the recipient alone does not grant access.

Verify local access without printing decrypted values:

```sh
pnpm install --frozen-lockfile
gh auth status
sops decrypt secrets.enc.yaml > /dev/null
pnpm run setup
```

The last command prints the setup stages without changing remote state. Use `sops secrets.enc.yaml` to edit credentials. Do not print decrypted YAML, paste values into commands, or commit an editor's plaintext backup.

## Credentials and permissions

Create credentials before activation. Setup generates application secrets, but cannot create the provider authorizations below or approve the Cloudflare GitHub App installation.

### Cloudflare access

Create a user API token under [My Profile > API Tokens](https://dash.cloudflare.com/profile/api-tokens):

- Name: `cfgate.io-builds-setup`.
- Account permissions: **Workers Builds Configuration: Edit** and **Workers Scripts: Read**.
- Account resources: only the account in `deployment.json`.
- Encrypted key: `CLOUDFLARE_SETUP_TOKEN`.

The [Builds API](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/) requires a user-scoped token and calls its edit permission `Workers CI Write`. An account-owned deployment token cannot replace it.

`CLOUDFLARE_API_TOKEN` is the Wrangler installation/maintenance credential. It needs Workers Scripts edit access and permissions for this Worker's configured routes and custom domain. Preserve the existing account-scoped credential unless deliberately rotating it. Setup uses this credential for runtime publication too, unless `DOCS_DEPLOY_TOKEN` supplies a separate Workers Scripts read/write credential for the account. Successful read checks do not prove write access or establish that a token has no broader permissions.

Workers Builds also needs its Cloudflare upload credential. Configure that through the Builds connection; it is independent of `DOCS_BUILDER_TOKEN`, which only authenticates application endpoints.

### GitHub access

Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) for runtime source discovery:

- Name: `cfgate.io-source-reader`.
- Resource owner: `cfgate`.
- Selected repositories: `cfgate`, `helm-chart` and `cfgate.io`.
- Repository permission: **Contents: Read-only**, with the automatically supplied Metadata read permission.
- Encrypted key: `GITHUB_READ_TOKEN`.

Complete organization approval if required and track expiration. The implementation permits an empty read token, but production should configure one: unauthenticated source discovery encountered HTTP 403 during activation. That observation alone does not identify the provider's reason for every 403.

Webhook provisioning separately uses the local `gh` login. It needs **Webhooks: write** on the two product repositories, or classic `admin:repo_hook`. Setup does not copy that administrative login into the Worker or Builds. Cloudflare's GitHub App must also be authorized to connect to `cfgate/cfgate.io`; neither token installs or approves that App.

### Placement and synchronization

| Value                    | Stored or installed in                                       | Consumer and authority                                                     |
| ------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `CLOUDFLARE_SETUP_TOKEN` | SOPS; local setup                                            | Discover/configure Builds and deploy hooks                                 |
| `CLOUDFLARE_API_TOKEN`   | SOPS; local Wrangler                                         | Install code, assets and runtime configuration                             |
| `DOCS_TRIGGER_ID`        | SOPS; discovered during provisioning                         | Identify the production trigger; not a password                            |
| `DOCS_BUILD_HOOK`        | SOPS and Worker                                              | Request a build through a secret URL                                       |
| `DOCS_ADMIN_TOKEN`       | SOPS and Worker                                              | Bootstrap, status and administrative reconciliation                        |
| `DOCS_BUILDER_TOKEN`     | SOPS, Worker and production Builds secret                    | Claim plans and report candidates/failures                                 |
| `DOCS_ACCOUNT_ID`        | Derived from `deployment.json`; Worker                       | Public account identifier for publication calls                            |
| `DOCS_DEPLOY_TOKEN`      | Worker; optional SOPS override                               | Inspect and publish Worker versions; otherwise uses `CLOUDFLARE_API_TOKEN` |
| `GITHUB_WEBHOOK_SECRET`  | SOPS, Worker and both repository hooks                       | Sign/verify notifications; no GitHub API permissions                       |
| `GITHUB_READ_TOKEN`      | SOPS and Worker                                              | Authenticate documentation metadata selection                              |
| `GITHUB_TOKEN`           | Optional local/build environment; automatic token in Actions | Authenticate build-time GitHub API reads                                   |

The Worker runtime and build environment are separate:

- **Worker > Settings > Variables and Secrets** holds runtime credentials.
- **Worker > Settings > Builds > Variables and Secrets** holds build credentials. Setup installs only `DOCS_BUILDER_TOKEN` here and preserves unrelated variables.
- Wrangler `[vars]` configures runtime values such as `ENVIRONMENT`; it does not export them into the build shell.
- `.node-version` and `packageManager` select tools. They do not install application credentials. Review old dashboard tool-version overrides when changing those pins.

The runtime read token is not automatically passed to Builds. Public raw-source downloads and the current CI display reader remain unauthenticated. Website Actions uses its automatic `GITHUB_TOKEN`; it does not decrypt SOPS. The operator repository's `MISE_SOPS_AGE_KEY` is for its own release/E2E workflows and is not shared with this website or Cloudflare.

## First activation

This procedure activates the documentation coordinator on the named website Worker. Setup requires that Worker and its Git connection to exist; it does not provision a Cloudflare account, zone, initial Worker or GitHub App installation.

### 1. Existing Worker and held Git connection

In the account named by `deployment.json`, select the existing `cfgate-service-worker`. If starting without that Worker, create it first and arrange control of the `cfgate.io` zone/domain; the production names are also fixed in the code and Wrangler configuration.

Connect the Worker to `cfgate/cfgate.io` through **Settings > Builds**, authorizing the GitHub App when prompted. Configure:

| Setting                            | Before activation            | After activation                        |
| ---------------------------------- | ---------------------------- | --------------------------------------- |
| Production branch                  | `main` only                  | `main` only                             |
| Repository root                    | `/`                          | `/`                                     |
| Build command                      | `exit 1`                     | `pnpm build`, installed by setup        |
| Deploy command                     | `pnpm run deploy`            | `pnpm run deploy`                       |
| Preview deploy command, if enabled | `pnpm exec wrangler preview` | Same; setup does not configure previews |

Hold production builds before merging activation changes. `exit 1` makes new builds fail deliberately without changing the live site; it does not cancel already running builds. Wait for those builds to finish or cancel them before maintenance. Keep the connection intact: disconnecting deletes the trigger identity used by setup.

Check preview settings separately, including **Previews Base** if the dashboard exposes it. Preview builds use `pnpm build` and `pnpm exec wrangler preview`; they must not retain the production activation hold of `exit 1`. Setup updates the production trigger only, so confirm a branch preview completes before merging.

Keep production credentials scoped to production builds. The repository's preview configuration uses `ENVIRONMENT=staging` and removes the coordinator binding, and mutation endpoints require the production hostname. A raw Worker Version URL is not evidence of isolated resources. Do not treat a preview-looking URL as the isolation control.

### 2. Encrypted preparation and provisioning

On the development branch, after editing the provider credentials with SOPS:

```sh
pnpm run setup --prepare
pnpm run setup --provision
```

`--prepare` generates missing independent admin, builder and webhook secrets. Existing values are preserved. `--provision` discovers the single main-only trigger, creates/reuses its named deploy hook, records identities in SOPS and stages inactive release webhooks. Existing matching webhooks are left unchanged during this preparation step.

Review the ciphertext-only changes alongside `deployment.json`, `.sops.yaml` and the implementation. Commit and review them before merging. Provisioning can partially succeed across providers; retry with the same encrypted file rather than generating new identities.

### 3. Merge and initialize

Merge the reviewed changes, sync a clean local `main`, and review the source pins in `docs/bootstrap.json`. Then run:

```sh
mise run pnpm run setup --apply --install
```

Without Mise, use `pnpm run setup --apply --install`; setup invokes SOPS directly. Its stored values are not replaced by stale shell variables.

For a first installation, setup builds/tests the site and deploys code, assets, the Durable Object migration and runtime secrets with Wrangler. It verifies the configuration, restores production build commands, installs the builder secret, initializes the coordinator from the deployed manifest and enables the GitHub hooks. These are separate, resumable operations.

Use `--apply` without `--install` to resume after installation. The command requires local `main` to match remote `main` with a clean worktree. It verifies existing credentials and does not redeploy or reset an initialized coordinator. A 401, propagation delay or configuration-digest mismatch is not permission to overwrite credentials; investigate before retrying.

### 4. Acceptance checks

Activation output alone is not proof of the complete asynchronous path. Verify:

1. `/`, `/docs/`, `/docs/manifest.json` and `/api/project` respond successfully. Disabled history and `/docs/next/` return 404.
2. Authenticated `/internal/docs/status` reports `initialized: true` and no unresolved error. Use the admin token as described under [diagnostics](#diagnosis-and-recovery).
3. The production trigger uses `pnpm build` and `pnpm run deploy`, and its builder secret is installed. Restore any separate dashboard pause control.
4. Both repository webhooks are active with JSON payloads, TLS verification and release subscriptions. In GitHub **Settings > Webhooks > Recent Deliveries**, redeliver a setup ping. Expect HTTP 202 with `ignored: true`; this checks delivery and signature verification without requesting a build. An older 404 remains in history.
5. Request one administrative rebuild when no work is active, or observe the next website push. Follow Workers Builds through successful candidate publication, then compare the live manifest with the expected website/source revisions.
6. Observe a real release notification when one is available. A successful ping proves reachability and authentication, not release selection or rebuild behavior.

## Routine publication

Website `main` pushes start Workers Builds. Product releases signal the coordinator, which selects the highest eligible published semantic version, including prereleases, and requires a matching chart. Product `main` pushes do not change released docs while `next` is disabled.

The builder claims an immutable plan for its checkout, prepares sources, checks the complete site and uploads a candidate. The coordinator rechecks eligibility and deploys at 100 percent traffic. Use `pnpm run deploy` as the production deploy command; direct `wrangler deploy` bypasses this publication guard. GitHub Actions runs lint, tests and security checks separately; its result is not currently a production deployment gate.

No setup command is needed for ordinary renderer changes. Changes to plan interpretation or Durable Object lifecycle require a reviewed maintenance deployment before routine builds can use them. Preserve runtime secrets and existing publication state during that deployment. The current setup command does not provide an upgrade/reinstall flag for an already configured Worker.

## Credential maintenance

Editing SOPS or merging ciphertext does not install a new runtime secret. Setup compares a digest of the expected runtime configuration with the live Worker and stops on disagreement; it is not a general secret-rotation command.

For a runtime-only read credential such as `GITHUB_READ_TOKEN`:

1. Hold new production builds as in [first activation](#1-existing-worker-and-held-git-connection), and let active builds/publications finish.
2. Create the replacement with the required permissions. Edit its value with `sops secrets.enc.yaml`, then review, commit and merge the encrypted change. Keep the old credential valid until verification completes when the provider permits overlap.
3. From the clean, synced checkout, install the same value in the Worker's runtime secrets. The dashboard accepts it directly. For CLI installation, pipe the selected SOPS value into Wrangler; never put it in a command argument:

   ```sh
   (
     set -eu
     export CLOUDFLARE_ACCOUNT_ID="$(node -p 'require("./deployment.json").accountId')"
     read_token="$(sops decrypt --extract '["GITHUB_READ_TOKEN"]' secrets.enc.yaml)"
     test -n "$read_token"
     printf '%s' "$read_token" | mise run pnpm exec wrangler secret put GITHUB_READ_TOKEN
   )
   ```

4. Treat `wrangler secret put` as a deployment operation: it creates and deploys a version with the changed secret. Check the active version and existing pending publication before proceeding.
5. Run `mise run pnpm run setup --apply`. Matching credentials allow it to resume, restore build commands and verify configuration. Request reconciliation, check source discovery and publication, then revoke the old token.

Other credentials have additional consumers:

| Change                       | Required synchronization                                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `DOCS_BUILDER_TOKEN`         | Hold/drain builds, update Worker, then use `--apply` to update the production Builds secret                                                   |
| `DOCS_ADMIN_TOKEN`           | Update Worker and encrypted copy together; retain authorized recovery access until authentication works                                       |
| `GITHUB_WEBHOOK_SECRET`      | Update Worker and encrypted copy, then use `--apply` to update both hooks; notifications signed during the mismatch may need redelivery       |
| `CLOUDFLARE_SETUP_TOKEN`     | Update SOPS; local provisioning consumes it, not the Worker                                                                                   |
| `CLOUDFLARE_API_TOKEN`       | Update SOPS and also the runtime `DOCS_DEPLOY_TOKEN` if using the default shared credential; check any separately managed Builds upload token |
| Explicit `DOCS_DEPLOY_TOKEN` | Update SOPS and Worker; verify candidate-read and publication permissions                                                                     |
| SOPS recipient               | An authorized key holder re-encrypts configuration for the approved recipient; this does not rotate provider credentials                      |

For multi-secret changes, plan the installation order and retain a recovery credential until every consumer agrees. There is no atomic rotation across providers. Do not bulk-upload the entire decrypted SOPS file: local setup credentials and trigger metadata are not all runtime secrets.

## Connection recovery

If Builds was disconnected, reconnect the same Worker/repository with `main` only and the temporary `exit 1` build command. A replacement trigger has a new identity. `--provision` deliberately rejects a different trigger while `DOCS_TRIGGER_ID` still names the previous one.

Confirm the old trigger was removed and the replacement belongs to the correct Worker, account, repository and branch. Remove only the stale `DOCS_TRIGGER_ID` entry through SOPS, then run `pnpm run setup --provision` to discover and record the replacement. Preserve credentials. An existing `DOCS_BUILD_HOOK` is checked separately for Worker, branch and name; if it was deleted, verify that before removing its stale entry and provisioning a replacement.

Commit and review the new encrypted identities, sync `main`, and resume `--apply`. If a replacement hook changes the runtime configuration digest, install the new `DOCS_BUILD_HOOK` as a maintenance secret update first. A trigger-ID-only change does not alter the runtime digest. Do not use `--install` to bypass either check.

## Diagnosis and recovery

Use the [live project API](https://cfgate.io/api/project) for observations and the [deployed manifest](https://cfgate.io/docs/manifest.json) for served identity. The latter must not be inferred from the newest release.

For authenticated diagnostics, load `DOCS_ADMIN_TOKEN` into the local environment through your secret tooling and POST an empty object:

```sh
curl --fail-with-body -X POST https://cfgate.io/internal/docs/status \
  -H "Authorization: Bearer $DOCS_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' --data '{}'
```

Status reports initialization, phase, last error, next check time and configuration digest without returning credentials. POST `{}` to `/internal/docs/reconcile` with the same authentication to request a source check. Use `{"forceRebuild":true}` to rebuild unchanged inputs and reset the five-attempt budget. Forced rebuild is rejected during an active build or uncertain publication. A 202 acknowledges queued work, not completed publication.

| Observation                                | Action                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Setup ping returned 404                    | Check its timestamp against deployment; redeliver after activation                                                      |
| Webhook returns 401                        | Check the signature and shared webhook secret; changing the admin/builder token does not fix it                         |
| `waiting-for-sources`                      | Check GitHub token validity/approval, rate-limit responses, matching chart and tag identity                             |
| `build-requested` without a claim          | Check deploy-hook identity, build command, logs and builder authentication                                              |
| `failed`                                   | Read Workers Builds logs, correct the cause and retry deliberately if attempts are exhausted                            |
| Candidate superseded                       | Let the current desired build proceed; an older result must not replace it                                              |
| Build reports 503 after upload/publication | Compare active Cloudflare version, live manifest and coordinator state before assuming rollback or repeating deployment |
| `publishing` remains unresolved            | Establish the active version before allowing another publication                                                        |
| Configuration digest mismatch              | Compare encrypted desired credentials with their installed consumers; do not reset coordinator state                    |

An unresolved publication retains durable intent. If the recorded candidate is active at 100 percent, reconciliation can confirm it. If it was not activated, an authorized operator can inspect and deliberately activate that same candidate, then reconcile. If it is unusable, hold production builds and plan maintenance recovery. Do not delete the Durable Object to clear an error.

The coordinator's counters are application observations, not the complete Workers Builds history. An HTTP acknowledgement can fail after Cloudflare deploys successfully. Check both systems. Request IDs and coordinator errors are available in Worker logs; logging uses the sampling rate in `wrangler.toml`.

### Interrupted local setup

A local `.activation/setup.lock` prevents concurrent setup commands. After a hard termination, confirm no setup process remains before removing a stale lock. During initial installation, setup uses a private `cfgate-deploy-*` temporary directory for its runtime secrets file and removes it on ordinary completion. A hard termination can leave that plaintext file behind; remove it after confirming the process is no longer using it. SecretStore's repository updates use ciphertext-only temporary files and reject observed concurrent edits.

If legacy `.activation/credentials.json` exists, `--prepare` imports compatible credentials and rejects conflicts. Verify the SOPS copy before removing or securely archiving the legacy plaintext file. New setup runs do not create it.

## Caching, retention and rollback

Moving docs HTML, Pagefind files and the manifest revalidate; content-hashed assets use immutable caching. Project observations normally refresh on a 30-minute threshold, with hourly Cron, webhook signals and persisted alarms. The homepage requests project data once per visit. The coordinator fallback cache lasts 30 minutes; release-file proxies independently cache for one hour.

Temporary generated content lives in `.generated`, `.build`, `docs/src/content/docs` and `docs/public`. Those directories can be removed after a build. No historical Markdown snapshots are committed. Cloudflare's retained Worker versions are separate provider history and may contain older assets.

A rollback changes the deployed version, not coordinator history. Hold new builds, finish or resolve any active publication, and preserve its recorded intent before a deliberate rollback. Reconcile coordinator expectations with the chosen active deployment before restoring automated publication. Neither setup nor a Git revert is an automatic rollback procedure.

## Provider references

- [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Workers Builds API and token requirements](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/)
- [Worker secrets and deployment effects](https://developers.cloudflare.com/workers/configuration/secrets/)
- [GitHub personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
