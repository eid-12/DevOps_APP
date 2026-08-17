# CloudBase

A private PaaS that runs on a **Mini PC** (Windows + WSL2 + Docker).  
Developers deploy projects (GitHub / Docker Image / Database) as containers via **Portainer**, with public URLs through **Nginx Proxy Manager** (optional tunnel supported).

> This file is the short entry point for the whole project. Deeper architecture notes live in [`docs/architecture.md`](docs/architecture.md).

---

## Idea in brief

| Role | What they do |
|------|----------------|
| **USER** | Create projects/services, deploy, view logs/metrics, attach domains, edit Start command |
| **ADMIN** | Manage users, hosting settings (Portainer/NPM/GitHub), infrastructure, audit |

**Typical GitHub deploy path:**  
Connect repo → inject Dockerfile + GitHub Actions + webhook → build image on GitHub → notify Backend → create/update Portainer stack → NPM proxy host → `https://…` URL

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | **Angular 18** + TypeScript + PrimeNG |
| API | **Spring Boot 3.3** / **JDK 17** + Security + JWT + JPA + Flyway + WebSocket |
| Database | **PostgreSQL 16** |
| Containers | **Docker** + **Portainer** (Stacks / Logs / Exec / Metrics) |
| Routing & SSL | **Nginx Proxy Manager** |
| Email (optional) | **Resend** |
| Images | **Docker Hub** + GitHub Actions |

---

## Repository layout

```text
DevOps_APP/
├── README.md                 ← you are here
├── docker-compose.yml        ← postgres + backend + frontend
├── docs/
│   ├── architecture.md       ← detailed architecture
│   └── wireframes.txt
├── backend/                  ← Spring Boot (control plane)
│   ├── Dockerfile
│   ├── pom.xml
│   └── src/main/
│       ├── java/com/cloudbase/
│       │   ├── controller/   Auth, Projects, Admin, Webhooks, Notifications
│       │   ├── security/     JWT filter + SecurityConfig
│       │   ├── portainer/    PortainerClient, ComposeGenerator
│       │   ├── npm/          NpmClient
│       │   ├── github/       OAuth + repo/CI helpers
│       │   └── service/      Orchestration, quotas, vanity, validators…
│       └── resources/
│           ├── application.properties
│           └── db/migration/   V1 … V14 (Flyway)
└── frontend/                 ← Angular SPA
    ├── proxy.conf.json       /api → :8080
    └── src/app/
        ├── core/             auth, guards, API, interceptors
        ├── features/         lazy routes
        ├── pages/            dashboard, projects, admin, account…
        └── shared/           UI helpers, start-command defaults
```

---

## Key features

### Account & session
- Register / login / email verify / forgot password
- **JWT** default session length **2 hours** (`JWT_EXPIRATION_MS=7200000`)
- Warning ~5 minutes before expiry, then auto logout
- Account states: `ACTIVE` / `PENDING_ACTIVATION` / `SUSPENDED`
- Deploy gate: `deploymentEnabled` (admin enables it)
- **Strict lock without Enable Deploy:** no create/update/delete of projects or services; no Deploy/Stop/Restart/Rollback; no Env/Domain/Vanity; no Terminal — GitHub webhooks are also rejected. Admin only is exempt. Read-only browsing is allowed.
- **Strict delete:** type the exact project/service name to confirm. Backend tears down Portainer first; if Portainer is down or refuses, CloudBase keeps the DB record (no silent delete).
- **Delete project = full wipe:** all services, deployments, shared variables, vanity/custom domains, Portainer stacks/containers/volumes, NPM proxies, and the project Docker network.

### Frontend protection
- Guards on all protected pages (`canMatch` + `canActivate`)
- A token in `localStorage` is not enough — validates token + `/auth/me`
- Admin page always re-validates (prevents role spoofing)
- Safe `returnUrl` only (same origin, no open redirect)

