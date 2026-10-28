# Operations (CloudBase itself)

Updating **CloudBase** is a different pipeline from updating a tenant app.

Pushing to `master` builds, tests and deploys CloudBase automatically through GitHub Actions ([`.github/workflows/ci-cd.yml`](../.github/workflows/ci-cd.yml)). It reuses the existing Dockerfiles and the existing Portainer stack **cloudbase-platform** (stack id 44, endpoint 3).

## CI/CD

| Trigger | Jobs | Production access |
|---------|------|-------------------|
| Pull request to `master` | backend `mvn clean verify` (JDK 17), frontend `npm ci && npm run build`, both Docker images built (not pushed) | none: no secrets, read-only token |
| Push to `master` | the same checks, then **publish** and **deploy** | only the `production` environment, which only `master` can use |

Because the namespace equals the `DOCKERHUB_USERNAME` secret, Actions masks it in logs (`***/cloudbase-backend`) and refuses to pass it between jobs, so only the digests travel from publish to deploy and the image references are rebuilt there.

**Publish** builds both images from the pushed commit and pushes them as `minipcer/cloudbase-{backend,frontend}:<full commit sha>`, labelled `org.opencontainers.image.revision=<sha>`. The digests are in the run summary and the `release-<sha>` artifact.

**Deploy** runs [`deploy/portainer-deploy.sh`](../deploy/portainer-deploy.sh):

1. Reads the live stack file and env from Portainer. Env values are never printed.
2. Refuses to go backwards: if the deployed commit is newer than this one, the run is skipped; if their histories diverged, it stops for a human.
3. Replaces only the two CloudBase `image:` lines with `<repo>:<sha>@sha256:<digest>`. Env vars, volumes, networks and Postgres are sent back unchanged (prune off, pull on).
4. Waits up to 5 minutes for both containers to run the pinned images, the backend's revision label to match, `GET /api/public/app-config` = 200, `GET /api/auth/me` = 401, www = 200, then 30 s of stability.
5. On failure, re-applies the previous stack file, waits for it to be healthy, and fails the run.
6. On success, moves `:latest` to the deployed digests (so manual tooling that still uses `:latest` stays correct).

Only one deploy runs at a time (`concurrency: production-deploy`); a newer queued run supersedes an older pending one.

Note: Portainer recreates every container in the stack on update, including Postgres. Data lives in the named volume `cloudbase-platform_cloudbase_postgres_data` and survives; expect a few seconds of API downtime per deploy.

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

## Manual deploy (fallback when Actions is unavailable)

1. Verify from clean outputs: `mvn clean verify` in `backend/`, `npm ci && npm run build` in `frontend/` (see README “Clean build and tests”). The Dockerfiles build from source, so the images never reuse a local `target/` or `node_modules`. Do not bake `application-local.properties` into the JAR.
2. Build and push both images tagged with the full commit SHA (`docker build --label org.opencontainers.image.revision=<sha> -t minipcer/cloudbase-backend:<sha> backend`, same for `frontend`; nginx must listen on 3000).
3. On Portainer, update stack **cloudbase-platform** with the two image lines pinned to `<sha>@<digest>` and pull enabled.
4. Take a database backup first: `pg_dump -U cloudbase -d cloudbase -Fc` inside `cloudbase-postgres`.

Frontend cache: `index.html` is `Cache-Control: no-store` so a stale SPA chunk is less likely after a roll.

## Local vs live

| | Local | Live |
|--|-------|------|
| Compose | `docker-compose.yml` (build context) | `docker-compose.prod.yml` (prebuilt images) |
| UI | `http://localhost:4200` | `https://www.cloudbase.website` |
| API | `http://localhost:8080` | `https://api.cloudbase.website` |
| GitHub callback | `http://localhost:4200/auth/github/callback` | `https://www.cloudbase.website/auth/github/callback` |

I never commit `.env`, `backend/src/main/resources/application-local.properties`, or `frontend/src/environments/environment.ts`.

## If something looks “offline”

Admin → Infrastructure talks to the API, which talks to Portainer. If the browser still shows Portainer as down with empty metrics, it is usually an old JS bundle. Hard refresh. The live API route is `GET /api/admin/infrastructure`.
