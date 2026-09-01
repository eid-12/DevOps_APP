# Accounts and roles

Everyone who uses CloudBase is a row in Postgres. There are no shared demo logins.

## Signup

1. Register at `/auth` with name, email, password.
2. If Resend is on, they get a 6-digit code (**15 minutes**). No session JWT until they verify. Clock, cooldowns, and templates: [email.md](email.md).
3. If Resend is off, I mark the email verified immediately so they can sign in. They still cannot deploy until I say so.
4. Account status starts as something I can activate or suspend from Admin.

Password rules: 8+ characters, upper, lower, digit, special (`@$!%*?&#._-`). JWT session is **two hours**. Password-reset link is **30 minutes**. After the session expires they sign in again.

## Two roles

**USER** owns projects. They see only their own. They can connect GitHub, add services, deploy (if I enabled it), read logs, set env vars, claim a vanity host or a custom domain.

**ADMIN** is me. Same as a user, plus:

- User Governance (activate, suspend, change role, enable Deploy, verify email, reset password)
- Hosting settings (Portainer, NPM, GitHub, Docker Hub tokens) without rebuilding the API
- Infrastructure (live Portainer snapshot through the API)
- Audit trail

Admins skip the deploy gate.

## Deploy gate

`deploymentEnabled` is the switch. A new USER is off. I turn it on from Admin → User Governance. Until then the UI can show projects, but deploy / add-service paths that need runtime stay blocked.

This is not “approve this GitHub repo”. It is “this person may use the Mini PC”.

## First admin

Flyway used to seed an admin. That is gone (`V18`). First boot I either:

- set `CLOUDBASE_BOOTSTRAP_ADMIN_EMAIL` / `CLOUDBASE_BOOTSTRAP_ADMIN_PASSWORD` (ignored once an ADMIN exists), or
- register normally and promote in SQL:

```sql
UPDATE users
SET role = 'ADMIN',
    account_status = 'ACTIVE',
    email_verified = TRUE,
    deployment_enabled = TRUE
WHERE email = 'you@your-domain';
```

## GitHub on the account

Account → connect GitHub (OAuth). CloudBase stores the connection on the user, not a platform-wide GitHub user. Scopes include repo + workflow so I can inject the Dockerfile and Actions file. Details: [github.md](github.md).
