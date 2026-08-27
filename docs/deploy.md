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
2. Backend writes (if needed) a Dockerfile and `.github/workflows/cloudbase-deploy.yml`, sets Actions secrets, and registers a webhook.
3. GitHub Actions builds and pushes to Docker Hub under the platform namespace (`minipcer` in production).
4. GitHub POSTs the webhook to `api.cloudbase.website`. I check `GITHUB_WEBHOOK_SECRET`.
5. Backend writes a compose file in memory: app service, resource limits, network `cloudbase`, env vars, optional volume, optional Watchtower sidecar for that stack.
6. Portainer creates or updates the stack (`pullImage` on updates).
7. Backend creates or updates the NPM proxy host so `https://<host>` hits the container.
8. UI deploy stages: Queued → Building → Deploying → Verify → Success or Failed.

Later `git push` on that repo repeats 3–8. The Mini PC does not compile their Node/Java app; GitHub does.

## Docker image path

No GitHub workflow. I take the image reference they typed, generate compose, Portainer pull, NPM host. Same quotas and network.

## Database path

Separate container, credentials generated, connection string shown in the UI. Type and port stay locked after create.

## After it is live

Logs in the service page mix the deploy trail with Portainer container logs. Metrics come from Portainer stats through the API (and a socket for live updates). Rollback is “run this previous image again”, not git revert on their laptop.

If email is on and they opted in, I can mail deploy success/failure. If Resend is off, the UI still shows the result.
