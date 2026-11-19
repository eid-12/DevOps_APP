# Verified Maps frontend deployment

This workflow reuses the existing production Portainer credential. It does not create an account, token or permission, and only deploys from `master`, subject to the existing production environment policy.

The approved Maps commit is recorded in `deploy/maps-release.json`. Its public Docker Hub tag must resolve to an immutable digest and the pulled image must carry the same revision label. The only accepted target is the `frontend` service in the `wakeb-application` stack on endpoint 3, with container name `wakeb-application-frontend-1`.

Before updating, the script checks the running frontend, its rollback digest, the exact literal Compose image field, existing stack environment and the other service containers. It rejects Git-managed stacks and ambiguous image references. Only the image scalar is replaced; environment values, other Compose bytes, pruning and forced image pulls remain unchanged. New images are pulled by digest first.

The English and Arabic public metadata and container state must remain healthy for 30 seconds. A failed release is rolled back to the previous digest only while the stack/environment still match this rollout. Lost responses are reconciled before deciding; unrelated operator changes and unknown states are never blindly overwritten. Other-service changes stop further mutations.

Secrets and full stack files stay in process memory. Evidence contains the target, release, public desired image, previous image ID and rollback digest; existing registry references and environment values are not logged or uploaded.

`node deploy/maps-frontend/test.cjs` runs the isolated failure/success scenarios without production credentials. The deployment workflow shares `production-deploy` concurrency with CloudBase so the server is not rolled concurrently by these workflows. Ops-only changes are excluded from the CloudBase application pipeline; application and CI-policy changes still run its existing checks.
