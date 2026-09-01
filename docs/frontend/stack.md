# Frontend stack

Angular SPA (`frontend/`). Screens and journeys: [product.md](product.md). Backend protocols: [../backend/stack.md](../backend/stack.md).

## Runtime

| Piece | Choice |
|-------|--------|
| Framework | Angular **18** |
| Language | TypeScript **5.5** |
| UI | PrimeNG + PrimeFlex + PrimeIcons (vendored tarballs under `frontend/vendor-pkgs/`) |
| Spinner | `ngx-spinner` (vendored) |
| Streams | RxJS **7.8** |
| Local serve | `ng serve` on `:4200`, proxy `/api` and `/ws` → `:8080` (`proxy.conf.json`) |
| Production | nginx image, listen **3000** |

There is no NgRx. App state is services + interceptors (`frontend/src/app/core/`).

## Talking to the API

| Piece | File | Job |
|-------|------|-----|
| Bearer token | `auth.interceptor.ts` | `Authorization` on `/api/**` |
| Errors | `api-error.interceptor.ts` + `friendly-error.ts` | Map JSON `message` for toasts |
| Loading | `loading.interceptor.ts` | Global spinner |
| Config | `app-config.service.ts` | `GET /api/public/app-config` at boot |
| Auth | `auth.service.ts` | Login, JWT in `localStorage`, `/auth/me` |
| Projects | `project.service.ts` | CRUD, deploy, logs, domains |
| Admin | `admin.service.ts` | Users, hosting, audit |
| GitHub | `github-oauth.service.ts` | Browser OAuth; secret stays on the API |

`useApi: true` in local `environment.ts` is required or the UI talks to `mock-store.ts` instead of Spring Boot.

## Live updates

`deployment-events.service.ts` opens **STOMP over SockJS** to `/ws` (same origin; proxied locally). JWT goes on STOMP `CONNECT`. Topics match the backend broker:

- `/topic/deployments/{serviceId}`
- `/topic/logs/{serviceId}`

SockJS / STOMP are loaded from `window` (CDN/global), not an npm package. If the socket dies, HTTP polling still works.

Server side of this: [../backend/stack.md](../backend/stack.md) (WebSocket section).
