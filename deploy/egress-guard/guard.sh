#!/bin/sh
# CloudBase tenant egress guard (host firewall, runs in the host network namespace with NET_ADMIN).
#
# Docker accepts traffic from ANY bridge to a published port on a container's IP, so a tenant container could
# reach every published service on the host (NPM admin :81, Portainer :9000, databases...) by IP. Tenant project
# networks use host bridges named cbp-* (set by the API). This keeps one rule per private range at the top of
# DOCKER-USER: NEW connections from a tenant bridge to a private address on another interface are dropped.
# Same-project traffic (bridged within cbp-*), replies, and internet egress are unaffected.
#
#   guard.sh          ensure the rules every $INTERVAL seconds (default)
#   guard.sh --once   ensure once and exit
#   guard.sh --remove remove the rules (rollback)
set -eu
INTERVAL="${INTERVAL:-30}"
RANGES="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16"

pick() {
  for ipt in iptables iptables-legacy; do
    if command -v "$ipt" >/dev/null 2>&1 && "$ipt" -S DOCKER-USER >/dev/null 2>&1; then echo "$ipt"; return; fi
  done
  echo "DOCKER-USER chain not found (is Docker running?)" >&2
  return 1
}

rule() { echo "DOCKER-USER -i cbp+ ! -o cbp+ -d $1 -m conntrack --ctstate NEW -m comment --comment cloudbase-egress-guard -j DROP"; }

ensure() {
  IPT=$(pick)
  for r in $RANGES; do
    # shellcheck disable=SC2046
    $IPT -C $(rule "$r") 2>/dev/null || $IPT -I $(rule "$r")
  done
}

remove() {
  IPT=$(pick)
  for r in $RANGES; do
    # shellcheck disable=SC2046
    while $IPT -C $(rule "$r") 2>/dev/null; do $IPT -D $(rule "$r"); done
  done
}

case "${1:-}" in
  --once) ensure ;;
  --remove) remove ;;
  *) trap 'exit 0' TERM INT; while true; do ensure; sleep "$INTERVAL" & wait $!; done ;;
esac
