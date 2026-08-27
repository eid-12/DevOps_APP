# Email (Resend)

Email is optional. Domain I use: `mawrid.cloudbase.website`. From-address looks like `CloudBase <noreply@mawrid.cloudbase.website>`.

## When it is on

- Signup verification code
- Password reset link
- Deploy success / fail if the user enabled those prefs
- Admin notify address if I set `RESEND_ADMIN_NOTIFY`

## When it is off

Signup still works (auto-verify). Forgot-password tells the truth: ask an admin. I can mark a user verified from Admin → User Governance.

`GET /api/public/app-config` includes `emailEnabled` so the SPA does not pretend a code is on the way.

Keys live in env / Hosting, never in git. `RESEND_ENABLED=false` is the safe default on a new compose file.
