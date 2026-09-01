# Backend stack

This is the catalog of **what the API actually runs on**. Product behavior lives in the other files in this folder. HTTP routes: [api.md](api.md).

The JVM does **two different network jobs**. Mixing them is how “we use Netty” becomes confusing.

| Direction | Stack | Job |
|-----------|--------|-----|
| **Inbound** (browser / GitHub → us) | Spring MVC on **embedded Tomcat** | REST `/api/**`, actuator, STOMP `/ws` |
| **Outbound** (us → Portainer / NPM / GitHub / Docker Hub) | Spring **WebClient** on **Reactor Netty** | HTTP calls the Mini PC and GitHub |

Netty is **not** the public HTTP server. It is the client used to talk *out*.

## Runtime

| Piece | Version / choice | Where |
|-------|------------------|--------|
| Language | Java **17** | `backend/pom.xml` `<java.version>` |
| Framework | Spring Boot **3.3.2** | parent POM |
| Build | Maven | `backend/pom.xml` |
| Process | `java -jar app.jar` | `backend/Dockerfile` (Temurin 17 JRE Alpine) |
| Profile | `prod` in the image | `SPRING_PROFILES_ACTIVE=prod` |
| Listen | `:8080` | `server.port` |
| Package | `com.cloudbase` | `CloudBaseApplication` |

`CloudBaseApplication` enables scheduling (`@EnableScheduling`) so metrics polling and stale-deploy cleanup run inside this same process. There is no separate worker.

## Inbound HTTP (Tomcat, not Netty)

`spring-boot-starter-web` pulls **embedded Tomcat** (Servlet 6). Controllers are classic `@RestController` + blocking JPA. JSON is Jackson. Bean Validation (`jakarta.validation`) runs on request DTOs.

| Library | Starter | Used for |
|---------|---------|----------|
| Spring MVC | `starter-web` | All `/api/**` controllers |
| Validation | `starter-validation` | `@Valid` on login, register, env, domains |
| Actuator | `starter-actuator` | `/actuator/health`, `/actuator/info` (admin for the rest) |
| CORS | `WebConfig` | localhost:4200 + `www.cloudbase.website` |

Errors become a JSON body `{ timestamp, status, error, message }` in `ApiExceptionHandler`. The SPA shows `message`. Unexpected exceptions never leak a stack trace to the client.

## Outbound HTTP (Netty)

`spring-boot-starter-webflux` is on the classpath **for `WebClient`**, not because this API is a WebFlux server. There is no `spring.main.web-application-type=reactive`.

Reactor Netty `HttpClient` is wired in `WebClientConfig`:

1. **DNS** — `DefaultAddressResolverGroup.INSTANCE` (JDK resolver). Netty’s native DNS resolver breaks on some Mini PC / home-router setups.
2. **TLS on Windows** — trust store `Windows-ROOT`. Antivirus SSL inspection (e.g. Norton) installs a local CA that browsers trust and `cacerts` does not. Without this, GitHub calls fail with PKIX.
3. **Connector** — `ReactorClientHttpConnector` on every `WebClient.Builder`.

Clients that go out over this stack:

| Class | Talks to |
|-------|----------|
| `PortainerClient` | Portainer HTTP API (stacks, logs, stats, exec) |
| `NpmClient` | Nginx Proxy Manager (`/api/tokens`, proxy hosts) |
| `GitHubOAuthClient` | GitHub OAuth + user REST |
| `GitHubRepoClient` | GitHub Contents + Hooks |
| `DeploymentOrchestrator` `publicHttp` | Verify step: GET the public tenant URL |

Portainer and NPM rebuild their `WebClient` when Admin Hosting settings change (`PlatformSettingsService` listeners).

## WebSocket (STOMP over SockJS)

Library: `spring-boot-starter-websocket`. This is **Spring Messaging on the servlet container**, still Tomcat. It is not a standalone Netty WebSocket server.

| Piece | Value |
|-------|--------|
| Endpoint | `/ws` + SockJS fallbacks (`/ws/info`, `/ws/websocket`, …) |
| Protocol | STOMP frames over that socket |
| Broker | In-memory simple broker, prefix `/topic` |
| App prefix | `/app` (unused today; we only publish server → client) |
| Auth | JWT on STOMP `CONNECT` (`Authorization: Bearer` or `token` header) |
| Authorization | `SUBSCRIBE` only to a service the user owns (admins see all) |

Config: `WebSocketConfig`. Guard: `StompAuthChannelInterceptor`.

Publisher: `DeploymentEventPublisher` (`SimpMessagingTemplate`).

| Topic | Payload |
|-------|---------|
| `/topic/deployments/{serviceId}` | status, stage, errorMessage, timestamps |
| `/topic/services/{projectId}` | service status for the project canvas |
| `/topic/logs/{serviceId}` | one log line + timestamp |

Subscribe regex on the interceptor is `/topic/(deployments\|logs)/{serviceId}`. Password-reset and OAuth-state JWTs are rejected (`purpose` claim). If the socket drops, the SPA still polls HTTP logs/status.

Route list: [api.md](api.md). Product stages: [deploy.md](deploy.md).

