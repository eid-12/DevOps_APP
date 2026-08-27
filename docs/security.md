# Security

I assume the Mini PC is on a home or office network. The control plane is still locked down as if it were on the internet — because `www` and `api` are.

## What the browser is allowed to see

JWT in `localStorage`, public GitHub client id, their own projects. Not Portainer API keys, not NPM password, not `GITHUB_CLIENT_SECRET`, not webhook secret, not Docker Hub token.

Admin Hosting shows “configured” hints, not the raw secret, unless I type a new one to rotate it.

## Auth

- BCrypt passwords
- JWT, default 2 hours
- `/api/admin/**` needs `ROLE_ADMIN`
- `/api/webhooks/**` is permit-all at Spring Security **but** the handler rejects bad HMAC
- `/ws` needs a session JWT; topics are limited to services that user can access
- `/api/public/**` cached + rate-limited

## Runtime isolation

- Compose CPU and memory limits per service
- Start command is argv (no `sh -c`)
- Volume paths cannot target `/etc`, `/proc`, and similar
- Tenant containers are not given the Docker socket
- Postgres for CloudBase is not published on the host in production

## Secrets in git

Never commit `.env`, `application-local.properties`, or `frontend/src/environments/environment.ts`. Compose refuses to start without `DB_PASS`, `JWT_SECRET`, `GITHUB_WEBHOOK_SECRET`. Prod profile also refuses a weak JWT.

## Delete

Type the exact name. Tear down Portainer first. If that fails, keep the DB row. See [data.md](data.md).
