# Credential migration procedure

Prepared on 2026-10-29. This is a procedure, not evidence that migration or rotation has happened.
Changes to CloudBase-React and credential rotation require the owner's approval.

## Verified consumers

- DevOps_APP: `.github/workflows/ci-cd.yml` uses Docker Hub credentials for publishing platform images
  and moving `latest` after a successful deployment. Repository secret names are `DOCKERHUB_USERNAME`
  and `DOCKERHUB_TOKEN`; production environment values can override repository values.
- CloudBase-React: both `.github/workflows/cloudbase-deploy.yml` and `.github/workflows/deploy.yml`
  reference those same secret names. GitHub metadata still dates them to 2026-08-19. Updating only the
  generated workflow leaves the second consumer active. The repository is public; secret values were
  not retrieved, and public repository status does not establish whether its container packages are public.
- CloudBase runtime: Portainer API key is used by the backend and by the production deployment job.
  Backend settings can override environment values. Local operator configuration and private backup
  stack snapshots also contain credentials; handle them privately during rotation.
- Backend Docker Hub token settings remain configurable for compatibility, but current tenant provisioning
  does not consume them or write repository secrets. Removing unused runtime settings is part of rotation.
- Other existing Docker workloads, registry entries, external automation and operator Docker logins have
  not been exhaustively inventoried. Do not revoke an old token until their consumers are checked.

## Tenant image migration after approval

1. Establish stable access and save the live tenant service settings, stack configuration, current image
   digests and rollback references privately. Do not copy platform credentials into the repository.
2. Review both CloudBase-React workflows. Replace its generated workflow with CloudBase's current GHCR
   workflow, and remove or migrate the duplicate publishing workflow with the owner's agreement.
   Publishing uses only the repository's job `GITHUB_TOKEN`, with `contents: read` and `packages: write`.
3. Confirm package ownership, visibility and repository access explicitly. Existing GHCR packages can
   have permissions independent of repository visibility; do not assume inheritance.
4. Prove that the service owner's credential can pull the private image and that a different unauthorized
   owner cannot. The current implementation uses the stored OAuth token with `read:packages`; this remains
   a live integration gate. GitHub's registry documentation specifies classic PAT authentication outside
   Actions, so reconnecting OAuth alone is not proof. If unsupported, implement a tenant-owned credential
   flow or another supported delivery mechanism; never substitute the platform's registry credential.
5. Update the tenant image reference, verify the running digest, health, routes and webhook redeployment,
   and retain the previous image for rollback. Only then remove the old repository secrets from
   https://github.com/eid-12/CloudBase-React/settings/secrets/actions.

## Rotation after approval

For each credential, create a least-privilege replacement, update verified consumers, exercise publishing,
deployment and rollback, then revoke the old credential. Never revoke first. Check both production
environment and repository Actions secrets, backend hosting overrides, stack environment, local operator
configuration and private backups. Keep volumes, networks and unrelated stack settings unchanged.

Portainer credentials must remain confined to the control plane and operator CI. Do not add a shared
GHCR registry credential in Portainer; the tenant pull must use that tenant's access.

## QA cleanup

The private test repository remains available for unfinished integration checks:
https://github.com/eid-12/cloudbase-e2e-1f317a.
After checks, delete only test-created services/stacks, proxy hosts and data listed in the private resource
ledger, then the test package and repository. Do not delete unrelated workloads. If deletion scope is
absent, use the repository's Settings > General > Danger Zone at
https://github.com/eid-12/cloudbase-e2e-1f317a/settings and the exact package settings linked by the test
publishing run. No package deletion link is asserted until a package is actually observed.

Sources: [GHCR authentication and access](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
and [OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps).
