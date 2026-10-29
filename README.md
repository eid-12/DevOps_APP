# CloudBase

A private PaaS running on a Mini PC: users create projects and services (a GitHub repo, a Docker image or a managed database), and CloudBase deploys them through Portainer and publishes them over HTTPS through Nginx Proxy Manager.

- Live UI: <https://www.cloudbase.website> · API: <https://api.cloudbase.website>
- This repository is the **control plane**: an Angular UI, a Spring Boot API and its Postgres database.

## Repository layout

```text
.
├── backend/                 Spring Boot 3.3 API (Java 17, Maven)
│   ├── Dockerfile
│   ├── pom.xml
│   └── src/
│       ├── main/java/com/cloudbase/      controllers, services, Portainer/NPM/GitHub clients
│       ├── main/resources/
│       │   ├── application.properties    all settings, each bound to an env var
│       │   ├── application-prod.properties
│       │   ├── application-local.properties.example
│       │   └── db/migration/             Flyway migrations V1–V18
│       └── test/java/                    unit tests
├── frontend/                Angular 21 SPA, served by nginx on :3000
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── proxy.conf.json      ng serve proxy for /api and /ws
│   ├── scripts/ensure-env.mjs
│   └── src/
│       ├── app/             pages, core services, shared components
│       ├── environments/    environment.prod.ts, environment.example.ts
│       └── styles/          SCSS
├── deploy/                  everything production
│   ├── docker-compose.prod.yml   the cloudbase-platform Portainer stack
│   ├── .env.example              production variables
│   ├── portainer-deploy.sh       CI/CD rollout + automatic rollback
│   └── test/                     deploy-script tests (mock Portainer)
├── docs/                    architecture, operations, backend and frontend docs
├── .github/workflows/ci-cd.yml
├── docker-compose.yml       local stack, built from source
└── .env.example             local variables
```

## Run it locally

Requirements: Docker; for coding without Docker also JDK 17–25, Maven 3.6.3+ and Node.js 22.

**Everything in Docker:**

```bash
cp .env.example .env          # set DB_PASS, JWT_SECRET, GITHUB_WEBHOOK_SECRET
docker compose up --build
```

UI <http://localhost:4200>, API <http://localhost:8080>, Postgres `localhost:5432`.

**Backend and frontend natively** (faster edit loop):

```bash
docker compose up -d postgres
cp backend/src/main/resources/application-local.properties.example \
   backend/src/main/resources/application-local.properties     # optional integrations
cd backend  && mvn spring-boot:run -Dspring-boot.run.profiles=local
cd frontend && npm ci && npm start                              # http://localhost:4200
```

The API accepts browser calls only from origins in `CLOUDBASE_CORS_ALLOWED_ORIGINS`; both local setups allow `http://localhost:4200`.

### First admin

There are no default accounts. Set `CLOUDBASE_BOOTSTRAP_ADMIN_EMAIL` and `CLOUDBASE_BOOTSTRAP_ADMIN_PASSWORD` before the first start (used only while no admin exists), sign in, and enable **Deploy** for other users under Admin → User Governance. Details: [docs/backend/accounts.md](docs/backend/accounts.md).

## Test

```bash
cd backend  && mvn clean verify                 # unit tests + package
cd frontend && npm ci && npm run build          # strict type/template check + production build
bash deploy/test/run-tests.sh                   # deploy script scenarios (needs bash, curl, jq, node)
```

Verify from clean outputs so stale `target/` classes cannot hide a compile error.

## Deploy

Pushing to `master` runs [`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml): tests, then images `minipcer/cloudbase-{backend,frontend}:<commit sha>`, then [`deploy/portainer-deploy.sh`](deploy/portainer-deploy.sh) updates the Portainer stack with images pinned to that commit and digest, checks health and the running revision, and rolls back automatically on failure. Pull requests run the same checks without any production access.

Required secrets, verification and manual rollback: [docs/operations.md](docs/operations.md).

## Configuration

| File | Used by |
|------|---------|
| `.env.example` → `.env` | local `docker compose up` |
| `deploy/.env.example` | production stack variables (set in Portainer) |
| `backend/src/main/resources/application-local.properties.example` | native backend run |
| `frontend/src/environments/environment.example.ts` | copied to `environment.ts` automatically by `npm start` / `npm run build` |

Never commit `.env`, `application-local.properties` or `environment.ts`; all three are gitignored.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Login fails with "Invalid CORS request" | Add your UI origin to `CLOUDBASE_CORS_ALLOWED_ORIGINS` |
| `Unsupported class file major version` | Use JDK 17 or newer |
| `mvn spring-boot:run` fails in a non-ASCII path | Run `mvn package` and start the JAR from an ASCII path |
| Admin → Infrastructure shows Portainer offline | Check the Portainer URL/key under Admin → Hosting or the stack env |
| `PKIX path building failed` / `unable to get local issuer certificate` | See below |

**Behind a TLS-inspecting proxy or antivirus**, trust its root CA instead of turning verification off (never use `strict-ssl=false`, `-Dmaven.wagon.http.ssl.insecure=true` or `http.sslVerify=false`):

| Tool | Windows (OS certificate store) | macOS / Linux (CA PEM file) |
|------|-------------------------------|------------------------------|
| Maven / JDK | `MAVEN_OPTS=-Djavax.net.ssl.trustStoreType=Windows-ROOT` | `keytool -importcert -cacerts -alias corp-ca -file corp-ca.pem` |
| npm / Node 22.15+ | `NODE_OPTIONS=--use-system-ca` | `NODE_EXTRA_CA_CERTS=/path/corp-ca.pem` |
| git | `git config --global http.sslBackend schannel` | `git config --global http.sslCAInfo /path/corp-ca.pem` |

Docker builds use the image's own CA bundle; if they fail the same way, add the CA in the Dockerfile build stage.

## Documentation

[docs/README.md](docs/README.md) indexes everything: [architecture](docs/architecture.md), [operations and CI/CD](docs/operations.md), backend (API, security, database, accounts, email, GitHub, tenant deploys) and frontend (stack, product).

## License

Internal project for a private server.
