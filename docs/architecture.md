# Architecture

CloudBase is a control plane that drives APIs I already run on the Mini PC. The UI never talks to Portainer or Nginx Proxy Manager from the browser. Spring Boot does that.

```text
  browser
     |
     |  HTTPS
     v
  www.cloudbase.website          Angular (container :3000)
     |
     |  /api  (same origin on prod via NPM, or proxy in local ng serve)
     v
  api.cloudbase.website          Spring Boot (:8080, Docker network only)
     |
     +-- Postgres                users, projects, services, deploys  ([backend/database.md](backend/database.md))
     |
     +-- Portainer API           stacks, containers, logs, stats
     |        |
     |        v
     |     Docker (WSL2)
     |        |
     |        +-- cloudbase-frontend / cloudbase-backend / postgres
     |        +-- tenant app stacks (one per service)
     |
     +-- NPM API                 proxy hosts + TLS
     |
     +-- GitHub                  OAuth, repo files, Actions, webhooks
     +-- Docker Hub              images I publish, and tenant images
```

## Layers I actually run

**Host.** Windows on the Mini PC. Docker uses WSL2. Tenant containers stay in Docker; they do not write into the Windows desktop.

**Control plane.** This repo. See [control-plane.md](control-plane.md). API technologies (Tomcat vs Netty, WebSocket): [backend/stack.md](backend/stack.md).

**Container manager.** Portainer. Spring Boot sends compose text to `/api/stacks` with an API key. Portainer creates, updates, stops, and removes stacks. Logs and CPU/RAM samples also come from Portainer.

**Public routing.** Nginx Proxy Manager. After a tenant container is up, the API creates (or updates) a proxy host: hostname → container on the `cloudbase` Docker network. TLS is a certificate already on NPM (`NPM_CERTIFICATE_ID`).

**GitHub.** Users connect an account. For a GitHub service I inject a Dockerfile (if missing), a workflow, repo secrets, and a webhook. Builds run on GitHub Actions, not on the Mini PC. When the image is on Docker Hub, GitHub hits `https://api.cloudbase.website/api/webhooks/github`. Unsigned webhooks are rejected.

**Email (optional).** Resend. If it is off, signup still works: the account is marked verified and I enable Deploy later from Admin.

## What I dropped from the early notes

The first architecture dump talked about Cloudflare Tunnel as the only public entry, admin “approve this repo” before any build, and a full xterm shell into every container.

What shipped instead:

- Public names go through NPM (`www`, `api`, `manage`, `npm`, plus tenant hosts).
- Deploy is gated per user (`deploymentEnabled`), not a per-repo approval ticket.
- Service console is logs + a constrained command path through Portainer exec, not an open shell on the host.

## Data that must stay on the Mini PC

Postgres for CloudBase itself. Tenant volume data under `CLOUDBASE_VOLUME_ROOT` (prod: `/var/lib/cloudbase/users`). If Portainer cannot tear a stack down, I do not delete the database row. Delete in the UI is type-the-name.
