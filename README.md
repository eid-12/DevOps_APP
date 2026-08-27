# CloudBase

Private PaaS for a Mini PC (Windows + WSL2 + Docker). Developers ship GitHub repos, Docker images, and databases as containers through **Portainer**, with public HTTPS URLs via **Nginx Proxy Manager**.

**Live:** [www.cloudbase.website](https://www.cloudbase.website) · API: [api.cloudbase.website](https://api.cloudbase.website)

How the system is split: [`docs/README.md`](docs/README.md).

---

## Roles

| Role | Access |
|------|--------|
| **USER** | Projects, services, deploy, logs, metrics, domains |
| **ADMIN** | Users, hosting tokens, infrastructure, audit, first-admin bootstrap |

**GitHub deploy path:** connect repo → Dockerfile + GitHub Actions + webhook → image build on GitHub → backend updates the Portainer stack → NPM proxy → `https://…`

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Angular 18, TypeScript, PrimeNG |
| API | Spring Boot 3.3, JDK 17, JWT, JPA, Flyway, WebSocket |
| Database | PostgreSQL 16 |
| Runtime | Docker + Portainer |
| Routing / TLS | Nginx Proxy Manager |
| Email | Resend (optional) |
| Images | Docker Hub + GitHub Actions |

---

## Layout

```text
DevOps_APP/
├── docker-compose.yml          local: postgres + backend + frontend
├── docker-compose.prod.yml     live images on the Mini PC
├── docs/                       control plane vs runtime vs deploy
├── backend/                    Spring Boot API
└── frontend/                   Angular SPA (`/api` proxied to :8080)
```

---

## Features

- Register, login, email verification, password reset
- JWT sessions (default 2 hours)
- Deploy gate: admin must enable `deploymentEnabled` (admins are exempt)
- GitHub, Docker image, or managed database services
- Deploy stages in the UI: Queued → Building → Deploying → Verify → Success/Failed
- Logs merge the deploy trail with Portainer container output
- Random platform host, one vanity subdomain per account, or a custom domain
- Hard quotas: RAM, CPU, storage
- Admin hosting settings (Portainer, NPM, GitHub) without rebuilding

**Delete is strict:** type the exact name. Portainer is torn down first; if that fails, the database row stays.

---

## Accounts

There are **no default logins**. Seed admin/developer accounts are removed on migrate (`V18`).

1. Register at `/auth`. If email (Resend) is on, verify the 6-digit code. If email is off, the account is ready immediately.
2. Promote the first administrator in Postgres (or set `CLOUDBASE_BOOTSTRAP_ADMIN_EMAIL` / `CLOUDBASE_BOOTSTRAP_ADMIN_PASSWORD` on first boot):

```sql
UPDATE users
SET role = 'ADMIN',
    account_status = 'ACTIVE',
    email_verified = TRUE,
    deployment_enabled = TRUE
WHERE email = 'you@your-domain';
```

3. From **Admin → User Governance**, enable Deploy for other users.

---

## Hostnames (`cloudbase.website`)

These names are reserved so tenants cannot claim them as vanity URLs.

### Live production

| Hostname | Service |
|----------|---------|
| [`www.cloudbase.website`](https://www.cloudbase.website) | CloudBase UI |
| [`api.cloudbase.website`](https://api.cloudbase.website) | Public API + GitHub webhooks (`CLOUDBASE_PUBLIC_API_URL`) |
| `manage.cloudbase.website` | Portainer |
| `npm.cloudbase.website` | Nginx Proxy Manager |
| `mawrid.cloudbase.website` | Transactional email |

GitHub OAuth callback: `https://www.cloudbase.website/auth/github/callback`  
Webhook URL: `https://api.cloudbase.website/api/webhooks/github`

Tenant apps stay on random hosts (`cloudbase8472.cloudbase.website`) or one claimed vanity (`myapp.cloudbase.website`).

---

## Local run

Needs **JDK 17**, Node.js, Docker, and Maven.

### Docker Compose

```bash
docker compose up --build
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:4200 |
| API | http://localhost:8080 |
| Postgres | localhost:5432 |

### Split (coding)

```bash
docker compose up -d postgres

cd backend
# JAVA_HOME must be JDK 17
mvn spring-boot:run -Dspring-boot.run.profiles=local

cd frontend
npm install
npm start
```

---

## Production checklist

Copy `.env.example` to `.env` and fill real secrets. Docker Compose **will not start** without `DB_PASS`, `JWT_SECRET`, and `GITHUB_WEBHOOK_SECRET`.

| Variable | Required |
|----------|----------|
| `JWT_SECRET` | Yes — ≥ 32 random characters |
| `DB_PASS` | Yes — not the development default |
| `PORTAINER_URL` / `PORTAINER_API_KEY` / `PORTAINER_ENDPOINT_ID` | Yes |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `GITHUB_REDIRECT_URI` | For GitHub login |
| `GITHUB_WEBHOOK_SECRET` | **Required** — unsigned webhooks are rejected |
| `CLOUDBASE_BASE_DOMAIN` | Yes (e.g. `cloudbase.website`) |
| `CLOUDBASE_PUBLIC_API_URL` | Yes — public HTTPS API, no trailing slash |
| `CLOUDBASE_BOOTSTRAP_ADMIN_EMAIL` / `CLOUDBASE_BOOTSTRAP_ADMIN_PASSWORD` | First admin only (ignored after one ADMIN exists) |
| `NPM_*` | If NPM is enabled |
| `RESEND_API_KEY` / `RESEND_FROM` | If email is enabled |
| `DOCKER_HUB_USERNAME` / `DOCKER_HUB_TOKEN` | For private images |

Start the API with `--spring.profiles.active=prod` (Compose already sets this). GitHub webhook URL: `{API_ORIGIN}/api/webhooks/github`.

---

## Routes

| Path | Who |
|------|-----|
| `/` | Landing |
| `/auth` | Sign in / register / reset |
| `/dashboard` | Projects |
| `/projects/:id` | Project |
| `/projects/:id/services/:id` | Service (logs, deploy, network) |
| `/account` | Profile & GitHub |
| `/billing` | Plan & usage |
| `/help` | Help |
| `/admin` | Admin |

API groups: `/api/auth/**`, `/api/projects/**`, `/api/admin/**`, `/api/notifications/**`, `/api/public/platform-status`, `/api/webhooks/github`, `/ws`, `/actuator/health`.

Postman: `frontend/postman/CloudBase.API.postman_collection.json`.

---

## Security notes

- Sessions expire; protected routes require a live `/auth/me` check.
- Start commands are argv-only (no shell). Volumes cannot target `/etc`, `/proc`, …
- `/api/admin/**` requires `ROLE_ADMIN`.
- GitHub webhooks **require** `GITHUB_WEBHOOK_SECRET`. Unsigned payloads are rejected.
- `/ws` requires a session JWT; log/deploy topics are limited to services you can access.
- `/api/public/platform-status` is cached and rate-limited.
- Never commit `JWT_SECRET`, Portainer keys, NPM passwords, GitHub secrets, `.env`, or `frontend/src/environments/environment.ts`.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Maven / `Unsupported class file major version` | JDK 17 on `JAVA_HOME` |
| Port 8080 busy | Stop the old Java process |
| UI talks to mock data | `useApi: true` in local `environment.ts` |
| Portainer offline | Admin → Hosting, or env vars |
| Arabic/non-ASCII project path breaks `mvn spring-boot:run` | Package the JAR, copy it to an ASCII path, run `java -jar` |

Flyway migrations live in `backend/src/main/resources/db/migration/` (`V1`–`V18`) and run on backend start.

---

## License

Internal CloudBase project for a private server.