## Security

| Library | Job |
|---------|-----|
| `starter-security` | Filter chain, CSRF off, **stateless** sessions |
| `jjwt` **0.12.6** | HMAC-SHA session / reset / OAuth-state tokens |
| BCrypt | Password hashes (`SecurityConfig` `PasswordEncoder` bean) |

`JwtAuthFilter` runs before username/password auth. It loads the user from Postgres and sets `ROLE_USER` or `ROLE_ADMIN`. Suspended accounts get no context.

Three JWT kinds, same signing key, different `purpose`:

| Token | TTL | `purpose` |
|-------|-----|-----------|
| Session | 2 hours (`JWT_EXPIRATION_MS`) | (none) |
| Password reset | 30 minutes | `password_reset` |
| GitHub OAuth state | 10 minutes | `github_oauth` |

Webhook path is `permitAll` at Spring Security; `WebhookController` still requires HMAC `X-Hub-Signature-256`. Details: [security.md](security.md).

## Persistence

| Library | Job |
|---------|-----|
| Spring Data JPA | Repositories + entities |
| Hibernate | ORM; `ddl-auto=validate` — it does **not** create tables |
| Flyway | Schema `V1`–`V18` in `backend/src/main/resources/db/migration/` |
| PostgreSQL JDBC | Driver; DB name `cloudbase` |

JSON columns (`source_details`, `env_vars`, `shared_variables`) are `jsonb` via `@JdbcTypeCode(SqlTypes.JSON)`.

Schema: [database.md](database.md). Product language: [data.md](data.md).

## Email

`com.resend:resend-java:4.13.0`. HTTPS to Resend, not SMTP from the Mini PC. Domain `mawrid.cloudbase.website`.

Rate limits live in-memory in `EmailRateLimiter` (one JVM replica; restart clears windows). Protocol: [email.md](email.md).

## GitHub extras

Writing Actions secrets uses GitHub’s libsodium sealed box. Java does not do that natively here: `GitHubSecretEncryptor` shells out to `python backend/scripts/github_secret_encrypt.py` (PyNaCl). OAuth, repo files, webhooks: [github.md](github.md).

## Scheduling (same JVM)

| Class | Interval | Job |
|-------|----------|-----|
| `ServiceMetricsService` | 60s (`cloudbase.metrics.poll-ms`) | CPU/RAM samples for RUNNING services |
| `StaleDeploymentCleanup` | 120s | Fail QUEUED/BUILDING/DEPLOYING older than 20 minutes |
| `BootstrapAdminRunner` | once at boot | First ADMIN from env, if none exists |
| `ProductionSecretsValidator` | once at boot | Refuse default JWT / DB / empty webhook secret on `prod` |
| `OpaqueDomainMigrator` | once at boot | DATABASE services stay private; refresh NPM hosts |

## Code layout (`backend/src/main/java/com/cloudbase`)

| Package | Job |
|---------|-----|
| `controller` | HTTP surface only |
| `service` + `service.impl` | Rules: ownership, quotas, deploy gate |
| `DeploymentOrchestrator` | Portainer stack + NPM host + deployment rows |
| `portainer` | Compose YAML + Portainer HTTP |
| `npm` | Proxy hosts + TLS |
| `github` | OAuth, repo bootstrap, secret encrypt |
| `email` | Resend + rate limit |
| `security` | JWT + filter + `SecurityConfig` |
| `config` | CORS, WebClient/Netty, WebSocket, boot runners, errors |
| `entity` / `repository` | JPA |
| `dto` | Request/response records |
| `model` | Enums + API-facing records (not tables) |

## What we did **not** take

| Common guess | Reality |
|--------------|---------|
| Netty as the API server | Tomcat serves `/api` and `/ws` |
| Spring WebFlux controllers | None. WebFlux is client-only |
| Redis / Kafka / Rabbit | In-memory STOMP broker + in-memory email limiter |
| Hibernate creating schema | Flyway only |
| SMTP | Resend HTTPS |
| Docker Java SDK | Portainer HTTP API |

## Maven dependencies (source of truth)

From `backend/pom.xml`:

- `spring-boot-starter-web`
- `spring-boot-starter-validation`
- `spring-boot-starter-actuator`
- `spring-boot-starter-websocket`
- `spring-boot-starter-security`
- `jjwt-api` / `jjwt-impl` / `jjwt-jackson` 0.12.6
- `spring-boot-starter-data-jpa`
- `postgresql`
- `flyway-core` + `flyway-database-postgresql`
- `spring-boot-starter-webflux` (WebClient + Netty)
- `resend-java` 4.13.0
- `lombok` (compile-only)
- `spring-boot-starter-test` + `spring-security-test`

## Config files

| File | Job |
|------|-----|
| `application.properties` | Datasource, JWT, Portainer, NPM, GitHub, Resend, topology |
| `application.yml` | GitHub OAuth + Resend + actuator (YAML overlay) |
| `application-prod.properties` | Force real `JWT_SECRET` / `DB_PASS` / `GITHUB_WEBHOOK_SECRET` |
| `application-local.properties` | Local overrides (not committed with secrets) |
