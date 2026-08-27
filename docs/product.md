# Product walkthrough

This is what the UI actually does. Paths are Angular routes.

## Public

**`/` Landing.** Marketing page plus live Mini PC stats (`GET /api/public/platform-status`): containers, stacks, CPU/RAM, Docker version. Stats are cached and rate-limited. GitHub client id for the SPA comes from `GET /api/public/app-config`.

**`/auth`.** Sign in, sign up, forgot/reset, email code. Query `?mode=login|register|forgot|reset|verify`. Codes last 15 minutes; reset links 30 minutes. Protocol: [email.md](email.md).

**`/auth/github/callback`.** GitHub sends `?code=&state=` here. The SPA posts the code to the API; I never put the client secret in the browser.

## Signed-in user

**`/dashboard`.** Project cards. Create a blank project, or jump into add-service. Archive lives on the card menu. Search / sort are local.

**`/projects/:id`.** Canvas of services in that project. Add GitHub / Docker image / database. Project settings (name, env, shared variables, delete). Delete is type-the-exact-name.

**`/projects/:id/services/:id`.** The working screen:

- Deploy now, stop, rollback to a previous image
- Stages: Queued → Building → Deploying → Verify → Success / Failed
- Logs (deploy trail + Portainer container output)
- Metrics (CPU / RAM / net from Portainer, via the API)
- Network: random platform host, one vanity per account, custom domain
- Env vars (service + inherited project shared vars)
- Source (image, GitHub repo, DB type — some fields lock after create)
- Danger zone (delete service)

**`/account`.** Profile, change password, GitHub connect/disconnect, usage meters, API tokens for later CLI (CLI itself is not this release).

**`/billing`.** Free plan copy + the same usage numbers. Hard caps are RAM / CPU / storage, not “max 2 projects”. See [quotas.md](quotas.md).

**`/help`.** Short how-to. Not a second README.

## Admin

**`/admin`.** Tabs:

| Tab | Job |
|-----|-----|
| Infrastructure | Portainer snapshot (`GET /api/admin/infrastructure`) |
| User Governance | Search, filters, activate / suspend / Deploy / role |
| Audit Trail | Who did what |
| Hosting | URLs and secrets for Portainer, NPM, GitHub, Docker Hub |
| Account | Same profile form as `/account` |

The browser does not call Portainer or NPM. If Infrastructure looks empty, hard-refresh; an old SPA used to hit Portainer from the client.

## Notifications

Bell in the navbar. In-app rows for deploys and service events. Email is optional (prefs on the account + Resend on). See [email.md](email.md).
