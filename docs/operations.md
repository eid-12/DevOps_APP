# Operations (CloudBase itself)

Updating **CloudBase** is a different pipeline from updating a tenant app.

Pushing to `master` builds, tests and deploys CloudBase automatically through GitHub Actions ([`.github/workflows/ci-cd.yml`](../.github/workflows/ci-cd.yml)). It reuses the existing Dockerfiles and the existing Portainer stack **cloudbase-platform** (stack id 44, endpoint 3).

## CI/CD

| Trigger | Jobs | Production access |
|---------|------|-------------------|
| Pull request to `master` | backend `mvn clean verify` (JDK 17), frontend `npm ci && npm run build`, deploy-script tests (shellcheck + mock-Portainer scenarios), both Docker images built (not pushed) | none: no secrets, read-only token |
| Push to `master` | the same checks, then **publish** and **deploy** | only the `production` environment, which only `master` can use |

Because the namespace equals the `DOCKERHUB_USERNAME` secret, Actions masks it in logs (`***/cloudbase-backend`) and refuses to pass it between jobs, so only the digests travel from publish to deploy and the image references are rebuilt there.

**Publish** builds both images from the pushed commit and pushes them as `minipcer/cloudbase-{backend,frontend}:<full commit sha>`, labelled `org.opencontainers.image.revision=<sha>`. The digests are in the run summary and the `release-<sha>` artifact.

**Deploy** runs [`deploy/portainer-deploy.sh`](../deploy/portainer-deploy.sh):

1. Reads the live stack file and env from Portainer. Env values are never printed.
2. Refuses to go backwards: if the deployed commit is newer than this one, the run is skipped; if their histories diverged, it stops for a human.
3. Replaces only the two CloudBase `image:` lines with `<repo>:<sha>@sha256:<digest>`. Env vars, volumes, networks and Postgres are sent back unchanged (prune off, pull off: the digest-pinned images are pulled because they are new, and unchanged containers such as Postgres are not recreated).
4. Waits up to 5 minutes for both containers to run the pinned images and have matching revision labels, rejects backend/frontend Docker health states other than healthy or absent, requires `cloudbase-postgres` running and healthy, `GET /api/public/app-config` = 200, `GET /api/auth/me` = 401, www = 200, then 30 s with no container restarts (catches crash loops).
5. On failure, first reconciles what is actually running. If Portainer is unreachable (Cloudflare 530/1033), it waits up to `DEPLOY_RECONCILE_SECONDS` (15 min) for it to come back instead of rolling back blind. Then:
   - new images running and healthy → the deploy succeeds;
   - previous images still running → the rollout never applied; the previous stack file is put back so it matches, and the run fails saying production is unchanged;
   - anything else → re-applies the previous stack file, waits for it to be healthy, and fails the run.

   If Portainer never comes back, the run fails with **STATE UNKNOWN** and sends no rollback. Check the running `cloudbase-backend`/`cloudbase-frontend` images before doing anything, then re-run the failed job once the tunnel is stable.
   A stack response alone is insufficient: failed container inspections also produce **STATE UNKNOWN**.
   Before recovery mutations the script refreshes container and stack observations, checks the endpoint and environment,
   and refuses to overwrite a stack file that differs from both its original and proposed versions. Repeated
   observations share one recovery waiting budget. A revision-label mismatch restarts the 30-second stability window.
   The deploy job allows 45 minutes for rollout, outage reconciliation, verification and rollback.
6. On success, moves `:latest` to the deployed digests (so manual tooling that still uses `:latest` stays correct).

Only one deploy runs at a time (`concurrency: production-deploy`); a newer queued run supersedes an older pending one.

Postgres data lives in the named volume `cloudbase-platform_cloudbase_postgres_data`; deploys never remove volumes. Expect a few seconds of API downtime while the backend container is replaced.

The deploy logic is covered by `deploy/test/run-tests.sh` (healthy rollout, failed HTTP or Docker health checks → rollback, crash loop → rollback, mixed revisions, frontend label mismatch, outage before rollout or with the rollout not applied / applied / never recovering, failed inspections, concurrent stack edits, older commit skipped, diverged history refused, wrong key fails safely, no secret values in output). CI runs it before anything is published.

### Required GitHub settings

Secrets can be **repository** secrets (Settings → Secrets and variables → Actions) or **`production` environment** secrets (Settings → Environments → `production`); an environment secret overrides a repository secret of the same name. The `production` environment's deployment branches are **`master` only**, and only the publish/deploy jobs use it. Pull-request jobs reference no secrets. Values are never committed.

| Kind | Name | Value |
|------|------|-------|
| Secret | `DOCKERHUB_USERNAME` | Docker Hub account that owns the images (`minipcer`); falls back to the variable or `minipcer` |
| Secret | `DOCKERHUB_TOKEN` | Docker Hub access token for that account with **Read & Write** scope (not the account password) |
| Secret | `PORTAINER_API_KEY` | Portainer API key that can update stack 44 on endpoint 3 |
| Secret (optional) | `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | only if `manage.cloudbase.website` is put behind Cloudflare Access |
| Variable (optional) | `DOCKERHUB_NAMESPACE`, `PORTAINER_URL`, `PORTAINER_ENDPOINT_ID`, `PORTAINER_STACK_ID` | defaults: `minipcer`, `https://manage.cloudbase.website`, `3`, `44` |

