# Architecture

CloudBase is a private PaaS that runs on a Mini PC. Developers get projects, services, logs, metrics and HTTPS URLs; the operator controls who can deploy and how much CPU, RAM and disk they get.

Live UI: [www.cloudbase.website](https://www.cloudbase.website) · Live API: [api.cloudbase.website](https://api.cloudbase.website)

## Three separate systems

1. **Control plane** — this repository: Angular UI, Spring Boot API, Postgres. It stores users, projects and services and tells Portainer and Nginx Proxy Manager what to do.
2. **Runtime** — Docker on the Mini PC (WSL2), managed through Portainer. Nginx Proxy Manager (NPM) owns public HTTPS.
3. **Tenant workloads** — users' apps (GitHub repos, Docker images, databases), each running as its own stack. They are not part of this repo.

Pushing to `master` rebuilds and redeploys the control plane only. See [operations.md](operations.md).

## How the pieces connect

The browser never talks to Portainer or NPM; the API does.

```text
  browser ── HTTPS ──> www.cloudbase.website   Angular, nginx :3000
                           │  /api
                           v
                       api.cloudbase.website   Spring Boot :8080 (Docker network only)
                           ├── Postgres          users, projects, services, deployments
                           ├── Portainer API     stacks, containers, logs, stats ──> Docker
                           ├── NPM API           proxy hosts + TLS for tenant hostnames
                           ├── GitHub            OAuth, repo files, Actions secrets, webhooks
                           └── Registries        Docker Hub platform images; tenant GHCR images
```

| Layer | What it does |
|-------|--------------|
| Portainer | The API sends compose text to `/api/stacks` with an API key; Portainer creates, updates, stops and removes stacks. Logs and CPU/RAM samples come from it too. |
| NPM | After a tenant container is up, the API creates or updates a proxy host (hostname → container on the `cloudbase` network) using the certificate `NPM_CERTIFICATE_ID`. |
| GitHub | For a GitHub service the API adds a Dockerfile if missing, a workflow and a webhook. Builds publish to the tenant's GHCR with the repository's own job token; no platform registry or Portainer credentials are distributed. GitHub calls `POST /api/webhooks/github` (unsigned calls are rejected). |
| Resend (optional) | Verification and reset email. If it is off, signup still works and accounts are marked verified. |

## Control plane

| Part | Technology | Details |
|------|------------|---------|
| UI | Angular 21, PrimeNG 21, SCSS; nginx on port 3000 in production | [frontend/stack.md](frontend/stack.md), [frontend/product.md](frontend/product.md) |
| API | Spring Boot 3.3 (Java 17), JWT, JPA, Flyway | [backend/stack.md](backend/stack.md), [backend/api.md](backend/api.md) |
| Database | PostgreSQL 16; migrations in `backend/src/main/resources/db/migration/` | [backend/database.md](backend/database.md) |

Hosting credentials (Portainer, NPM, GitHub, Docker Hub) come from the stack's environment and can be overridden from Admin → Hosting without rebuilding the image.

## Runtime on the Mini PC

| Stack | Public name | Job |
|-------|-------------|-----|
| Portainer | `manage.cloudbase.website` | Docker UI and the API CloudBase calls (endpoint id **3**, named `local`) |
| Nginx Proxy Manager | `npm.cloudbase.website` | Reverse proxy and TLS |
| `cloudbase-platform` (stack 44) | `www`, `api` | `cloudbase-postgres`, `cloudbase-backend`, `cloudbase-frontend` |

All three join the Docker network `cloudbase`, so NPM reaches `cloudbase-frontend:3000` and `cloudbase-backend:8080` by name. Neither the API nor Postgres is published on a host port. The production stack definition is [`deploy/docker-compose.prod.yml`](../deploy/docker-compose.prod.yml); deploys pin both CloudBase images to a commit SHA and digest.

### Reserved hostnames

Tenants cannot claim these as vanity names: `www`, `api`, `manage`, `npm` and `mawrid` (the mail domain) under `cloudbase.website`.

- GitHub OAuth callback: `https://www.cloudbase.website/auth/github/callback`
- GitHub webhook: `https://api.cloudbase.website/api/webhooks/github`

A tenant service gets a random host (`cloudbase8472.cloudbase.website`), one vanity name per account, or a custom domain CNAMEd to the platform. See [backend/deploy.md](backend/deploy.md).

### Isolation and data

- Generated compose sets CPU and memory limits per service; start commands are argv only (no shell).
- Volume mounts cannot target `/etc`, `/proc` and similar host paths; tenant data lives under `CLOUDBASE_VOLUME_ROOT` (`/var/lib/cloudbase/users`).
- CloudBase's own data is the Postgres volume `cloudbase-platform_cloudbase_postgres_data`. If Portainer cannot remove a tenant stack, the database row is kept.

## Roles

| Role | Can do |
|------|--------|
| USER | Projects, services, deploys, logs, metrics, domains — once an admin enables Deploy |
| ADMIN | Users and the deploy gate, hosting settings, infrastructure view, audit trail |

Details: [backend/accounts.md](backend/accounts.md).
