# Backend docs

Spring Boot control plane (`backend/`). Start here for **what it is built from**, then jump to behavior.

| File | What it covers |
|------|----------------|
| [stack.md](stack.md) | **Technologies:** Tomcat vs Netty, WebSocket/STOMP, JWT, JPA, Flyway, Resend, Maven |
| [api.md](api.md) | HTTP routes and WebSocket topics |
| [security.md](security.md) | Auth, secrets, isolation |
| [database.md](database.md) | Postgres tables, Flyway V1–V18 |
| [data.md](data.md) | Project / service / deploy / delete rules |
| [accounts.md](accounts.md) | Signup, roles, deploy gate, first admin |
| [email.md](email.md) | Resend protocol, TTLs, rate limits |
| [github.md](github.md) | OAuth, CI bootstrap, webhooks |
| [deploy.md](deploy.md) | GitHub / image / database path to a URL |
| [networking.md](networking.md) | NPM, reserved hosts, vanity, custom domains |
| [quotas.md](quotas.md) | Free-plan RAM / CPU / disk |

System map (both sides): [../README.md](../README.md). Frontend: [../frontend/README.md](../frontend/README.md).