### Verifying a release

- The run's **Deploy to production** job ends with `deployed <sha>`.
- Live: `curl -s -o /dev/null -w '%{http_code}' https://api.cloudbase.website/api/auth/me` returns `401`.
- Portainer → container `cloudbase-backend` → image is `minipcer/cloudbase-backend:<sha>@sha256:…`.

### Rolling back by hand

Automatic rollback covers a failed rollout. To return to an earlier good release later:

1. Find its digests in that run's summary or `release-<sha>` artifact.
2. Portainer → Stacks → cloudbase-platform → Editor: set both `image:` lines to those `<repo>:<sha>@sha256:<digest>` values, keep everything else, **Update the stack** with "Re-pull image" on.
3. A later push to `master` will deploy again; to stop that, revert the bad commit on `master` instead.

#### Session revocation and rollback

Since migration `V19`, session tokens and reset links carry the user's `session_version` (`sv`); a password change
or reset increments it and earlier tokens are refused. Reset and change are also atomic (row lock, exactly one winner).
A safe rollback backend needs both. Older backends ignore `sv` and **accept revoked tokens again until they expire**;
`7311725` has `sv` but not atomic reset/change, so it is not safe either. The floor is `ROLLBACK_SAFE_SINCE`
(`85e0b37`) in `deploy/session-revocation.env`.

**Automatic rollback (pipeline).** Before changing production the deploy script picks the rollback backend:

| Deployed (previous) backend | Result |
|---|---|
| `ROLLBACK_SAFE_SINCE` or a descendant | deploy; roll back to the previous backend if needed |
| older, CI supplied the verified rollback build | deploy; roll back to `cloudbase-backend:<ROLLBACK_COMPAT_SHA>@<digest>` with the previous frontend |
| older, no valid rollback build, or the check cannot be answered | `REFUSED before any change`; production is untouched |

The rollback build is branch `rollback/1b885e9-sv`: `1b885e9` plus only session-version checks and row-locked
password change/reset (same `V19` file and `sv` claim). The publish job builds it from `ROLLBACK_COMPAT_SHA`, verifies
the pushed digest's revision label, and passes it as `ROLLBACK_BACKEND_IMAGE`. Covered by `deploy/test/run-tests.sh`
scenarios 16-20, `tests/local/rollback_check.py --expect-safe` and `tests/local/race_verify.py`.

**Manual rollback** to a release older than `ROLLBACK_SAFE_SINCE`:

1. Use the rollback build instead of the old backend: Portainer → Stacks → cloudbase-platform → Editor, set the
   backend `image:` to `<namespace>/cloudbase-backend:<ROLLBACK_COMPAT_SHA>@<digest>` (digest from the publish job
   summary of any release that built it) and the frontend to the release you are returning to. Keep everything else.
2. Verify: `GET /api/auth/me` with a token issued before a password change returns `401`; signing in works.
3. Rolling forward again needs nothing extra; tokens are interchangeable between the two lines.

Only if the rollback build is unavailable and the old backend must run anyway: rotate `JWT_SECRET` in the same stack
update (every session ends, revoked ones included). That is a production secret rotation and needs the owner's
approval first. The plain old image without either step must not be used.

Keep `ROLLBACK_COMPAT_SHA` and its image until a verified replacement exists: a production release at or after
`ROLLBACK_SAFE_SINCE` that passed the deploy health checks, with `tests/local/rollback_check.py --expect-safe` and
`race_verify.py` passing against that exact build. Running such a commit is not sufficient on its own.

The first deploy of the `sv` release signs every user out once (earlier tokens have no `sv`); approved by the owner.

## Manual deploy (fallback when Actions is unavailable)

1. Verify from clean outputs: `mvn clean verify` in `backend/`, `npm ci && npm run build` in `frontend/` (see the README “Test” section). The Dockerfiles build from source, so the images never reuse a local `target/` or `node_modules`. Do not bake `application-local.properties` into the JAR.
2. Build and push both images tagged with the full commit SHA (`docker build --label org.opencontainers.image.revision=<sha> -t minipcer/cloudbase-backend:<sha> backend`, same for `frontend`; nginx must listen on 3000).
3. On Portainer, update stack **cloudbase-platform** with the two image lines pinned to `<sha>@<digest>` and pull enabled.
4. Take a database backup first: `pg_dump -U cloudbase -d cloudbase -Fc` inside `cloudbase-postgres`.

Frontend cache: `index.html` is `Cache-Control: no-store` so a stale SPA chunk is less likely after a roll.

## Local vs live

| | Local | Live |
|--|-------|------|
| Compose | `docker-compose.yml` (builds from source) | `deploy/docker-compose.prod.yml` (prebuilt images, pinned by CI/CD) |
| UI | `http://localhost:4200` | `https://www.cloudbase.website` |
| API | `http://localhost:8080` | `https://api.cloudbase.website` |
| GitHub callback | `http://localhost:4200/auth/github/callback` | `https://www.cloudbase.website/auth/github/callback` |

I never commit `.env`, `backend/src/main/resources/application-local.properties`, or `frontend/src/environments/environment.ts`.

## If something looks “offline”

Admin → Infrastructure talks to the API, which talks to Portainer. If the browser still shows Portainer as down with empty metrics, it is usually an old JS bundle. Hard refresh. The live API route is `GET /api/admin/infrastructure`.
