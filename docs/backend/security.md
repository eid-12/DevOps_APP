# Security

I assume the Mini PC is on a home or office network. The control plane is still locked down as if it were on the internet — because `www` and `api` are.

## What the browser is allowed to see

JWT in `localStorage`, public GitHub client id, their own projects. Not Portainer API keys, not NPM password, not `GITHUB_CLIENT_SECRET`, not webhook secret, not Docker Hub token.

Admin Hosting shows “configured” hints, not the raw secret, unless I type a new one to rotate it.

## Auth

- BCrypt passwords
- JWT session, **2 hours** (`JWT_EXPIRATION_MS`)
- Password-reset JWT, **30 minutes**, `purpose=password_reset` (rejected as a session)
- GitHub OAuth: the SPA checks `state` against the browser that started the flow, then posts the code to `/api/auth/github/exchange` with the user's session. There is no unauthenticated callback on the API
- Vanity subdomains: platform/infra names and anything containing the platform name (e.g. `cloudbase-login`) are reserved, because tenant apps share `cloudbase.website`
- Request bodies are size-limited (names 100–120 chars, env values 32 KB, ≤ 200 env/shared variables, terminal command 4 KB)
- An admin cannot change their own role or account status
- Terminal: **30 commands / minute** per user (each one costs several Docker calls on the shared host)
- Login does one BCrypt check even for an unknown email, so response time does not reveal which accounts exist
- 400 responses never echo JDK/library messages that name internal classes
- Request bodies are capped before anything reads them: 8 MB for the API, 5 MB for `/api/webhooks/**` (a declared larger body gets 413; a chunked one stops being read at the limit)
- Rate limiters forget expired entries once a map passes 10,000 keys, so random emails or IPs cannot grow memory without bound. Unknown-address lookups (forgot password, resend) are capped at 30/hour per IP, wrong verification codes at 30 per 15 min per IP across all addresses
- Sign-up does not reveal whether an address is registered (when email is on): a taken address gets the same answer and response shape as a new one, and the real owner receives an "account already exists" email. With email off it still answers 409, since nobody could otherwise be told
- Images that run with elevated trust are pinned by digest, not tag: Watchtower (holds the Docker socket), the edge router and isolation canary/probes (nginx), and the volume-wipe helper (alpine, mounts tenant data). Update a digest deliberately; never go back to a tag
- GitHub access tokens are encrypted at rest (AES-256-GCM, key derived from `JWT_SECRET` with a purpose label); plaintext rows are encrypted on startup. Rotating `JWT_SECRET` makes them read as disconnected, and users reconnect GitHub
- Public status endpoint returns only container counts: no versions, hardware or component names
- Spring Boot 3.5.x (supported line); builds on Windows behind TLS inspection need `MAVEN_OPTS=-Djavax.net.ssl.trustStoreType=Windows-ROOT`

- Libraries are checked against OSV (`api.osv.dev`). The Spring Boot BOM is overridden in `pom.xml` where it lags on security fixes (Tomcat, Jackson, Netty, PostgreSQL driver, Log4j API). Two Spring advisories remain on 6.2.x and do not apply: SSE fragment rendering, WebFlux server routes and `XsltView` are not used (fixed only in Spring 7 / Boot 4)
- nginx 1.30.6 (current stable) for the website and the edge, pinned by digest. The edge reconcile replaces an edge built from an older pinned image and rewrites routes in the same pass
- Cloudflare Access service token (Admin → Hosting, or `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET`) is sent on every Portainer and NPM call, so both admin hosts can sit behind Access

## Known limits (not code-fixable)

- **The admin hosts are public.** `manage.cloudbase.website` (Portainer) and `npm.cloudbase.website` (Nginx Proxy Manager) answer anyone on the internet, over HTTP too, and Portainer's `/api/status` discloses its version. Close them with Cloudflare Access, in this order so nothing breaks:
  1. Zero Trust → Access → Service Auth: create a service token
  2. Put its id/secret in Admin → Hosting (API) and in GitHub secrets `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` (deploys)
  3. Access → Applications: one app for `manage.cloudbase.website` and `npm.cloudbase.website`, policies "your email" (Allow) and the service token (Service Auth)
  4. SSL/TLS → Edge Certificates: Always Use HTTPS on; redirect the bare `cloudbase.website` to `www`

- Tenant apps are served on `*.cloudbase.website`, the same site as the dashboard. Look-alike names are reserved, but the complete fix is a separate registrable domain for apps (on the Public Suffix List)
- Hosting secrets (Portainer API key, NPM password, Resend key) are stored unencrypted in Postgres; protect database backups accordingly. Encrypting them needs a dedicated key in the production environment, because losing them on a secret rotation would stop the platform
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

Native Maven packaging excludes `application-local.*` from JARs, while local development can still load it from the classes directory. Docker also excludes the real local properties file from its build context. CI checks the packaged JAR for local configuration entries.

## Delete

Type the exact name. Tear down Portainer first. If that fails, keep the DB row. See [database.md](database.md#delete-order).
