# Security

I assume the Mini PC is on a home or office network. The control plane is still locked down as if it were on the internet — because `www` and `api` are.

## What the browser is allowed to see

JWT in `localStorage`, public GitHub client id, their own projects. Not Portainer API keys, not NPM password, not `GITHUB_CLIENT_SECRET`, not webhook secret, not Docker Hub token.

Admin Hosting shows “configured” hints, not the raw secret, unless I type a new one to rotate it.

## Auth

- BCrypt passwords
- JWT session, **2 hours** (`JWT_EXPIRATION_MS`)
- Password-reset JWT, **30 minutes**, `purpose=password_reset` (rejected as a session)
- GitHub OAuth state JWT, **10 minutes**
- Email send: **60 s** cooldown; **5 / hour** per inbox, per IP, and for the whole API (verification + reset). Slot taken before Resend. **5** wrong codes → **15 min** lock. See [email.md](email.md).
- Missing, invalid or expired JWT, or a suspended/deleted user → **401** JSON (`{timestamp,status,error,message}`). The SPA logs out on 401 only, so this must never be 403.
- `/api/admin/**` needs `ROLE_ADMIN`; a signed-in non-admin gets **403** JSON
- `/api/webhooks/**` is permit-all at Spring Security **but** the handler rejects bad HMAC
- `/ws` needs a session JWT; topics are limited to services that user can access
- `/api/public/**` cached + rate-limited
- CORS and the `/ws` handshake accept only `CLOUDBASE_CORS_ALLOWED_ORIGINS` (exact origins; wildcards refused at startup). Live: `https://www.cloudbase.website,https://cloudbase.website`
- One password rule (8+ with upper, lower, digit, special) on register, reset and change. Emails are matched case-insensitively; new ones are stored lowercase
- Password-reset links are single use: the token is bound to the password hash it was issued for

## Runtime isolation

- Compose CPU and memory limits per service
- Start command is argv (no `sh -c`)
- Volume paths cannot target `/etc`, `/proc`, and similar
- Tenant containers are not given the Docker socket
- Postgres for CloudBase is not published on the host in production

## Secrets in git

Never commit `.env`, `application-local.properties`, or `frontend/src/environments/environment.ts`. Compose refuses to start without `DB_PASS`, `JWT_SECRET`, `GITHUB_WEBHOOK_SECRET`. Prod profile also refuses a weak JWT.

## Delete

Type the exact name. Tear down Portainer first. If that fails, keep the DB row. See [database.md](database.md#delete-order).
