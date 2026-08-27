# Email

Outbound mail is **HTTPS to Resend**, not SMTP from the Mini PC. Domain: `mawrid.cloudbase.website`. From: `CloudBase <noreply@mawrid.cloudbase.website>`.

Ready means `RESEND_ENABLED=true` **and** a non-empty `RESEND_API_KEY`. Either missing → email is off.

`GET /api/public/app-config` exposes `emailEnabled` so the SPA does not pretend a code is on the way.

Keys live in compose env, never in git. Resend is **not** in `platform_settings` (unlike Portainer / NPM). See [database.md](database.md).

## Protocol

| Piece | What actually happens |
|-------|------------------------|
| Transport | Resend HTTPS API (`emails.send`). No local postfix / SMTP port. |
| From | `RESEND_FROM` (default `CloudBase <noreply@mawrid.cloudbase.website>`) |
| Sending domain | `RESEND_DOMAIN` = `mawrid.cloudbase.website` |
| Body | HTML only (CloudBase branded template). No MIME text/plain part. |
| Links in mail | Built from `APP_BASE_URL` (`https://www.cloudbase.website` on prod, `http://localhost:4200` locally) |
| DNS | One-time `POST /api/admin/email/domain` registers the domain in Resend and returns records to put in Cloudflare (SPF / DKIM / etc.). `mawrid` is a reserved vanity slug so a tenant cannot steal the mail host. |
| Admin QA | `POST /api/admin/email/preview?to=` fires every template to an inbox. `GET /api/admin/email/status` is `{ enabled: true/false }`. |

If send fails, Resend’s error bubbles as `Failed to send email: …`. Deploy outcome mail is best-effort: a Resend failure is logged and does not fail the deploy.

## Clock (TTL and limits)

| What | Duration / cap |
|------|----------------|
| Signup verification code | **15 minutes**. 6 digits (`000000`–`999999`), `SecureRandom`. Stored on `users.email_verification_code` / `email_verification_expires_at`. |
| Password-reset link | JWT `purpose=password_reset`, **30 minutes**. Query `https://www.cloudbase.website/auth?mode=reset&token=…`. Cannot be used as a session token. |
| Session JWT | **2 hours** (`JWT_EXPIRATION_MS=7200000`). Not email; same clock the SPA shows. |
| GitHub OAuth state | **10 minutes**. Not email. |
| Send cooldown | **60 seconds** per address per action (verification vs password-reset are separate buckets). |
| Send hourly cap | **5** successful sends per address per action per rolling **1 hour**. |
| Wrong verification codes | **5** failures → current code **cleared**, lock **15 minutes**, then they must request a new code. |
| Rate-limit store | In memory on the API JVM. Restart wipes cooldowns. Fine for one backend replica. |

HTTP `429` text is exact, e.g. `Please wait N seconds before requesting another email.`

Forgot-password always rate-limits the **typed** address, even if no user exists, then returns the same generic line either way.

Admin `POST /api/admin/users/{id}/password-reset` skips the user-facing cooldown (I am the sender).

Register does not wait on cooldown for the **first** code (new email). Resend-code does.

## When it is on

| Trigger | Mail | Who |
|---------|------|-----|
| Register | 6-digit code, subject `CloudBase - your verification code` | New user. No JWT until they verify. |
| Resend code | New 15-minute code, clears the wrong-code lock | Unverified user |
| Verify success | `CloudBase - email verified` (you can sign in; deploy still locked) | User |
| Verify success | `CloudBase - new user awaiting approval` | `RESEND_ADMIN_NOTIFY` if set |
| Admin enables Deploy | `CloudBase - you're ready to deploy` | User |
| Admin marks account active | `CloudBase - account activated` | User |
| Forgot password / admin reset | `CloudBase - reset your password` (30 min link) | User |
| Deploy finished | `CloudBase - deploy succeeded/failed: {service}` | Owner, if prefs allow |

Account → notification prefs:

- `notifyEmailDeployments` default **on** → success mail
- `notifyEmailFailures` default **on** → fail mail
- `notifyEmailWeeklyUsage` default **off** — column exists; **no weekly sender is wired yet**

Admin verify-email from User Governance does **not** send the welcome/admin-notify pair. It only flips flags.

## When it is off

Signup still works: email marked verified, account `ACTIVE`, they get a session JWT immediately. Deploy stays off until I enable it.

Forgot-password and resend-code return **503** with an honest message (ask an admin). Login of an unverified user (only possible if they registered while mail was on) is **403** until they verify or I mark them verified.

## Signup path (mail on)

1. `POST /api/auth/register` → row `PENDING_ACTIVATION`, code + 15 min expiry, mail sent, **no** session token.
2. `POST /api/auth/verify-email` with email + code.
3. On success: `email_verified`, status `ACTIVE`, `deployment_enabled=false`, code cleared, welcome + admin notify.
4. They sign in. I enable Deploy from Admin when I trust them.

Details of roles and the gate: [accounts.md](accounts.md).

## Env

| Variable | Job |
|----------|-----|
| `RESEND_ENABLED` | Master switch. Compose default `false`. |
| `RESEND_API_KEY` | Resend secret. |
| `RESEND_FROM` | RFC From header. |
| `RESEND_DOMAIN` | Domain create / DNS helper. |
| `RESEND_ADMIN_NOTIFY` | Inbox for “new user waiting”. Empty = skip that mail. |
| `APP_BASE_URL` | Origin for every CTA link. Prod: `https://www.cloudbase.website`. |
| `RESEND_ENSURE_DOMAIN` | Exists on the properties object; domain create is still the admin POST. |

Live currently has email on (`emailEnabled: true` on app-config) with the mawrid domain already in DNS.
