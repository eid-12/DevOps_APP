# GitHub

GitHub is how most tenant apps get an image. CloudBase does not clone repos onto the Mini PC to compile them.

> **No CloudBase credential ever goes into a tenant repository.** Until 2026-10-29 provisioning wrote the
> platform's Docker Hub token into each connected repository's Actions secrets (found in at least one repository,
> dated 2026-08-19). Builds now publish to the repository's own GitHub Container Registry with the job's scoped
> `GITHUB_TOKEN`, and CloudBase has no code that writes repository secrets at all.

## OAuth

User hits Account → connect. Browser goes to GitHub, comes back to `/auth/github/callback`. SPA sends the `code` to Spring Boot. Backend exchanges it for a user token (client secret stays on the server).

Live callback: `https://www.cloudbase.website/auth/github/callback`  
Local callback: `http://localhost:4200/auth/github/callback`

Scopes requested: `read:user repo user:email workflow read:packages`. `repo` + `workflow` let CloudBase commit the Dockerfile and workflow to *their* repository; `read:packages` lets CloudBase pull *their* private image for *their* service. Accounts connected before `read:packages` was added must reconnect GitHub once.

The GitHub App / OAuth App client id is public (`GET /api/public/app-config`). The secret is Admin → Hosting or env `GITHUB_CLIENT_SECRET`.

## Bootstrap (first GitHub service)

When they add a GitHub service and deploy is allowed, `CiBootstrapService` talks to the GitHub API with **their** token:

1. Dockerfile — write one if the repo has none (runtime from the picker: node, java, …).
2. `.github/workflows/cloudbase-deploy.yml` — on push, build and publish `ghcr.io/<owner>/<repo>:<short sha>` (and `:latest`) with the job's own `GITHUB_TOKEN` (`packages: write`, scoped to that repository). Actions are pinned to commit SHAs. The image name is derived from the repository URL, never from user input.
3. Webhook — `https://api.cloudbase.website/api/webhooks/github` for `workflow_run`, signed with `GITHUB_WEBHOOK_SECRET` (GitHub never shows the secret back to repository admins).

No repository secrets are written. Newly published GHCR packages default to private, but existing packages can have independent visibility and permissions; verify their access settings during migration. CloudBase never makes repositories or packages public.

I do not run `docker build` on the Mini PC for their app. GitHub Actions does.

## Webhook

GitHub POSTs when the workflow run finishes. I verify the HMAC; unsigned or wrong secret = reject. Then:

1. **Pull with the owner's access.** The backend pulls `ghcr.io/<owner>/<repo>:<sha>` onto the Mini PC through Portainer's Docker API with the service owner's own GitHub token in a one-off `X-Registry-Auth` header. It is never stored in Portainer. If the owner lacks `read:packages`, or cannot read the package, the deploy stops with a clear message — this is the access check, so no one can run an image they could not pull themselves.
2. **Fail closed on shared credentials.** If Portainer ever has a `ghcr.io` registry configured, the deploy is refused: such a credential would be used for every tenant's pulls. Do not add one.
3. **Deploy without anonymous re-pulls.** The stack uses `pull_policy: missing` and Portainer's re-pull is off for these images; Watchtower is disabled for them (updates come from the webhook). NPM is refreshed as usual.

If the webhook URL is wrong (still pointing at localhost, or at `www` instead of `api`), deploys sit in Building forever. Live URL must be `CLOUDBASE_PUBLIC_API_URL` + `/api/webhooks/github`.

## What a later `git push` does

Their laptop → GitHub → Actions build → GHCR → webhook → Portainer pull → same HTTPS name. I do not click Deploy unless they want a manual rerun from the service page.

An empty or truncated HTTP 200 pull response is not success: the backend requires Docker's completed-pull status before allowing deployment. Private GHCR pulls with the stored OAuth token still require a live integration check; consent alone does not prove registry compatibility. See [the migration procedure](../credential-migration.md).
