# Data model

CloudBase stores its own state in Postgres. Tenant app data lives in Docker volumes on the Mini PC.

Tables and Flyway: [database.md](database.md).

## Project

A folder for one person’s work. Has a name, optional description, status `ACTIVE` or `ARCHIVED`. The UI can show a production / staging / development badge; that tag is **not** stored in Postgres (live API treats projects as production).

A project does not run. Services run.

Shared variables live on the project. I can attach them to one or more services so the same `DATABASE_URL` is not pasted five times.

## Service

One container (or a small compose: app + optional Watchtower). Types:

| `sourceType` | Meaning |
|--------------|---------|
| `GITHUB` | Repo URL + branch + runtime. CI bootstrap. Image comes from Actions. |
| `DOCKER` | Image on Docker Hub (preset or typed). |
| `DATABASE` | Managed Postgres / MySQL / Redis / Mongo. Credentials generated. Type and port lock after create. |

Status moves through `PENDING`, `BUILDING`, `DEPLOYING`, `RUNNING`, `STOPPED`, `FAILED`, `CRASHED`.

Each service has a quota slice (CPU milli, memory MB, storage GB) taken from the user’s pool. Optional volume: mount path inside the container only, data under `CLOUDBASE_VOLUME_ROOT`.

## Deployment

A row per roll: image tag, stage, timestamps, error text, log snippet. The service page lists them. Rollback means “Portainer, run this older image again”.

## User

Email, BCrypt hash, role, account status, `deploymentEnabled`, email verified, optional GitHub connection, notification prefs.

## What is not in Postgres

Container filesystems. NPM certificate private keys. Docker images on Hub. Portainer’s own database. Those stay on the Mini PC / Hub.

## Delete

UI asks for the exact project or service name. Order: Portainer stack (and Watchtower) first, then NPM host, then the database row. If Portainer fails, the row stays. I would rather have an orphan record than a live container with no UI.
