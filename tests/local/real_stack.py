"""End-to-end tenant isolation on the REAL local Docker engine: real Portainer CE, real Nginx Proxy Manager, the
real API JAR, the egress guard, two tenants. No simulated infrastructure (GitHub is not used).

  python -u tests/local/real_stack.py [--jar backend/target/cloudbase-backend-0.0.1-SNAPSHOT.jar] [--docker-restart]

Stages:
  1. guard absent      -> a tenant deploy is refused before any tenant container exists
  2. guard running     -> both tenants deploy; routing, own database, internet, administration work; bypass checks
  3. guard stopped     -> rules stay in the kernel; tenants stay protected and running
  4. rules deleted     -> the API stops and quarantines every tenant; exposure window measured
  5. guard restarted   -> tenants are started again; checks hold
  6. Docker restart    -> (--docker-restart) tenants do not auto-start; the API starts them once isolation is proven

Everything it creates is labelled cloudbase.realstack=<run> or named cb-svc-*/cloudbase-edge/cloudbase-guard-canary/
project-*, and is removed at the end, guard rules included. Refuses to run if any of those names already exist.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUN = 'realstack-' + uuid.uuid4().hex[:6]
LABEL = ['--label', 'cloudbase.realstack=' + RUN]
PLATFORM = RUN + '-platform'
PASSWORD = 'Local-Qa-Only!2026'
ADMIN = 'admin@cloudbase.test'
NPM_IMAGE = 'jc21/nginx-proxy-manager:2.11.3'
PORTAINER_IMAGE = 'portainer/portainer-ce:2.21.5'
results, ports, seen_projects = [], {}, set()


def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok or not detail else ' -- ' + str(detail)[:300]), flush=True)


def note(msg):
    print('OBSERVED ' + msg, flush=True)


def docker(*args, check_rc=True, timeout=300):
    p = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=timeout,
                       env=dict(os.environ, MSYS_NO_PATHCONV='1'))
    if check_rc and p.returncode:
        raise RuntimeError(f"docker {' '.join(map(str, args[:3]))} failed: {p.stderr[-400:]}")
    return p.stdout.strip()


def http(method, url, body=None, headers=None, timeout=30, form=None):
    data = None
    h = dict(headers or {})
    if form is not None:
        data = '&'.join(f'{k}={urllib.parse.quote(str(v))}' for k, v in form.items()).encode()
        h['Content-Type'] = 'application/x-www-form-urlencoded'
    elif body is not None:
        data = json.dumps(body).encode()
        h['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        r = e
    raw = r.read()
    try:
        return r.status, json.loads(raw) if raw else None
    except ValueError:
        return r.status, raw.decode(errors='replace')


import urllib.parse  # noqa: E402


def api(method, path, body=None, token=None):
    return http(method, f"http://127.0.0.1:{ports['api']}{path}", body, {'Authorization': 'Bearer ' + token} if token else None, 60)


def ip_of(container, network=None):
    nets = json.loads(docker('inspect', container, '--format', '{{json .NetworkSettings.Networks}}'))
    return nets[network]['IPAddress'] if network else {n: v['IPAddress'] for n, v in nets.items()}


def tcp(src, host, port, wait=2):
    return subprocess.run(['docker', 'exec', src, 'sh', '-c', f'nc -z -w {wait} {host} {port}'], capture_output=True,
                          timeout=30).returncode == 0


def running(name):
    return docker('inspect', name, '--format', '{{.State.Running}}', check_rc=False) == 'true'


def wait(cond, seconds, step=1.0):
    end = time.time() + seconds
    while time.time() < end:
        try:
            if cond():
                return True
        except Exception:
            pass
        time.sleep(step)
    return False


GUARD = RUN + '-guard'


def start_guard():
    # Local stand-in for deploy/egress-guard: identical script; alpine packages over HTTP because this workstation
    # intercepts TLS (apk still verifies package signatures). Production builds deploy/egress-guard/Dockerfile.
    guard = str(ROOT / 'deploy/egress-guard/guard.sh')
    docker('run', '-d', *LABEL, '--name', GUARD, '--network', 'host', '--restart', 'unless-stopped', '--cap-drop', 'ALL',
           '--cap-add', 'NET_ADMIN', '--cap-add', 'NET_RAW', '-e', 'INTERVAL=5',
           '--mount', f'type=bind,source={guard},target=/guard.sh,readonly', 'alpine:3.20', 'sh', '-c',
           'sed -i s#https://#http://# /etc/apk/repositories && apk add -q iptables iptables-legacy && exec sh /guard.sh')
    if not wait(lambda: guard_rules() == 5, 120):
        raise RuntimeError('guard did not install its rules: ' + docker('logs', GUARD, check_rc=False)[-300:])


def guard_rules():
    out = subprocess.run(['docker', 'run', '--rm', '--network', 'host', '--cap-add', 'NET_ADMIN', 'alpine:3.20', 'sh', '-c',
                          'sed -i s#https://#http://# /etc/apk/repositories; apk add -q iptables >/dev/null 2>&1; '
                          'iptables -S DOCKER-USER | grep -c cloudbase-egress-guard'], capture_output=True, text=True, timeout=180)
    return int((out.stdout.strip() or '0').splitlines()[-1])


def remove_guard_rules():
    guard = str(ROOT / 'deploy/egress-guard/guard.sh')
    docker('run', '--rm', '--network', 'host', '--cap-drop', 'ALL', '--cap-add', 'NET_ADMIN', '--cap-add', 'NET_RAW',
           '--mount', f'type=bind,source={guard},target=/guard.sh,readonly', 'alpine:3.20', 'sh', '-c',
           'sed -i s#https://#http://# /etc/apk/repositories && apk add -q iptables iptables-legacy && sh /guard.sh --remove')


def preflight():
    for name in ('nginx-proxy', 'cloudbase-edge', 'cloudbase-guard-canary'):
        if docker('ps', '-aq', '--filter', f'name=^{name}$'):
            raise RuntimeError(f'container {name} already exists locally; refusing to run')
    if docker('ps', '-aq', '--filter', 'name=^cb-svc-'):
        raise RuntimeError('cb-svc-* containers already exist locally; refusing to run')
    for net in ('cloudbase-edge', 'cloudbase-canary'):
        if docker('network', 'ls', '-q', '--filter', f'name=^{net}$'):
            raise RuntimeError(f'network {net} already exists locally; refusing to run')
    if guard_rules():
        raise RuntimeError('guard rules already present locally; refusing to run')


def platform(jar):
    docker('network', 'create', *LABEL, PLATFORM)
    docker('run', '-d', *LABEL, '--name', RUN + '-db', '--network', PLATFORM, '--restart', 'unless-stopped',
           '-e', 'POSTGRES_DB=cloudbase', '-e', 'POSTGRES_USER=cloudbase', '-e', 'POSTGRES_PASSWORD=synthetic-local-db-only',
           'postgres:16-alpine')
    docker('run', '-d', *LABEL, '--name', RUN + '-portainer', '--network', PLATFORM, '--restart', 'unless-stopped',
           '-v', '/var/run/docker.sock:/var/run/docker.sock', '-p', '127.0.0.1::9000', PORTAINER_IMAGE)
    docker('run', '-d', *LABEL, '--name', 'nginx-proxy', '--network', PLATFORM, '--restart', 'unless-stopped',
           '-v', RUN + '-npm-data:/data', '-v', RUN + '-npm-le:/etc/letsencrypt',
           '-p', '127.0.0.1::80', '-p', '127.0.0.1::81', NPM_IMAGE)
    ports['portainer'] = docker('port', RUN + '-portainer', '9000').splitlines()[0].rsplit(':', 1)[1]
    ports['npm80'] = docker('port', 'nginx-proxy', '80').splitlines()[0].rsplit(':', 1)[1]
    ports['npm81'] = docker('port', 'nginx-proxy', '81').splitlines()[0].rsplit(':', 1)[1]
    base = f"http://127.0.0.1:{ports['portainer']}/api"
    if not wait(lambda: http('GET', base + '/status')[0] == 200, 90):
        raise RuntimeError('portainer did not start')
    http('POST', base + '/users/admin/init', {'Username': 'admin', 'Password': PASSWORD + PASSWORD})
    jwt = http('POST', base + '/auth', {'Username': 'admin', 'Password': PASSWORD + PASSWORD})[1]['jwt']
    auth = {'Authorization': 'Bearer ' + jwt}
    code, ep = http('POST', base + '/endpoints', headers=auth, form={'Name': 'local', 'EndpointCreationType': 1})
    if code != 200:
        raise RuntimeError(f'portainer endpoint: {code} {ep}')
    code, key = http('POST', base + '/users/1/tokens', {'description': RUN, 'password': PASSWORD + PASSWORD}, auth)
    if code not in (200, 201):
        raise RuntimeError(f'portainer api key: {code} {key}')
    if not wait(lambda: http('GET', f"http://127.0.0.1:{ports['npm81']}/api/")[0] == 200, 120):
        raise RuntimeError('NPM did not start')
    env = {
        'SPRING_PROFILES_ACTIVE': 'prod', 'DB_URL': f'jdbc:postgresql://{RUN}-db:5432/cloudbase', 'DB_USER': 'cloudbase',
        'DB_PASS': 'synthetic-local-db-only', 'JWT_SECRET': 'local-qa-only-signing-key-' + uuid.uuid4().hex,
        'GITHUB_WEBHOOK_SECRET': 'local-qa-only-webhook', 'CLOUDBASE_BOOTSTRAP_ADMIN_EMAIL': ADMIN,
        'CLOUDBASE_BOOTSTRAP_ADMIN_PASSWORD': PASSWORD, 'PORTAINER_URL': f'http://{RUN}-portainer:9000',
        'PORTAINER_API_KEY': key['rawAPIKey'], 'PORTAINER_ENDPOINT_ID': str(ep['Id']), 'NPM_ENABLED': 'true',
        'NPM_URL': 'http://nginx-proxy:81', 'NPM_EMAIL': 'admin@example.com', 'NPM_PASSWORD': 'changeme',
        'NPM_CERTIFICATE_ID': '0', 'RESEND_ENABLED': 'false', 'GITHUB_CLIENT_ID': '', 'GITHUB_CLIENT_SECRET': '',
        'CLOUDBASE_BASE_DOMAIN': 'realstack.test', 'CLOUDBASE_PUBLIC_API_URL': 'http://localhost',
        'CLOUDBASE_WATCHTOWER_ENABLED': 'false', 'CLOUDBASE_VOLUME_ROOT': '/tmp/' + RUN,
        'CLOUDBASE_CORS_ALLOWED_ORIGINS': 'http://127.0.0.1', 'CLOUDBASE_ISOLATION_CHECK_MS': '5000',
        'CLOUDBASE_ISOLATION_CHECK_INITIAL_MS': '5000', 'CLOUDBASE_EDGE_RECONCILE_MS': '10000',
        'CLOUDBASE_EDGE_RECONCILE_INITIAL_MS': '10000'}
    docker('run', '-d', *LABEL, '--name', RUN + '-api', '--network', PLATFORM, '--restart', 'unless-stopped',
           '-p', '127.0.0.1::8080', '--mount', f'type=bind,source={Path(jar).resolve()},target=/app.jar,readonly',
           *[a for k, v in env.items() for a in ('-e', f'{k}={v}')], 'eclipse-temurin:17-jre-alpine',
           'java', '-Xmx384m', '-jar', '/app.jar')
    ports['api'] = docker('port', RUN + '-api', '8080').splitlines()[0].rsplit(':', 1)[1]
    if not wait(lambda: api('GET', '/actuator/health')[0] == 200, 180, 2):
        raise RuntimeError('API did not start: ' + docker('logs', '--tail', '40', RUN + '-api', check_rc=False)[-1500:])


def tenant(tag, admin_token):
    reg = api('POST', '/api/auth/register', {'name': tag, 'email': f'{tag}-{RUN}@cloudbase.test', 'password': PASSWORD})[1]
    api('PATCH', f"/api/admin/users/{reg['user']['id']}/deployment-access", {'enabled': True}, admin_token)
    t = reg['token']
    pid = api('POST', '/api/projects', {'name': f'{tag}-project'}, t)[1]['id']
    seen_projects.add(pid)
    return {'tag': tag, 'token': t, 'pid': pid}


def deploy_service(tn, kind):
    body = ({'name': f"{tn['tag']}-web", 'sourceType': 'DOCKER', 'sourceDetails': {'imageName': 'nginx', 'imageTag': '1.27-alpine', 'containerPort': 80},
             'quota': {'memoryMb': 64, 'cpuMilli': 200, 'storageGb': 0}} if kind == 'app' else
            {'name': f"{tn['tag']}-db", 'sourceType': 'DATABASE', 'sourceDetails': {'dbType': 'POSTGRESQL'},
             'quota': {'memoryMb': 256, 'cpuMilli': 200, 'storageGb': 1}})
    code, svc = api('POST', f"/api/projects/{tn['pid']}/services", body, tn['token'])
    if code != 201:
        raise RuntimeError(f'create {kind}: {code} {svc}')
    dep = {}
    for _ in range(240):
        d = api('GET', f"/api/projects/services/{svc['id']}/deployments", token=tn['token'])[1] or []
        if d and d[0]['status'] in ('SUCCESS', 'FAILED'):
            dep = d[0]
            break
        time.sleep(1)
    full = api('GET', f"/api/projects/services/{svc['id']}", token=tn['token'])[1]
    return svc['id'], dep, full


def public(host):
    r = subprocess.run(['curl', '-s', '-m', '10', '-H', f'Host: {host}', f"http://127.0.0.1:{ports['npm80']}/"],
                       capture_output=True, text=True, timeout=30)
    return r.stdout.strip()


def isolation_checks(stage, tenants):
    """Tenant A (and the reverse for B) against every bypass path; positive controls for legitimate traffic."""
    for me, other in ((tenants[0], tenants[1]), (tenants[1], tenants[0])):
        a = me['app']
        check(f'[{stage}] {me["tag"]} public hostname routes through NPM and the edge to its own app',
              public(me['host']) == f"tenant-{me['tag']}", public(me['host'])[:80])
        check(f'[{stage}] {me["tag"]} app reaches its own database', tcp(a, me['db'], 5432))
        check(f'[{stage}] {me["tag"]} keeps internet egress', tcp(a, '1.1.1.1', 443, 4))
        targets = {'NPM admin :81': ('nginx-proxy', 81), 'NPM :80': ('nginx-proxy', 80), 'Portainer :9000': (RUN + '-portainer', 9000),
                   'platform DB :5432': (RUN + '-db', 5432), 'API :8080': (RUN + '-api', 8080),
                   'isolation canary :80': ('cloudbase-guard-canary', 80),
                   f'{other["tag"]} app :80': (other['app'], 80), f'{other["tag"]} database :5432': (other['db'], 5432)}
        for label, (container, port) in targets.items():
            check(f'[{stage}] {me["tag"]} cannot reach {label} by name', not tcp(a, container, port))
            for net, ip in ip_of(container).items():
                check(f'[{stage}] {me["tag"]} cannot reach {label} at {ip} ({net})', not tcp(a, ip, port))
        # Host addresses: the bridge gateway and Docker Desktop's host aliases, on every published port.
        gw = json.loads(docker('network', 'inspect', f"project-{me['pid']}", '--format', '{{json .IPAM.Config}}'))[0]['Gateway']
        hosts = [gw] + [h for h in ('host.docker.internal', 'gateway.docker.internal')
                        if subprocess.run(['docker', 'exec', a, 'getent', 'hosts', h], capture_output=True).returncode == 0]
        for h in hosts:
            for label, port in (('NPM admin', ports['npm81']), ('Portainer', ports['portainer']), ('API', ports['api'])):
                check(f'[{stage}] {me["tag"]} cannot reach host {h} published {label} :{port}', not tcp(a, h, port))
        # The edge: tenants share its bridge, so it must refuse them whatever Host they send.
        for host in (other['host'], me['host'], 'unknown.example'):
            r = subprocess.run(['docker', 'exec', a, 'sh', '-c', f"wget -q -T 4 -O - --header 'Host: {host}' http://cloudbase-edge/ 2>&1"],
                               capture_output=True, text=True, timeout=30).stdout
            check(f'[{stage}] {me["tag"]} cannot use the edge with Host {host}', 'tenant-' not in r, r[:100])
        # IPv6: link-local on the tenant bridge (the only v6 path when IPv6 is not enabled on the networks).
        v6 = docker('network', 'inspect', f"project-{me['pid']}", '--format', '{{.EnableIPv6}}')
        edge_ll = subprocess.run(['docker', 'exec', 'cloudbase-edge', 'sh', '-c',
                                  f"ip -6 addr | awk '/fe80/ {{print $2}}' | cut -d/ -f1"], capture_output=True, text=True).stdout.split()
        note(f'[{stage}] project network IPv6 enabled: {v6}; edge link-local addresses: {edge_ll}')
        for ll in edge_ll:
            ok = subprocess.run(['docker', 'exec', a, 'sh', '-c', f'nc -z -w 2 {ll}%eth0 80'], capture_output=True).returncode != 0
            r = subprocess.run(['docker', 'exec', a, 'sh', '-c', f"wget -q -T 3 -O - --header 'Host: {other['host']}' http://[{ll}%25eth0]/ 2>&1"],
                               capture_output=True, text=True).stdout
            check(f'[{stage}] {me["tag"]} gets nothing from the edge over IPv6 {ll}', ok or 'tenant-' not in r, r[:80])
    # Authorized administration still works.
    check(f'[{stage}] administration: NPM admin UI reachable from the host', 'Nginx Proxy Manager' in
          subprocess.run(['curl', '-s', '-m', '10', f"http://127.0.0.1:{ports['npm81']}/"], capture_output=True, text=True).stdout)
    check(f'[{stage}] administration: NPM admin reachable from the platform network',
          subprocess.run(['docker', 'exec', RUN + '-db', 'sh', '-c', 'nc -z -w 2 nginx-proxy 81'], capture_output=True).returncode == 0)
    check(f'[{stage}] administration: Portainer API reachable from the host',
          http('GET', f"http://127.0.0.1:{ports['portainer']}/api/status")[0] == 200)


def mark_apps(tenants):
    for tn in tenants:
        wait(lambda: subprocess.run(['docker', 'exec', tn['app'], 'sh', '-c',
                                     f"echo tenant-{tn['tag']} > /usr/share/nginx/html/index.html"], capture_output=True).returncode == 0, 30)


def all_running(tenants):
    return all(running(tn[k]) for tn in tenants for k in ('app', 'db'))


def none_running(tenants):
    return not any(running(tn[k]) for tn in tenants for k in ('app', 'db'))


def docker_restart():
    subprocess.run(['powershell', '-NoProfile', '-Command',
                    "Get-Process 'Docker Desktop','com.docker.backend','com.docker.build' -ErrorAction SilentlyContinue | Stop-Process -Force; "
                    "wsl --terminate docker-desktop; Start-Sleep 5; Start-Process 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe'"],
                   capture_output=True, timeout=120)
    if not wait(lambda: subprocess.run(['docker', 'ps'], capture_output=True, timeout=10).returncode == 0, 300, 5):
        raise RuntimeError('Docker did not come back')


def cleanup(tenants):
    # Stop the API first: its isolation guard otherwise recreates the canary, probes and project networks while they
    # are being removed, leaving them behind (and making the next run refuse to start).
    docker('stop', '-t', '5', RUN + '-api', check_rc=False)
    for name in docker('ps', '-a', '--format', '{{.Names}}', check_rc=False).split():
        if name.startswith(('cb-svc-', 'cb-wt-svc-', 'cb-probe-')) or name in ('cloudbase-edge', 'cloudbase-guard-canary'):
            docker('rm', '-f', '-v', name, check_rc=False)
    for c in docker('ps', '-aq', '--filter', 'label=cloudbase.realstack=' + RUN, check_rc=False).split():
        docker('rm', '-f', '-v', c, check_rc=False)
    for tn in tenants:
        docker('network', 'rm', f"project-{tn['pid']}", check_rc=False)
    # Project networks the API created in this run for projects outside `tenants` (refused or failed stages).
    for net in docker('network', 'ls', '--filter', 'label=cloudbase.role=project-network', '--format', '{{.Name}}', check_rc=False).split():
        if docker('network', 'inspect', net, '--format', '{{len .Containers}}', check_rc=False) == '0' and net[len('project-'):] in seen_projects:
            docker('network', 'rm', net, check_rc=False)
    for net in ('cloudbase-edge', 'cloudbase-canary', PLATFORM):
        docker('network', 'rm', net, check_rc=False)
    for v in (RUN + '-npm-data', RUN + '-npm-le'):
        docker('volume', 'rm', v, check_rc=False)
    try:
        if guard_rules():
            remove_guard_rules()
        note(f'guard rules left after cleanup: {guard_rules()}')
    except Exception as e:  # noqa: BLE001
        note(f'guard rule cleanup failed: {e}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--jar', default=str(ROOT / 'backend/target/cloudbase-backend-0.0.1-SNAPSHOT.jar'))
    ap.add_argument('--docker-restart', action='store_true')
    args = ap.parse_args()
    preflight()
    tenants = []
    try:
        platform(args.jar)
        admin = api('POST', '/api/auth/login', {'email': ADMIN, 'password': PASSWORD})[1]['token']

        # 1. No guard: provisioning is refused before any tenant container exists.
        a = tenant('tenanta', admin)
        sid, dep, _ = deploy_service(a, 'app')
        check('[no guard] deploy is refused with an isolation message', dep.get('status') == 'FAILED'
              and 'reached a published port' in (dep.get('errorMessage') or ''), (dep.get('status'), dep.get('errorMessage')))
        check('[no guard] no tenant container was created', not docker('ps', '-aq', '--filter', 'name=^cb-svc-'))
        api('DELETE', f'/api/projects/services/{sid}', token=a['token'])

        # 2. Guard running: both tenants deploy and every path is checked.
        start_guard()
        tenants = [a, tenant('tenantb', admin)]
        for tn in tenants:
            for kind in ('db', 'app'):
                sid, dep, full = deploy_service(tn, kind)
                check(f"[guard] {tn['tag']} {kind} deploys", dep.get('status') == 'SUCCESS', (dep.get('status'), dep.get('errorMessage')))
                tn[kind] = full['containerName']
                if kind == 'app':
                    tn['host'] = full.get('subdomain') or ''
                    tn['app_sid'] = sid
        mark_apps(tenants)
        time.sleep(3)
        isolation_checks('guard running', tenants)

        # 3. Guard container stopped: its rules stay in the kernel; nothing is exposed or stopped.
        docker('stop', GUARD)
        time.sleep(15)
        check('[guard stopped] rules are still installed', guard_rules() == 5)
        check('[guard stopped] tenants keep running', all_running(tenants))
        check('[guard stopped] a tenant still cannot reach NPM admin', not any(tcp(tenants[0]['app'], ip, 81) for ip in ip_of('nginx-proxy').values()))

        # 4. Rules deleted while the guard is down: the API must stop every tenant.
        remove_guard_rules()
        removed_at = time.time()  # after the rules are gone (installing iptables in the helper takes seconds)
        exposed_for = None
        while time.time() - removed_at < 60:
            if not running(tenants[0]['app']):
                exposed_for = time.time() - removed_at
                break
            time.sleep(0.5)
        note(f'rules deleted -> tenant A stopped after {exposed_for and round(exposed_for, 1)} s')
        check('[rules deleted] every tenant container is stopped', wait(lambda: none_running(tenants), 60), [(tn[k], running(tn[k])) for tn in tenants for k in ('app', 'db')])
        check('[rules deleted] stopped within three check intervals (15 s)', exposed_for is not None and exposed_for <= 15, exposed_for)
        q = api('GET', f"/api/projects/services/{tenants[0]['app_sid']}", token=tenants[0]['token'])[1]
        note(f"[rules deleted] service status shown to the owner: {q.get('status')}")
        notes = api('GET', '/api/notifications', token=tenants[0]['token'])[1] or []
        check('[rules deleted] the owner is told why', any('paused for safety' in str(n).lower() for n in notes), str(notes)[:200])
        new_dep = deploy_service(tenants[0], 'app')[1]
        check('[rules deleted] new deploys are refused', new_dep.get('status') == 'FAILED', new_dep.get('status'))

        # 5. Guard back: tenants are started again and isolation holds.
        docker('start', GUARD)
        check('[guard restarted] rules are back', wait(lambda: guard_rules() == 5, 60))
        check('[guard restarted] tenants are started again', wait(lambda: all_running(tenants), 90), [(tn[k], running(tn[k])) for tn in tenants for k in ('app', 'db')])
        mark_apps(tenants)
        isolation_checks('guard restarted', tenants)

        # 6a. Edge replaced (what an image upgrade does in production): the API recreates it on the pinned image,
        #     reattaches project networks and rewrites routes, so every tenant is reachable again.
        docker('rm', '-f', 'cloudbase-edge')
        removed_edge_at = time.time()
        check('[edge replaced] tenants route again after the edge is recreated',
              wait(lambda: all('tenant-' in public(tn['host']) for tn in tenants), 240, 5),
              [public(tn['host'])[:60] for tn in tenants])
        note(f'[edge replaced] routing restored after {round(time.time() - removed_edge_at)} s')
        check('[edge replaced] the new edge runs the pinned image',
              'cloudbase.edge.image' in docker('inspect', '-f', '{{json .Config.Labels}}', 'cloudbase-edge', check_rc=False))
        isolation_checks('edge replaced', tenants)

        # 6. Deleting a service leaves nothing behind: its container, its anonymous volumes and its image go,
        #    while an image other services still run (postgres) stays and other tenants are untouched.
        had_mongo = docker('images', '-q', 'mongo:7', check_rc=False) != ''
        docker('pull', '-q', 'mongo:7', check_rc=False)  # pulled up front so the deploy is not timed on a download
        tn = tenants[0]
        code, m = api('POST', f"/api/projects/{tn['pid']}/services", {
            'name': f"{tn['tag']}-mongo", 'sourceType': 'DATABASE', 'sourceDetails': {'dbType': 'MONGODB'},
            'quota': {'memoryMb': 256, 'cpuMilli': 200, 'storageGb': 1}}, tn['token'])
        mongo_deployed = code == 201 and wait(lambda: (api('GET', f"/api/projects/services/{m['id']}/deployments",
                                                           token=tn['token'])[1] or [{}])[0].get('status') == 'SUCCESS', 240, 2)
        check('[delete cleanup] a MongoDB database deploys', mongo_deployed)
        mongo_name = 'cb-' + m['id'] if code == 201 else ''
        mongo_volumes = [v for v in docker('inspect', '-f', '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{end}}{{end}}',
                                           mongo_name, check_rc=False).split() if len(v) == 64]
        note(f'[delete cleanup] MongoDB anonymous volumes before delete: {len(mongo_volumes)}')
        check('[delete cleanup] the MongoDB container has an anonymous volume to clean up', len(mongo_volumes) > 0, mongo_volumes)
        code, _ = api('DELETE', f"/api/projects/services/{m['id']}", token=tn['token'])
        check('[delete cleanup] delete succeeds', code == 204, code)
        check('[delete cleanup] its container is gone', not docker('ps', '-aq', '--filter', f'name=^{mongo_name}$', check_rc=False))
        left = [v for v in mongo_volumes if docker('volume', 'ls', '-q', '--filter', f'name={v}', check_rc=False)]
        check('[delete cleanup] its anonymous volumes are gone', not left, left)
        check('[delete cleanup] its image is removed (nothing else uses it)',
              wait(lambda: docker('images', '-q', 'mongo:7', check_rc=False) == '', 30, 2))
        check('[delete cleanup] the postgres image other databases use is kept',
              docker('images', '-q', 'postgres:16-alpine', check_rc=False) != '')
        check('[delete cleanup] the other tenant is untouched', all_running(tenants[1:]))
        if had_mongo:
            docker('pull', '-q', 'mongo:7', check_rc=False)  # put back what this machine had before the run

        # 7. Docker restart while tenants run.
        if args.docker_restart:
            docker_restart()
            up_at = time.time()
            early = {tn[k]: running(tn[k]) for tn in tenants for k in ('app', 'db')}
            note(f'[docker restart] tenant containers running right after the engine came back: {early}')
            check('[docker restart] tenant containers do not start with the daemon', not any(early.values()), early)
            check('[docker restart] guard rules are restored by the guard container', wait(lambda: guard_rules() == 5, 120))
            check('[docker restart] the API starts tenants once isolation is proven', wait(lambda: all_running(tenants), 240), early)
            note(f'[docker restart] tenants running {round(time.time() - up_at)} s after the engine came back')
            ports['api'] = docker('port', RUN + '-api', '8080').splitlines()[0].rsplit(':', 1)[1]
            ports['portainer'] = docker('port', RUN + '-portainer', '9000').splitlines()[0].rsplit(':', 1)[1]
            ports['npm80'] = docker('port', 'nginx-proxy', '80').splitlines()[0].rsplit(':', 1)[1]
            ports['npm81'] = docker('port', 'nginx-proxy', '81').splitlines()[0].rsplit(':', 1)[1]
            wait(lambda: public(tenants[0]['host']) != '', 120, 3)
            mark_apps(tenants)
            isolation_checks('after docker restart', tenants)
    finally:
        cleanup(tenants)
    print(f'{sum(results)}/{len(results)} real-stack isolation checks passed')
    return 0 if results and all(results) else 1


if __name__ == '__main__':
    sys.exit(main())
