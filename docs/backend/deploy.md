# Deploy (tenant apps)

This is how a **user app** goes live. It is not how I update CloudBase itself.

A user needs `deploymentEnabled`. I turn that on from Admin → users.

## Three sources

| Source | What happens |
|--------|----------------|
| GitHub repo | I bootstrap CI on their repo, GitHub builds the image, webhook tells me to roll the stack |
| Docker image | I point the stack at an existing image (Docker Hub) |
| Database | I run a managed DB container (Postgres / MySQL / …) with generated credentials |

## GitHub path (the long one)

1. User connects GitHub on Account, then adds a service from a repo.
2. Backend writes (if needed) a Dockerfile and `.github/workflows/cloudbase-deploy.yml`, and registers a webhook. It writes no secrets.
3. GitHub Actions builds and publishes to the repository's own GitHub Container Registry (`ghcr.io/<owner>/<repo>`) with its scoped `GITHUB_TOKEN`.
4. GitHub POSTs the webhook to `api.cloudbase.website`. I check `GITHUB_WEBHOOK_SECRET`.
5. Backend writes a compose file in memory: app service, resource limits, network `cloudbase`, env vars, optional volume, optional Watchtower sidecar for that stack.
6. The backend pulls the private image with the owner's GitHub token, then Portainer creates or updates the stack without an anonymous re-pull. Details: [github.md](github.md#webhook).
7. Backend creates or updates the NPM proxy host so `https://<host>` hits the container.
8. UI deploy stages: Queued → Building → Deploying → Verify → Success or Failed.

Later `git push` on that repo repeats 3–8. The Mini PC does not compile their Node/Java app; GitHub does.

## Docker image path

No GitHub workflow. I take the image reference they typed, generate compose, Portainer pull, NPM host. Same quotas and network.

## Database path

Separate container, credentials generated, connection string shown in the UI. Type and port stay locked after create.

## After it is live

Logs in the service page mix the deploy trail with Portainer container logs. Metrics come from Portainer stats through the API; the UI polls them. Rollback is “run this previous image again”, not git revert on their laptop.

If email is on and they opted in, I can mail deploy success/failure. If Resend is off, the UI still shows the result.

## Networking and domains

Public HTTPS is Nginx Proxy Manager; NPM finds containers by name on the Docker network `cloudbase`. Platform hostnames are reserved ([../architecture.md](../architecture.md#reserved-hostnames)).

A tenant service can be reached at:

1. **A random platform host** such as `cloudbase8472.cloudbase.website`, always present after a successful deploy.
2. **A vanity name**: one slug per account (`myapp.cloudbase.website`). The service's Network tab checks availability; it can be moved between the user's own services but never taken from someone else.
3. **A custom domain**: the user CNAMEs (or ALIASes) `app.example.com` to `cloudbase.website`; after the check, NPM gets a proxy host for that name with the certificate `NPM_CERTIFICATE_ID`.

After Portainer has the container, the API creates the NPM proxy host: hostname → container name on `cloudbase`, plain HTTP to the container's internal port (80, 3000, 8080, …). No host ports are opened on the Mini PC, so many services can each listen on 80 inside their own container.

Locally, `ng serve` on `:4200` proxies `/api` and `/ws` to `:8080`; there is no NPM, and the GitHub OAuth callback must be the localhost one.
