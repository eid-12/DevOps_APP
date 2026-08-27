# API map

Spring Boot on `:8080`. Production hostname `https://api.cloudbase.website`. The SPA calls `/api` (proxied locally, same-site via NPM on live).

JSON. JWT in `Authorization: Bearer`. Validation errors come back as messages the UI already understands.

## Public (no session)

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/auth/login` | |
| POST | `/api/auth/register` | |
| POST | `/api/auth/forgot-password` | 503 if mail off; generic 200 if on; 30 min link |
| POST | `/api/auth/reset-password` | Password-reset JWT |
| POST | `/api/auth/verify-email` | 6-digit code, 15 min TTL |
| POST | `/api/auth/resend-verification` | 60 s cooldown, 5 / hour |
| GET | `/api/auth/github/callback` | OAuth redirect handler on the API |
| GET | `/api/public/platform-status` | Landing metrics |
| GET | `/api/public/app-config` | GitHub client id, `emailEnabled` |
| POST | `/api/webhooks/github` | HMAC required |
| GET | `/actuator/health` | |

## Session

| Method | Path |
|--------|------|
| GET | `/api/auth/me` |
| PATCH | `/api/auth/profile` and password |
| GitHub | connect / repos / disconnect |
| GET | `/api/auth/usage`, plan |
| Notifications | `/api/notifications`, unread-count, mark read |
| CRUD | `/api/projects`, `/api/projects/{id}/services/...` |
| Deploy | deploy, stop, rollback, logs, metrics, exec |
| Network | subdomain, vanity, custom domain, checks |
| Env | service env + project shared variables |

Exact service sub-routes live in `ProjectController`. If a method 404s, the SPA is calling a path I removed — fix the Angular service, not NPM.

## Admin

All under `/api/admin/**`, `ROLE_ADMIN`:

- `GET /users`
- `PATCH /users/{id}/deployment-access`
- `PATCH /users/{id}/account-status`
- `PATCH /users/{id}/role`
- `POST /users/{id}/verify-email`
- `GET /infrastructure`
- `GET /audit-logs`
- Hosting settings GET/PUT
- Email: `GET /email/status`, `POST /email/domain`, `POST /email/preview`
- `POST /users/{id}/password-reset` (30 min link; skips user cooldown)

## WebSocket

`/ws` — deploy events and live bits for a service the JWT can access. Polling still works if the socket drops.

## Postman

I do not keep a collection in this repo. Use the table above or the OpenAPI in my head.
