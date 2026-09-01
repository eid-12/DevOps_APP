# GitHub

GitHub is how most tenant apps get an image. CloudBase does not clone repos onto the Mini PC to compile them.

## OAuth

User hits Account → connect. Browser goes to GitHub, comes back to `/auth/github/callback`. SPA sends the `code` to Spring Boot. Backend exchanges it for a user token (client secret stays on the server).

Live callback: `https://www.cloudbase.website/auth/github/callback`  
Local callback: `http://localhost:4200/auth/github/callback`

Scopes I ask for: `read:user repo user:email workflow`. Repo + workflow are required so I can write files and secrets on *their* repo.

The GitHub App / OAuth App client id is public (`GET /api/public/app-config`). The secret is Admin → Hosting or env `GITHUB_CLIENT_SECRET`.

## Bootstrap (first GitHub service)

When they add a GitHub service and deploy is allowed, `CiBootstrapService` talks to the GitHub API with **their** token:

1. Dockerfile — write one if the repo has none (runtime from the picker: node, java, …).
2. `.github/workflows/cloudbase-deploy.yml` — build on push, login to Docker Hub, push `minipcer/<name>:tag`.
3. Actions secrets — Docker Hub user/token, webhook-related values, encrypted with GitHub’s public key (`github_secret_encrypt.py` + Java).
4. Webhook — `https://api.cloudbase.website/api/webhooks/github`, secret `GITHUB_WEBHOOK_SECRET`.

I do not run `docker build` on the Mini PC for their app. GitHub Actions does.

## Webhook

GitHub POSTs when the image is on Hub. I verify HMAC. Unsigned or wrong secret = reject. Then I generate compose, update the Portainer stack with pull, refresh NPM.

If the webhook URL is wrong (still pointing at localhost, or at `www` instead of `api`), deploys sit in Building forever. Live URL must be `CLOUDBASE_PUBLIC_API_URL` + `/api/webhooks/github`.

## What a later `git push` does

Their laptop → GitHub → Actions build → Hub → webhook → Portainer pull → same HTTPS name. I do not click Deploy unless they want a manual rerun from the service page.
