# Operations (CloudBase itself)

Updating **CloudBase** is a different pipeline from updating a tenant app.

`git push` to [eid-12/DevOps_APP](https://github.com/eid-12/DevOps_APP) only updates GitHub. The Mini PC keeps running `minipcer/cloudbase-backend:latest` and `minipcer/cloudbase-frontend:latest` until I rebuild and roll the Portainer stack.

There is no GitHub Actions workflow in this repo that deploys www for me.

## What I do when the UI or API should change

1. Change code in this repo. Push to `master` if I want it saved.
2. Build the JAR / Angular dist on a machine that can compile (host JDK 17 + Node). Do not bake `application-local.properties` into the JAR.
3. Build and push Docker images:
   - `minipcer/cloudbase-backend:latest`
   - `minipcer/cloudbase-frontend:latest` (nginx must listen on 3000)
4. On Portainer, update stack **cloudbase-platform** with pull enabled (stack id 44, endpoint 3 on this host).

Frontend cache: `index.html` is `Cache-Control: no-store` so a stale SPA chunk is less likely after a roll.

## Local vs live

| | Local | Live |
|--|-------|------|
| Compose | `docker-compose.yml` (build context) | `docker-compose.prod.yml` (prebuilt images) |
| UI | `http://localhost:4200` | `https://www.cloudbase.website` |
| API | `http://localhost:8080` | `https://api.cloudbase.website` |
| GitHub callback | `http://localhost:4200/auth/github/callback` | `https://www.cloudbase.website/auth/github/callback` |

I never commit `.env`, `backend/src/main/resources/application-local.properties`, or `frontend/src/environments/environment.ts`.

## If something looks “offline”

Admin → Infrastructure talks to the API, which talks to Portainer. If the browser still shows Portainer as down with empty metrics, it is usually an old JS bundle. Hard refresh. The live API route is `GET /api/admin/infrastructure`.
