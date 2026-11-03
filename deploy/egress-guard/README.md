# Tenant egress guard (host change, needs review before applying)

## Why

Docker (engine 29.9.2, the production engine) accepts traffic from **any** bridge network to a container's
published ports on that container's IP, even when the port is published only on 127.0.0.1. Production publishes
`nginx-proxy` :81 (NPM admin), :80, :443, `portainer` :9000, `mysql-server` :3306 and others. Without a host rule a
tenant container can therefore open a TCP connection to the NPM admin listener, Portainer or MySQL by IP, whatever
the network topology. Reproduced locally with the real NPM image (`tests/local/network_isolation.py`, negative
control: NPM :81, Portainer and Postgres all reachable without the guard).

The API names every project network's host bridge `cbp-<id>`. The guard keeps one rule per private range at the
top of `DOCKER-USER`:

```
-i cbp+ ! -o cbp+ -d <private range> -m conntrack --ctstate NEW -m comment --comment cloudbase-egress-guard -j DROP
```

New connections from a tenant bridge to any private address on another interface are dropped. Same-project
traffic (app to its database, edge to the app) stays on the bridge and is not affected; replies are not NEW;
internet egress is not private. The NPM -> edge path is on the edge network, not a `cbp-*` bridge.

Docker Desktop keeps iptables only in memory, so the guard runs as a container (host network, `NET_ADMIN`,
`restart: unless-stopped`) and re-asserts the rules every 30 s, also after Docker restarts.

## Apply (production host, Docker Desktop)

1. Build on the host (normal TLS): `docker compose -f deploy/egress-guard/docker-compose.yml build`
2. Start: `docker compose -f deploy/egress-guard/docker-compose.yml up -d`
3. Confirm the rules (one per range, 5 total):
   `docker exec cloudbase-egress-guard iptables -S DOCKER-USER | grep -c cloudbase-egress-guard` -> `5`

Apply it before the first tenant deployment of the per-project-network release. It does not change any existing
container; only `cbp-*` bridges (created by the new release) are matched, so existing workloads are unaffected.

## Verify

From a tenant container (after the first tenant deploy), each must fail:
`nc -z -w 2 <nginx-proxy IP on cloudbase> 81`, `nc -z -w 2 <portainer IP> 9000`, `nc -z -w 2 <mysql-server IP> 3306`.
Each must succeed: `nc -z -w 2 <own database container> 5432` (or its port), `nc -z -w 4 1.1.1.1 443`, and the
service's public URL. Locally the whole set is `python -u tests/local/network_isolation.py` (178 checks).

## Roll back

`docker exec cloudbase-egress-guard /usr/local/bin/guard.sh --remove && docker compose -f deploy/egress-guard/docker-compose.yml down`
then confirm `iptables -S DOCKER-USER | grep -c cloudbase-egress-guard` is `0` (run from any container with
`--network host --cap-add NET_ADMIN`). Removing the guard restores Docker's default behaviour; nothing else changes.

## Not covered

Bridges created before this release (no `cbp-` name) are not matched. Production had no tenant containers when
inspected. Older installations with tenant project networks must redeploy those projects after deleting the old
networks, or add equivalent rules for their bridge names.
