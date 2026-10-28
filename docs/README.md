# Documentation

Start with [architecture.md](architecture.md) for the system map, and [operations.md](operations.md) for CI/CD, deploys and rollback.

| Topic | File |
|-------|------|
| System map: control plane, Mini PC runtime, hostnames, isolation | [architecture.md](architecture.md) |
| CI/CD, production deploys, required secrets, rollback | [operations.md](operations.md) |

## Backend (`backend/`)

| Topic | File |
|-------|------|
| Technologies: Tomcat vs Netty, WebSocket/STOMP, JWT, JPA, Flyway, Maven | [backend/stack.md](backend/stack.md) |
| HTTP routes and WebSocket topics | [backend/api.md](backend/api.md) |
| Authentication, secrets, CORS, isolation | [backend/security.md](backend/security.md) |
| Domain model, Postgres tables, Flyway, delete order | [backend/database.md](backend/database.md) |
| Signup, roles, deploy gate, first admin, quotas | [backend/accounts.md](backend/accounts.md) |
| Email (Resend): verification, reset, rate limits | [backend/email.md](backend/email.md) |
| GitHub OAuth, CI bootstrap, webhooks | [backend/github.md](backend/github.md) |
| Tenant deploys (GitHub, image, database), networking and domains | [backend/deploy.md](backend/deploy.md) |

## Frontend (`frontend/`)

| Topic | File |
|-------|------|
| Angular 18, PrimeNG, services, interceptors, polling | [frontend/stack.md](frontend/stack.md) |
| Screens and user journeys | [frontend/product.md](frontend/product.md) |
