# Docs

Two product folders, plus a thin system map at this root.

```text
docs/
├── README.md                 this index
├── overview.md               what CloudBase is
├── architecture.md           how the layers connect
├── control-plane.md          this git repo (UI + API + Postgres)
├── runtime.md                Mini PC: Docker, Portainer, NPM
├── operations.md             how I update the live site
├── frontend/                 Angular SPA
└── backend/                  Spring Boot API  ← technologies (Netty, WebSocket, …)
```

## Frontend

| File | What it covers |
|------|----------------|
| [frontend/README.md](frontend/README.md) | Index |
| [frontend/stack.md](frontend/stack.md) | Angular 18, PrimeNG, interceptors, SockJS |
| [frontend/product.md](frontend/product.md) | Screens and user journeys |

## Backend

| File | What it covers |
|------|----------------|
| [backend/README.md](backend/README.md) | Index |
| [backend/stack.md](backend/stack.md) | **Tomcat vs Netty, WebSocket/STOMP, JWT, JPA, Flyway, Maven** |
| [backend/api.md](backend/api.md) | HTTP and WebSocket routes |
| [backend/security.md](backend/security.md) | Auth, secrets, isolation |
| [backend/database.md](backend/database.md) | Postgres tables, Flyway |
| [backend/data.md](backend/data.md) | Projects, services, deployments, delete |
| [backend/accounts.md](backend/accounts.md) | Signup, roles, deploy gate |
| [backend/email.md](backend/email.md) | Resend protocol |
| [backend/github.md](backend/github.md) | OAuth, CI bootstrap, webhooks |
| [backend/deploy.md](backend/deploy.md) | Path from source to a URL |
| [backend/networking.md](backend/networking.md) | NPM, vanity, custom domains |
| [backend/quotas.md](backend/quotas.md) | Free-plan RAM / CPU / disk |

## System (this folder)

| File | What it covers |
|------|----------------|
| [overview.md](overview.md) | What CloudBase is, and what it is not |
| [architecture.md](architecture.md) | How the layers connect |
| [control-plane.md](control-plane.md) | This git repo: UI, API, Postgres |
| [runtime.md](runtime.md) | Mini PC: Docker, Portainer, NPM |
| [operations.md](operations.md) | How I update the live CloudBase site |

Root [README.md](../README.md) is the runbook: local start, env vars, routes.

Read **overview → architecture**, then [backend/stack.md](backend/stack.md) if you are looking at the API. The rest is lookup.
