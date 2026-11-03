"""Regenerate portainer-stack.yml from guard.sh. Portainer string stacks cannot build the Dockerfile, so the stack
installs iptables at start and writes the same guard.sh into the container. `$` is escaped for Compose."""
from pathlib import Path

here = Path(__file__).resolve().parent
script = (here / 'guard.sh').read_text()
body = '\n'.join('        ' + line if line else '' for line in script.replace('$', '$$').splitlines())
(here / 'portainer-stack.yml').write_text(f"""# Portainer stack form of the egress guard (Portainer cannot build images). Generated from guard.sh by
# deploy/egress-guard/make-portainer-stack.py; do not edit by hand. Review README.md before applying.
services:
  egress-guard:
    image: alpine:3.20
    container_name: cloudbase-egress-guard
    network_mode: host
    cap_drop: [ALL]
    cap_add: [NET_ADMIN, NET_RAW, CHOWN, DAC_OVERRIDE, FOWNER]
    security_opt: ["no-new-privileges:true"]
    restart: unless-stopped
    environment:
      INTERVAL: "5"
    entrypoint: ["sh", "-c"]
    command:
      - |
        apk add --no-cache iptables iptables-legacy >/dev/null
        cat > /usr/local/bin/guard.sh <<'GUARD'
{body}
        GUARD
        exec sh /usr/local/bin/guard.sh
""")