### Projects & services
Source types:
1. **GITHUB** — connect repo, runtime, Start command, auto-deploy
2. **DOCKER** — pull a ready image + internal port
3. **DATABASE** — Postgres / MySQL / Redis / Mongo (internal network only)

Per service (by type): env vars, volume, Deploy / Rollback, Logs, Metrics, Terminal, project-level shared variables.

### URLs & domains
| Type | Meaning |
|------|---------|
| **Platform URL (random)** | e.g. `cloudbase8472.cloudbase.website` — assigned automatically |
| **Vanity subdomain** | **one subdomain per account**, e.g. `myapp.cloudbase.website` — Check then Claim |
| **Custom domain** | your domain (`app.example.com`) — Check availability then Save + CNAME |

Vanity rules: length 3–30, reserved names (`admin`, `api`, `www`…), random-looking `cloudbase####` forms blocked.

### Start command
Editable field (PaaS-style), e.g. Java:

```text
java -Xmx512m -jar /app/app.jar
```

**Strict backend security:**
- Not run via `sh -c` — direct argv only
- No shell injection: `| & ; $ \` \` < >`
- Allowed binaries only (`java`, `python`, `node`, `nginx`…) or a path under `/app/`
- Blocked: `curl` / `wget` / `bash` / `sudo` / `docker` / `..`
- Max length ~400 chars

After editing: **Redeploy** so Compose picks up the command.

### Quotas (Free plan)
- Soft/marketing limits: project/service/deploy counts
- **Hard enforced:** account-level RAM / CPU / Storage  
  (roughly: 4096 MB RAM, 2000m CPU, 5 GB storage — see `FreePlanLimits` / Plan API)

### Admin — Hosting
From the Admin panel you can tune runtime settings without rebuilding code:  
Portainer URL/API key, NPM, GitHub OAuth, Docker Hub, base domain, volume root, public API URL…  
Secrets are masked and left unchanged when the field is left empty.

---

## Local run

### Requirements
- **JDK 17** (important: JDK 8 on PATH breaks Maven)
- Node.js + npm
- Docker (at least for Postgres, or for the full stack)
- Maven installed (`mvn`) — there is no `mvnw` in the repo yet

### A) Everything with Docker Compose

```bash
docker compose up --build
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:4200 |
| Backend API | http://localhost:8080 |
| Postgres | localhost:5432 |

### B) Split local development (recommended while coding)

**1) Postgres** (compose service only):

```bash
docker compose up -d postgres
```

**2) Backend**

```bash
cd backend
# ensure JAVA_HOME = JDK 17
mvn spring-boot:run -Dspring-boot.run.profiles=local
```

**3) Frontend**

```bash
cd frontend
npm install
npm start
```

Proxy forwards `/api` to `http://localhost:8080`.

---

