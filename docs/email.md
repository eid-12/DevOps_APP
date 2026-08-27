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

Numbers below are the constants in the backend, not guesses.

| What | Duration / cap | Code |
|------|----------------|------|
| Signup verification code | **15 minutes**. 6 digits `000000`–`999999` (`SecureRandom`, `%06d`). Compared with `code.trim()`. Columns `email_verification_code` / `email_verification_expires_at`. | `AuthServiceImpl.CODE_TTL_MINUTES = 15` |
| Password-reset link | JWT `purpose=password_reset`, **30 minutes**. URL `{APP_BASE_URL}/auth?mode=reset&token=…`. Filter rejects any token that has a `purpose` as a session. | `JwtService.generatePasswordResetToken` `30 * 60 * 1000L` |
| Session JWT | **2 hours** | `jwt.expiration-ms` default `7200000` in `application.properties` |
| GitHub OAuth state | **10 minutes** | `JwtService.generateOAuthState` `10 * 60 * 1000L` |
| Send cooldown | **60 seconds** per address per action (`VERIFICATION` vs `PASSWORD_RESET` are separate keys). SPA also hard-codes 60s on the button. | `EmailRateLimiter.COOLDOWN` |
| Send hourly cap | **5** `recordSend` calls per address per action in a **fixed** 1-hour window from the first count (not a sliding window). Forgot-password counts the attempt even if no user / no mail went out. | `WINDOW` + `MAX_PER_WINDOW = 5` |
| Wrong verification codes | **5** misses → code columns **nulled**, lock **15 minutes**, `429`. Resend-code generates a new code and `clearVerifyFailures`. | `MAX_VERIFY_FAILURES`, `VERIFY_LOCK` |
| Rate-limit store | `ConcurrentHashMap` on the API JVM. Restart wipes it. | `EmailRateLimiter` |

The HTML line “Expires in 15 minutes” is a **copied string** in `ResendEmailService`, not `CODE_TTL_MINUTES` interpolated. Keep them in sync if the TTL changes.

`resetPassword` on the API only requires **6** characters. Account change-password and the Angular register/reset forms use the strong 8+ rule. The link still dies at 30 minutes either way.

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

## Where this is in the repo

| File | Job |
|------|-----|
| `backend/.../email/ResendEmailService.java` | HTTPS send, subjects, HTML, 15-minute copy in the code mail |
| `backend/.../email/ResendProperties.java` | From / domain / admin-notify / app-base-url |
| `backend/.../email/EmailRateLimiter.java` | 60s, 5/hour, 5 wrong codes, 15 min lock |
| `backend/.../service/impl/AuthServiceImpl.java` | Register / verify / resend / forgot; `CODE_TTL_MINUTES = 15` |
| `backend/.../security/JwtService.java` | Session 2h (via properties), reset 30m, OAuth state 10m |
| `backend/.../security/JwtAuthFilter.java` | Reset/OAuth JWTs cannot become a session |
| `frontend/.../auth-page.component.ts` | 6-digit `^\d{6}$`, cooldown 60s, `emailEnabled` copy |
