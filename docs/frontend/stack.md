# Frontend stack

Angular SPA (`frontend/`). Screens and journeys: [product.md](product.md). Backend protocols: [../backend/stack.md](../backend/stack.md).

## Runtime

| Piece | Choice |
|-------|--------|
| Framework | Angular **21.2.25** (Node 22 builds) |
| Language | TypeScript **5.9.3** |
| UI | PrimeNG 21.1.10 + PrimeUIX themes 3.1.0; Lara indigo, dark scheme selected by `.cb-dark` on `html` |
| Spinner | `ngx-spinner` 22.0.1 (npm registry) |
| Font | Inter via `@fontsource-variable/inter` (OFL-1.1, self-hosted) |
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

The SPA always talks to the Spring Boot API (`apiBaseUrl`); there is no offline/mock mode.

## Live updates

The SPA refreshes deploy state, logs and metrics by **HTTP polling** of the service endpoints. It does not open the backend's STOMP `/ws` socket (no SockJS/STOMP client ships in the bundle); that endpoint and its topics (`/topic/deployments/{serviceId}`, `/topic/logs/{serviceId}`) are available for a future client. Server side: [../backend/stack.md](../backend/stack.md) (WebSocket section).
