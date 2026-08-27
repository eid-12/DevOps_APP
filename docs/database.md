# Database

The control plane’s own Postgres. Not the databases users deploy as services.

PostgreSQL 16. Database name `cloudbase`. Flyway owns the schema (`spring.jpa.hibernate.ddl-auto=validate`). Scripts live in `backend/src/main/resources/db/migration/` (V1–V18).

Local compose publishes `5432`. Production compose does **not** publish Postgres. The API talks to `cloudbase-postgres` on the Docker network.

Product language (project / service / delete): [data.md](data.md).

## Two kinds of “database”

| What | Where |
|------|--------|
| CloudBase state | This Postgres. Users, projects, services, deploys, settings. |
| Tenant `DATABASE` service | A separate container (Postgres / MySQL / Redis / Mongo). Credentials live in that service’s `source_details` / env. Data lives on a Docker volume. |

Deleting a CloudBase **service** row does not wipe Docker Hub images. Deleting the platform Postgres would wipe every account and every pointer to Portainer stacks — it would not stop those stacks by itself.

## Shape

```text
users 1──* projects 1──* services 1──* deployments
                          │
                          └──* service_metrics

users 1──* notifications
audit_logs          (append-only, no FK)
platform_settings   (key/value, no FK)
```

IDs are UUID strings (`VARCHAR(36)`) except `service_metrics.id` (`BIGSERIAL`). Cascades: delete user → projects / notifications; delete project → services; delete service → deployments and metrics.

Flyway also keeps `flyway_schema_history`. I do not edit that table.

## Tables

### `users`

Accounts. One row per person.

| Column | Role |
|--------|------|
| `id`, `name`, `email` | Email unique. |
| `password_hash` | BCrypt. |
| `role` | `USER` or `ADMIN`. |
| `account_status` | `PENDING_ACTIVATION` / `ACTIVE` / `SUSPENDED`. |
| `deployment_enabled` | Deploy gate. Admins skip it in code. |
| `email_verified`, `email_verification_code`, `email_verification_expires_at` | Signup code. Cleared after verify. |
| `github_*` | Username, avatar, display name, connected-at, scopes, access token. |
| `onboarding_dismissed` | Hide the first-run tips. |
| `notify_email_deployments`, `notify_email_failures`, `notify_email_weekly_usage` | Mail prefs. |
| `vanity_slug`, `vanity_service_id` | One platform hostname per account. Unique on lower(`vanity_slug`). |
| `created_at`, `updated_at` | |

There are no seed logins. V2 / V5 / V6 used to insert `admin@cloudbase.dev` and `dev@cloudbase.dev`. V18 deletes those rows on every new install after the inserts run.

### `projects`

A folder. Does not run anything.

| Column | Role |
|--------|------|
| `id`, `owner_id`, `owner_name` | Owner is a user. `owner_name` is a copy for lists. |
| `name`, `description` | |
| `status` | `ACTIVE` or `ARCHIVED`. |
| `shared_variables` | jsonb array. Key / value / secret flag / which service ids inherit it. |
| `created_at` | |

The UI has a production / staging / development badge. That is **not** a column. Live API mapping hard-codes `production`. Mock store still stores the tag locally.

### `services`

One workload (app or managed DB). This is the row Portainer and NPM hang off.

| Column | Role |
|--------|------|
| `id`, `project_id`, `name` | |
| `source_type` | `GITHUB` / `DOCKER` / `DATABASE`. |
| `source_details` | jsonb. Repo URL, image, DB type, generated passwords, CI flags. |
| `status` | `PENDING` … `RUNNING` / `STOPPED` / `FAILED` / `CRASHED`. |
| `subdomain` | Platform host. Unique on lower(subdomain) when set. |
| `custom_domain` | User hostname. Unique on lower(custom_domain) when set. |
| `portainer_stack_id`, `container_name`, `container_port` | Runtime pointers. |
| `npm_proxy_host_id` | NPM proxy host. |
| `env_vars` | jsonb. Service-level env. |
| `env_pending_deploy` | Env changed, not rolled out yet. |
| `volume_mount_path`, `volume_size_gb` | Optional data dir. |
| `quota_memory_mb`, `quota_cpu_milli`, `quota_storage_gb` | Slice of the user pool. |
| `latest_deployment_id` | Last roll. |
| `created_at` | |

