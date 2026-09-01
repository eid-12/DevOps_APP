# Networking and domains

Public HTTPS is Nginx Proxy Manager. Docker DNS on the `cloudbase` network is how NPM finds containers by name.

## Platform names (I own these)

| Host | Forwards to |
|------|-------------|
| `www.cloudbase.website` | `cloudbase-frontend:3000` |
| `api.cloudbase.website` | `cloudbase-backend:8080` |
| `manage.cloudbase.website` | Portainer |
| `npm.cloudbase.website` | NPM UI |
| `mawrid.cloudbase.website` | mail domain (Resend), not an app |

Tenants cannot claim these as vanity URLs.

The API is not published on the Mini PC host port in production. Only the Docker network + NPM can reach `:8080`.

## What a tenant app gets

1. **Random platform host** — something like `cloudbase8472.cloudbase.website`. Always there after a successful deploy. Good for “just give me a URL”.
2. **Vanity** — one slug per account (`myapp.cloudbase.website`). Check availability in the service Network tab, then claim. Moving it to another of *their* services is allowed; stealing someone else’s is not.
3. **Custom domain** — they CNAME (or ALIAS) `app.example.com` to `cloudbase.website`, I check, then NPM gets a proxy host for that name. TLS uses the certificate id in Hosting settings (`NPM_CERTIFICATE_ID`).

## How the proxy is created

After Portainer has the container, Spring Boot calls the NPM API: hostname → container name on network `cloudbase`, scheme http, the container’s internal port (80, 3000, 8080, …). Users never open a host port on the Mini PC for their app. Many services can all listen on 80 *inside* their own containers.

## Local

`ng serve` on `:4200` proxies `/api` and `/ws` to `:8080`. No NPM. GitHub OAuth redirect must be the localhost callback or GitHub will refuse.