## Demo accounts (seed)

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@cloudbase.dev` | `Admin@2026` |
| Developer | `dev@cloudbase.dev` | `Dev@2026` |

---

## Frontend routes

| Path | Who |
|------|-----|
| `/` | Landing (guest) |
| `/auth` | Login / register / verify / reset |
| `/dashboard` | Developer dashboard |
| `/projects/:projectId` | Project detail |
| `/projects/:projectId/services/:serviceId` | Service detail (Network / Settings / Deploy…) |
| `/account` | Account & GitHub |
| `/billing` | Plan & usage |
| `/help` | Help |
| `/admin` | Admin only |

---

## API surface (summary)

| Group | Examples |
|-------|----------|
| `/api/auth/**` | login, register, me, plan, usage, GitHub OAuth, profile |
| `/api/projects/**` | projects, services, deploy, logs, domains, vanity, variables |
| `/api/admin/**` | users, hosting-settings, infrastructure, audit |
| `/api/notifications/**` | in-app notifications |
| `/api/webhooks/github` | public webhook (with secret) |
| `/ws` | STOMP/SockJS (deploy status / logs) |
| `/actuator/health` | health check |

Postman collection: `frontend/postman/CloudBase.API.postman_collection.json`

---

## Important environment variables

| Variable | Purpose | Dev default |
|----------|---------|-------------|
| `DB_URL` / `DB_USER` / `DB_PASS` | Postgres | `jdbc:postgresql://localhost:5432/cloudbase` / `cloudbase` / `cloudbase_secret` |
| `JWT_SECRET` | Signing key (≥ 32 chars) | Dev-only value — **change in production** |
| `JWT_EXPIRATION_MS` | Session length in ms | `7200000` (2 hours) |
| `PORTAINER_URL` / `PORTAINER_API_KEY` / `PORTAINER_ENDPOINT_ID` | Portainer | `http://localhost:9000` |
| `NPM_ENABLED` / `NPM_URL` / `NPM_EMAIL` / `NPM_PASSWORD` | NPM | Disabled by default |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `GITHUB_REDIRECT_URI` | OAuth | — |
| `GITHUB_WEBHOOK_SECRET` | Webhook verification | — |
| `CLOUDBASE_BASE_DOMAIN` | Platform domain | `cloudbase.website` |
| `CLOUDBASE_DOCKER_NETWORK` | Shared Docker network | `cloudbase` |
| `CLOUDBASE_VOLUME_ROOT` | Bind-mount root | `/var/lib/cloudbase/users` |
| `CLOUDBASE_PUBLIC_API_URL` | Public API URL for webhook registration | — |
| `DOCKER_HUB_USERNAME` / `DOCKER_HUB_TOKEN` | Image push/pull | — |
| `RESEND_API_KEY` / `RESEND_FROM` | Email | Disabled by default |

Reference file: `backend/src/main/resources/application.properties`  
Many hosting settings can also be changed from **Admin → Hosting**.

---

## Security — things to know

1. **Time-limited sessions** — default 2 hours; then login again.  
2. **Pages are guarded** — typing a URL without a valid session → `/auth`.  
3. **Start command is locked down** — no shell, no network tools, no paths outside `/app`.  
4. **Volumes** — host path is platform-owned; users only set the in-container path (blocks `/etc`, `/proc`…).  
5. **One vanity per user** — everything else is random, harder-to-guess URLs.  
6. **Admin API** requires `ROLE_ADMIN`; sensitive Actuator endpoints are admin-only.  
7. **Webhooks** are secret-verified; known demo images/pages may be rejected at deploy time.

---

## Database / migrations

Flyway under `backend/src/main/resources/db/migration/`:

- Users, projects, services, deployments, settings…
- Including: custom domains, notifications, platform settings, **vanity subdomain** (`V14`)

Migrations apply automatically on first Backend start.

---

## Common troubleshooting

| Problem | Quick fix |
|---------|-----------|
| `Unsupported class file major version` / Maven fails | Install **JDK 17** and set `JAVA_HOME` |
| Port 8080 in use | Stop the old process or change `server.port` |
| UI stays on mock only | Ensure `useApi: true` in environment and Backend is running |
| Portainer offline | Check URL/API key in Admin → Hosting or env |
| Windows DNS to Portainer sometimes fails | Retry / check Docker Desktop and WSL |

---

## Current project status

The platform is **actually integrated** (not mock-only): JWT auth, projects/services, Portainer deploys, domains, vanity, hardened Start command, admin panel, and resource quotas.  
Older README drafts described an earlier scaffold + mock stage — this file matches the current state.

---

## Quick links in the repo

- Detailed architecture: [`docs/architecture.md`](docs/architecture.md)
- Runtime settings: [`backend/src/main/resources/application.properties`](backend/src/main/resources/application.properties)
- Compose: [`docker-compose.yml`](docker-compose.yml)
- Start command checks: `StartCommandValidator.java`
- Volume path checks: `VolumeMountValidator.java`
- Vanity: `VanitySubdomainService.java`

---

## License / ownership

Internal CloudBase project for your private server. Do not commit production secrets (`JWT_SECRET`, Portainer/NPM/GitHub/Docker Hub keys) to Git.
  