# Tenant egress guard: host change for approval

## Why

Docker (engine 29.9.2, also the production engine) accepts connections from **any** bridge network to a container's
published ports on that container's IP, even when the port is published only on 127.0.0.1. Production publishes
`nginx-proxy` :81 (NPM admin), :80, :443, `portainer` :9000, `mysql-server` :3306, `mawrid-frontend` :3001 and
`wakeb-application-frontend-1` :3000. Without a host rule a tenant container could open TCP connections to all of
them by IP, whatever the network layout. Reproduced locally with the real images (negative control in
`tests/local/network_isolation.py`).

The API names each project network's host bridge `cbp-<id>`. The guard keeps one rule per private range at the top
of `DOCKER-USER`:

```
-i cbp+ ! -o cbp+ -d <range> -m conntrack --ctstate NEW -m comment --comment cloudbase-egress-guard -j DROP
ranges: 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16
```

New connections from a tenant bridge to a private address on another interface are dropped. Unaffected: traffic
inside a project (app to its database, edge to the app: same bridge), replies, internet egress, every non-tenant
container (`cloudbase`, NPM, Portainer, the platform API and database, other workloads), and the host itself.

## What the application does with it (already in the release, no host change needed)

- Before every tenant deploy the API proves isolation by effect: a short-lived probe on the project network must
  fail to reach `cloudbase-guard-canary` (a container publishing :80 on 127.0.0.1 on its own network) and must reach
  `cloudbase-edge` on its own network (control). Otherwise the deploy is refused before any stack call. With the
  release but without this guard, **no tenant workload can be deployed**.
- Every 30 s (`CLOUDBASE_ISOLATION_CHECK_MS`) each project with deployed services is probed. Proven exposure stops
  all of that project's containers and marks them quarantined (owner notified; UI shows "Paused for safety");
  proven protection starts them again. A failed probe leaves running services running and starts nothing.
- Tenant containers use `restart: "no"`: Docker never starts them by itself (a killed daemon counts as a failure, so
  `on-failure` would start them with the daemon). The API starts services that should be running, after a crash or a
  daemon/host restart, only once isolation is proven again (within one check interval). Watchtower never revives
  stopped tenants.

Local evidence (real Docker engine, real Portainer CE 2.21.5, real NPM 2.11.3, the release JAR, this guard):
`tests/local/real_stack.py`, results recorded in `.agent-handoff.md`.

## Change to apply (production host, Docker Desktop on the Mini PC)

Files: `deploy/egress-guard/{guard.sh,Dockerfile,docker-compose.yml}` at the released commit.

Privileges: the guard container runs with `network_mode: host` and only `NET_ADMIN` + `NET_RAW` (all other
capabilities dropped, `no-new-privileges`, read-only root filesystem). Applying it needs a shell on the host with
access to the Docker CLI (the same access used to run Docker Desktop); no Windows firewall or WSL change.

Through Portainer (approved path; no host shell needed): create a stack named `cloudbase-egress-guard` on
endpoint 3 from `portainer-stack.yml` (same `guard.sh`, embedded; iptables installed from the official Alpine
repository at start; capabilities NET_ADMIN, NET_RAW plus CHOWN/DAC_OVERRIDE/FOWNER for that install). Roll back by
running `sh /usr/local/bin/guard.sh --remove` in the container (Portainer console or exec), then removing the stack.
Regenerate the file with `python deploy/egress-guard/make-portainer-stack.py` whenever `guard.sh` changes.

Order:
1. Release the application (normal `master` push and CI/CD). Safe before the guard: tenant deploys are refused.
2. On the host, from a checkout of the released commit:
   ```
   docker compose -f deploy/egress-guard/docker-compose.yml build
   docker compose -f deploy/egress-guard/docker-compose.yml up -d
   ```
3. Verify (below). Only then let tenants deploy.

## Verify

```
# five rules present
docker exec cloudbase-egress-guard iptables -S DOCKER-USER | grep -c cloudbase-egress-guard        # -> 5

# a throwaway network named like a tenant bridge: blocked to published services, internet still works
docker network create -o com.docker.network.bridge.name=cbp-verify cb-verify
NPM_IP=$(docker inspect nginx-proxy --format '{{(index .NetworkSettings.Networks "cloudbase").IPAddress}}')
PORTAINER_IP=$(docker inspect portainer --format '{{(index .NetworkSettings.Networks "cloudbase").IPAddress}}')
docker run --rm --network cb-verify alpine:3.20 sh -c "nc -z -w2 $NPM_IP 81 && echo EXPOSED || echo blocked"        # -> blocked
docker run --rm --network cb-verify alpine:3.20 sh -c "nc -z -w2 $PORTAINER_IP 9000 && echo EXPOSED || echo blocked" # -> blocked
docker run --rm --network cb-verify alpine:3.20 sh -c "nc -z -w4 1.1.1.1 443 && echo internet-ok"                     # -> internet-ok
docker network rm cb-verify

# administration unaffected
curl -sI https://npm.cloudbase.website | head -1      # NPM admin through its normal route
curl -sI https://manage.cloudbase.website | head -1   # Portainer
```

In the application: the first tenant deploy succeeds; its deployment log has no "isolation could not be confirmed".

## Roll back

```
docker exec cloudbase-egress-guard /usr/local/bin/guard.sh --remove
docker compose -f deploy/egress-guard/docker-compose.yml down
docker run --rm --network host --cap-add NET_ADMIN --entrypoint sh cloudbase-egress-guard:local -c 'iptables -S DOCKER-USER | grep -c cloudbase-egress-guard'   # -> 0
```
(`--remove` must run before `down`; stopping the container alone leaves the rules in place, which is intended.)

During and after a rollback:
- Administration keeps working: the rules only match traffic entering from `cbp-*` bridges, so NPM, Portainer,
  the API and the host are reached exactly as before, with or without the guard.
- Tenant workloads stay protected by the application: within one check interval (30 s) of the rules disappearing
  the API proves exposure, stops every tenant container and refuses new deploys; they start again by themselves when
  the guard is reapplied. Expect tenant downtime for as long as the guard is absent.

## Not covered

- Bridges created by older releases (no `cbp-` name). Production had no tenant networks when inspected.
- The window between rules disappearing (guard stopped and rules deleted by hand, or Docker restarted before the
  guard reapplies them) and the next isolation check: measured locally at 5.8 s with a 5 s interval; production
  default is up to about one 30 s interval plus a probe. After a Docker restart tenants stay stopped until proven
  safe, so that path has no window.
- IPv6 is not enabled on CloudBase networks; enabling it would need equivalent ip6tables rules.
