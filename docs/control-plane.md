# Control plane

This git repo is only the control plane.

```text
DevOps_APP/
├── frontend/          Angular 18 SPA
├── backend/           Spring Boot 3.3, JDK 17
├── docker-compose.yml           local: build from source
├── docker-compose.prod.yml      live: pull minipcer/* images
└── docs/
```

## Frontend

Angular 18, TypeScript, PrimeNG. Styles live under `frontend/src/styles/` (SCSS). Local `ng serve` proxies `/api` to `:8080`.

Production image is nginx listening on **3000**. NPM `www.cloudbase.website` forwards to `cloudbase-frontend:3000`.

Pages that matter:

| Path | Job |
|------|-----|
| `/` | Landing |
| `/auth` | Sign in, register, reset |
| `/dashboard` | Projects |
| `/projects/:id` | Services on a project |
| `/projects/:id/services/:id` | Deploy, logs, network, settings |
| `/account` | Profile, GitHub connect |
| `/billing` | Plan / usage |
| `/admin` | Users, hosting settings, infrastructure, audit |

The admin infrastructure screen reads `GET /api/admin/infrastructure`. It does not call Portainer from the browser.

## Backend

Spring Boot talks to Postgres (JPA + Flyway). Auth is JWT (default two hours). Password hashes are BCrypt.

API groups:

| Prefix | Who |
|--------|-----|
| `/api/auth/**` | Public login/register/reset; the rest needs a session |
| `/api/projects/**` | Signed-in user, own projects |
| `/api/admin/**` | `ROLE_ADMIN` |
| `/api/notifications/**` | Signed-in user |
| `/api/public/**` | Landing metrics + app config (cached, rate-limited) |
| `/api/webhooks/github` | GitHub only, HMAC secret required |
| `/ws` | JWT on the socket; topics are scoped to services you can access |
| `/actuator/health` | Public liveness |

Hosting tokens (Portainer, NPM, GitHub, Docker Hub) can be changed from Admin without rebuilding the API image. Env vars on the compose stack are the baseline; Admin can override stored settings.

Flyway lives in `backend/src/main/resources/db/migration/`. Schema: [database.md](database.md).

## Database

PostgreSQL 16. Local compose publishes `5432` so I can develop. Production compose does **not** publish Postgres to the host. The API reaches it on the Docker network as `cloudbase-postgres`.
