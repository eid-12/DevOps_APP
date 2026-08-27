# Runtime

The Mini PC is the runtime. Docker is the only place tenant code runs.

## What is already on the host

I run these as their own stacks (not this git repo):

| Piece | Public name | Job |
|-------|-------------|-----|
| Portainer | `manage.cloudbase.website` | Docker UI + API CloudBase calls |
| Nginx Proxy Manager | `npm.cloudbase.website` | Reverse proxy + TLS |
| CloudBase stack | `www` + `api` | Control plane containers |

Docker network name: `cloudbase`. NPM is already on that network. Production compose joins it so `www` can reach `cloudbase-frontend` and `api` can reach `cloudbase-backend` by container name.

Portainer endpoint I use in production is id **3**, named `local` (that is Portainer’s name for the local Docker engine, not “this app is broken”).

## CloudBase production stack

File: `docker-compose.prod.yml`. Portainer stack on the Mini PC.

| Container | Image |
|-----------|--------|
| `cloudbase-postgres` | `postgres:16-alpine` |
| `cloudbase-backend` | `minipcer/cloudbase-backend:latest` |
| `cloudbase-frontend` | `minipcer/cloudbase-frontend:latest` |

Backend is not published on a host port. Only NPM can reach `:8080` on the Docker network.

## Hostnames I reserved

Tenants cannot claim these as vanity URLs.

| Hostname | What |
|----------|------|
| `www.cloudbase.website` | UI |
| `api.cloudbase.website` | API + GitHub webhooks |
| `manage.cloudbase.website` | Portainer |
| `npm.cloudbase.website` | NPM |
| `mawrid.cloudbase.website` | Transactional mail domain |

GitHub OAuth callback: `https://www.cloudbase.website/auth/github/callback`  
Webhook: `https://api.cloudbase.website/api/webhooks/github`

A tenant app gets either a random host (`cloudbase8472.cloudbase.website`), one vanity per account (`myapp.cloudbase.website`), or a custom domain they CNAME to the platform.

## Quotas and isolation

When I generate compose for a service I set CPU and memory limits. Start commands are argv only (no shell). Volume mounts cannot point at `/etc`, `/proc`, and similar host paths. Each project’s data stays under the CloudBase volume root, not in this git tree.