Indexes: project, subdomain, `source_details->>'repositoryUrl'` (webhook lookup).

### `deployments`

One row per roll (including rollback).

| Column | Role |
|--------|------|
| `id`, `service_id`, `project_id` | |
| `status` | `QUEUED` / `IN_PROGRESS` / `SUCCESS` / `FAILED` / … |
| `triggered_by`, `commit_sha`, `image_tag` | |
| `rollback_of` | Previous deployment id, if this was a rollback. |
| `portainer_stack_id`, `compose_snapshot` | What Portainer actually ran. |
| `logs`, `error_message` | Trail + short UI reason. |
| `stage` | `queued` / `building` / `deploying` / `verify` / `success` / `failed`. |
| `started_at`, `finished_at` | |

### `notifications`

In-app bell. Cascades with the user.

`id`, `user_id`, `title`, `body`, `href`, `is_read`, `created_at`.

### `audit_logs`

Admin trail. No foreign keys. Actor name/email are copied at write time so a later user delete does not blank the log.

`id`, `timestamp`, `actor_name`, `actor_email`, `action`, `target`, `details`.

### `platform_settings`

Key/value overrides for hosting. Compose env is the baseline; Admin Hosting writes here and wins.

Keys include Portainer URL/API key/endpoint, NPM URL/email/password/certificate, GitHub OAuth + webhook secret, Docker Hub user/token/namespace, `cloudbase.base-domain`, public API URL, Docker network, volume root.

Secrets are stored as the value I saved. The API never sends them back in clear text — Hosting shows “configured”.

Resend is **not** in this table. It stays on compose / `resend.*` properties. See [email.md](email.md).

### `service_metrics`

CPU/RAM samples for the service chart. ~30 days in code. `ON DELETE CASCADE` from `services`.

`id`, `service_id`, `recorded_at`, `cpu_percent`, `memory_usage_mb`, `memory_limit_mb`, `memory_percent`.

## Flyway

| Version | What it did |
|---------|-------------|
| V1 | `users`, `projects`, `services`, `deployments` |
| V2 | Seed admin (removed by V18) |
| V3 | Portainer / NPM / rollback columns |
| V4 | GitHub connection on `users` |
| V5 | Seed dev user + `github_display_name` |
| V6 | Rewrote the old seed admin hash |
| V7 | Email verification columns |
| V8 | `audit_logs` |
| V9 | `projects.shared_variables` |
| V10 | `custom_domain` + unique host indexes |
| V11 | Onboarding + notify prefs |
| V12 | `notifications` |
| V13 | `platform_settings` |
| V14 | Vanity slug |
| V15 | `service_metrics` |
| V16 | `deployments.error_message` |
| V17 | `deployments.stage` |
| V18 | Delete seed accounts |

I do not squash these. Production has already applied them in order.

## What is not in this Postgres

- Container filesystems and tenant DB files (Docker volumes)
- NPM certificate private keys
- Docker images
- Portainer’s own database
- JWT secret, `DB_PASS`, Resend API key (env / compose)
- Project environment badge (`production` / `staging` / `development`)

## Delete order

UI requires the exact project or service name. Runtime first: Portainer stack (and Watchtower), then NPM host, then the row. If Portainer fails, the row stays. Orphan record beats a live container with no UI.

## First admin

Empty `users` after V18. I create the first admin myself (SQL on `cloudbase-postgres`, or bootstrap env on first boot). See [accounts.md](accounts.md).
