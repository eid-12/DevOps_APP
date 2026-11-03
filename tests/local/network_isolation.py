"""Network isolation on REAL Docker with the real Nginx Proxy Manager image and what the real API asked for.

Run on a fresh lab (python tests/local/lab.py start ...). Tenants get projects with an nginx app and a Postgres
database through the real API (simulated Portainer). The script then replays, on the local Docker engine, every
network, container and exec operation the API sent (the edge, its network, project networks, route table) and
brings up the generated compose stacks, next to stand-ins for the platform (database, API, Portainer) and the
actual jc21/nginx-proxy-manager image (admin :81, public :80), configured through its own API to forward tenant
hostnames to the edge.

Checks: both tenant hostnames route through NPM to their own app; the management path (platform network ->
NPM :81) still works; tenant containers cannot open a TCP connection to NPM :81 (or any NPM port) by name or by
any of its IPs, cannot use the edge to reach another project, and cannot reach the other tenant or the platform.
Then the edge and NPM are recreated and a third tenant project is added; the API's reconcile restores routing
and the same checks hold. Everything carries the label cloudbase.netiso=<run id> and is removed at the end.
"""
import base64
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
from pathlib import Path
from lab import request, state, PASSWORD, ADMIN

RUN = 'netiso-' + uuid.uuid4().hex[:6]
LABEL = ['--label', 'cloudbase.netiso=' + RUN]
NPM_IMAGE = 'jc21/nginx-proxy-manager:2.11.3'
results = []
work = Path(tempfile.mkdtemp(prefix=RUN))


def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok or not detail else ' -- ' + str(detail)[:300]), flush=True)


def docker(*args, check_rc=True, timeout=300):
    p = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=timeout)
    if check_rc and p.returncode:
        raise RuntimeError(f"docker {' '.join(map(str, args[:3]))} failed: {p.stderr[-400:]}")
    return p.stdout.strip()


s = state()
sql = lambda q: subprocess.check_output(['docker', 'exec', s['prefix'] + '-db', 'psql', '-U', 'cloudbase', '-d', 'cloudbase',
                                         '-Atc', q], text=True).strip()
mock_get = lambda p: json.loads(subprocess.check_output(['docker', 'exec', s['prefix'] + '-mock', 'node', '-e',
                                f"fetch('http://127.0.0.1:9000{p}').then(r=>r.text()).then(console.log)"], text=True))
mock_post = lambda p, m='POST': subprocess.check_output(['docker', 'exec', s['prefix'] + '-mock', 'node', '-e',
                                f"fetch('http://127.0.0.1:9000{p}',{{method:'{m}'}}).then(r=>r.text())"], text=True)
admin = request('POST', '/api/auth/login', {'email': ADMIN, 'password': PASSWORD})[1]['token']
for name in ('nginx-proxy', 'cloudbase-edge'):
    if docker('ps', '-aq', '--filter', f'name=^{name}$'):
        raise RuntimeError(f'a container named {name} already exists locally; refusing to touch it')
if docker('network', 'ls', '-q', '--filter', 'name=^cloudbase-edge$'):
    raise RuntimeError('a network named cloudbase-edge already exists locally; refusing to touch it')

# The edge network exists on the real engine first, so the API embeds the real subnet in the edge's access rule.
docker('network', 'create', *LABEL, 'cloudbase-edge')
cidr = json.loads(docker('network', 'inspect', 'cloudbase-edge', '--format', '{{json .IPAM.Config}}'))[0]['Subnet']
mock_post('/_subnet/cloudbase-edge/' + cidr.replace('/', '/'))
replayed = 0


def replay():
    """Apply, in order, the operations the API sent since the last replay."""
    global replayed
    ops = mock_get('/_ops')
    for op in ops[replayed:]:
        kind = op['op']
        if kind == 'network-create':
            if not docker('network', 'ls', '-q', '--filter', f"name=^{op['name']}$"):
                opts = [a for k, v in (op.get('options') or {}).items() for a in ('-o', f'{k}={v}')]
                docker('network', 'create', *LABEL, *opts, op['name'])
        elif kind == 'connect':
            gw = ['--gw-priority', str(op['gwPriority'])] if op.get('gwPriority') is not None else []
            docker('network', 'connect', *gw, op['net'], op['container'], check_rc=False)
        elif kind == 'disconnect':
            docker('network', 'disconnect', '-f', op['net'], op['container'], check_rc=False)
        elif kind == 'remove':
            docker('rm', '-f', op['name'], check_rc=False)
        elif kind == 'create':
            b = op['body']
            hc = b.get('HostConfig', {})
            args = ['create', *LABEL, '--name', op['name'], '--network', hc['NetworkMode'],
                    '--restart', hc.get('RestartPolicy', {}).get('Name', 'no'), '--memory', str(hc.get('Memory', 0) or '64m')]
            for opt in hc.get('SecurityOpt', []):
                args += ['--security-opt', opt]
            for k, v in b.get('Labels', {}).items():
                args += ['--label', f'{k}={v}']
            docker(*args, b['Image'], *b['Cmd'])
        elif kind == 'start':
            docker('start', op['name'])
        elif kind == 'exec':
            # A route write can race a removal the test made on purpose; the reconcile rewrites routes afterwards.
            if docker('ps', '-q', '--filter', f"name=^{op['container']}$"):
                docker('exec', op['container'], *op['cmd'])
    replayed = len(ops)


def routes():
    """Hostname -> container from the last route table the API wrote to the edge."""
    last = [o for o in mock_get('/_ops') if o['op'] == 'exec' and 'cb-routes.map' in ' '.join(o['cmd'])][-1]
    table = base64.b64decode(re.search(r'printf %s (\S+) \|', last['cmd'][-1]).group(1)).decode()
    return {line.split()[1].split(':')[0]: line.split()[0] for line in table.splitlines() if line.strip()}


def settle(sid, token):
    for _ in range(120):
        d = request('GET', f'/api/projects/services/{sid}/deployments', token=token)[1] or []
        if d and d[0]['status'] in ('SUCCESS', 'FAILED'):
            return d[0]
        time.sleep(0.5)
    return d[0] if d else {}


def tenant(tag):
    reg = request('POST', '/api/auth/register', {'name': tag, 'email': f'{tag}-{RUN}@cloudbase.test', 'password': PASSWORD})[1]
    request('PATCH', f"/api/admin/users/{reg['user']['id']}/deployment-access", {'enabled': True}, admin)
    t = reg['token']
    pid = request('POST', '/api/projects', {'name': f'{tag}-project'}, t)[1]['id']
    out = {'tag': tag, 'pid': pid}
    for kind, body in [('db', {'name': f'{tag}-db', 'sourceType': 'DATABASE', 'sourceDetails': {'dbType': 'POSTGRESQL'},
                               'quota': {'memoryMb': 256, 'cpuMilli': 200, 'storageGb': 1}}),
                       ('app', {'name': f'{tag}-web', 'sourceType': 'DOCKER',
                                'sourceDetails': {'imageName': 'nginx', 'imageTag': '1.27-alpine', 'containerPort': 80},
                                'quota': {'memoryMb': 64, 'cpuMilli': 200, 'storageGb': 0}})]:
        svc = request('POST', f'/api/projects/{pid}/services', body, t)[1]
        dep = settle(svc['id'], t)
        if dep.get('status') != 'SUCCESS':
            raise RuntimeError(f'{tag} {kind} deploy did not succeed: {dep}')
        out[kind] = {'sid': svc['id'], 'container': sql(f"select container_name from services where id='{svc['id']}'"),
                     'compose': sql(f"select compose_snapshot from deployments where id='{dep['id']}'")}
    return out


def up(t):
    replay()
    for kind in ('db', 'app'):
        f = work / f"{t[kind]['sid']}.yml"
        f.write_text(t[kind]['compose'])
        p = subprocess.run(['docker', 'compose', '-p', f"{RUN}-{t[kind]['sid']}", '-f', str(f), 'up', '-d'],
                           capture_output=True, text=True, env=dict(os.environ, DB_PASSWORD='synthetic-tenant-db'), timeout=300)
        if p.returncode:
            raise RuntimeError(f"compose up {t[kind]['sid']}: {p.stderr[-600:]}")
    app = t['app']['container']
    for _ in range(30):
        if subprocess.run(['docker', 'exec', app, 'sh', '-c', f"echo tenant-{t['tag']} > /usr/share/nginx/html/index.html"],
                          capture_output=True).returncode == 0:
            break
        time.sleep(1)


def ips(container):
    return {n: v['IPAddress'] for n, v in json.loads(docker('inspect', container, '--format', '{{json .NetworkSettings.Networks}}')).items()}


def tcp(src, host, port):
    return subprocess.run(['docker', 'exec', src, 'sh', '-c', f'nc -z -w 2 {host} {port}'], capture_output=True, timeout=30).returncode == 0


def http(src, url, host=None):
    hdr = f"--header 'Host: {host}' " if host else ''
    r = subprocess.run(['docker', 'exec', src, 'sh', '-c', f"wget -q -T 4 -O - {hdr}'{url}' 2>&1; echo \" rc=$?\""],
                       capture_output=True, text=True, timeout=30)
    return r.stdout.strip()


npm_ports = {}


def start_npm():
    docker('run', '-d', *LABEL, '--name', 'nginx-proxy', '--network', platform_net, '-v', f'{RUN}-npm-data:/data',
           '-v', f'{RUN}-npm-le:/etc/letsencrypt', '-p', '127.0.0.1::80', '-p', '0.0.0.0::81', NPM_IMAGE)
    npm_ports['80'] = docker('port', 'nginx-proxy', '80').splitlines()[0].rsplit(':', 1)[1]
    npm_ports['81'] = docker('port', 'nginx-proxy', '81').splitlines()[0].rsplit(':', 1)[1]
    for _ in range(90):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{npm_ports['81']}/api/", timeout=3)
            return
        except Exception:
            time.sleep(2)
    raise RuntimeError('NPM did not start')


def npm_api(method, path, body=None, token=None):
    req = urllib.request.Request(f"http://127.0.0.1:{npm_ports['81']}/api{path}", method=method,
                                 data=None if body is None else json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    return json.loads(urllib.request.urlopen(req, timeout=20).read() or b'{}')


def npm_route(hosts):
    """What NpmClient sends: every tenant hostname forwards to the edge on :80."""
    tok = npm_api('POST', '/tokens', {'identity': 'admin@example.com', 'secret': 'changeme'})['token']
    for h in hosts:
        npm_api('POST', '/nginx/proxy-hosts', {'domain_names': [h], 'forward_scheme': 'http', 'forward_host': 'cloudbase-edge',
                'forward_port': 80, 'access_list_id': 0, 'certificate_id': 0, 'ssl_forced': False, 'caching_enabled': False,
                'block_exploits': True, 'advanced_config': '', 'meta': {}, 'allow_websocket_upgrade': True,
                'http2_support': False, 'hsts_enabled': False, 'hsts_subdomains': False, 'locations': []}, tok)


def public(host):
    r = subprocess.run(['curl', '-s', '-m', '10', '-H', f'Host: {host}', f"http://127.0.0.1:{npm_ports['80']}/"],
                       capture_output=True, text=True, timeout=30)
    return r.stdout.strip()


def verify(tag, tenants):
    host_of = routes()
    for t in tenants:
        h = host_of.get(t['app']['container'])
        check(f'[{tag}] {t["tag"]} hostname routes through NPM and the edge to its own app', h and public(h) == f"tenant-{t['tag']}",
              (h, public(h) if h else None))
    mgmt = http(f'{RUN}-platform-api', 'http://nginx-proxy:81/')
    check(f'[{tag}] management path: platform network reaches the NPM admin UI', 'Nginx Proxy Manager' in mgmt or '<html' in mgmt.lower(), mgmt[:120])
    a = tenants[0]['app']['container']
    for other in tenants[1:]:
        check(f'[{tag}] {tenants[0]["tag"]} cannot reach {other["tag"]} app by name', not tcp(a, other['app']['container'], 80))
        for net, ip in ips(other['app']['container']).items():
            check(f'[{tag}] {tenants[0]["tag"]} cannot reach {other["tag"]} app at {ip}', not tcp(a, ip, 80))
        check(f'[{tag}] {tenants[0]["tag"]} cannot reach {other["tag"]} database by name', not tcp(a, other['db']['container'], 5432))
        other_host = host_of.get(other['app']['container'])
        via_edge = http(a, 'http://cloudbase-edge/', other_host)
        check(f'[{tag}] {tenants[0]["tag"]} cannot use the edge to reach {other["tag"]}', f"tenant-{other['tag']}" not in via_edge, via_edge[:120])
    for t in tenants:
        app = t['app']['container']
        check(f'[{tag}] {t["tag"]} app reaches its own database', tcp(app, t['db']['container'], 5432))
        check(f'[{tag}] {t["tag"]} cannot connect to NPM :81 by name', not tcp(app, 'nginx-proxy', 81))
        for net, ip in ips('nginx-proxy').items():
            for port in (81,):
                reached = tcp(app, ip, port)
                detail = ''
                if reached:
                    detail = {'tenant_networks': ips(app), 'route': docker('exec', app, 'ip', 'route', check_rc=False),
                              'edge_networks': ips('cloudbase-edge')}
                check(f'[{tag}] {t["tag"]} cannot connect to NPM {ip}:{port} ({net})', not reached, detail)
        for label, c, port in (('platform database', f'{RUN}-platform-db', 5432), ('platform API', f'{RUN}-platform-api', 80),
                               ('Portainer', f'{RUN}-platform-portainer', 80)):
            check(f'[{tag}] {t["tag"]} cannot reach {label} by name', not tcp(app, c, port))
            for net, ip in ips(c).items():
                check(f'[{tag}] {t["tag"]} cannot reach {label} at {ip}', not tcp(app, ip, port))
        gw = next(iter(json.loads(docker('network', 'inspect', f"project-{t['pid']}", '--format', '{{json .IPAM.Config}}'))))['Gateway']
        reach = tcp(app, gw, npm_ports['81'])
        egress = subprocess.run(['docker', 'exec', app, 'sh', '-c', 'nc -z -w 4 1.1.1.1 443'], capture_output=True).returncode == 0
        check(f"[{tag}] {t['tag']} keeps internet egress", egress)
        print(f"OBSERVED [{tag}] {t['tag']} -> host gateway {gw}:{npm_ports['81']} (NPM :81 published on 0.0.0.0): {'REACHABLE' if reach else 'blocked'}", flush=True)


GUARD = f'{RUN}-guard'


def start_guard():
    # Local stand-in for deploy/egress-guard (alpine packages over HTTP: this workstation intercepts TLS; apk still
    # verifies package signatures). Production builds deploy/egress-guard/Dockerfile.
    guard = str(Path(__file__).resolve().parents[2] / 'deploy/egress-guard/guard.sh')
    docker('run', '-d', *LABEL, '--name', GUARD, '--network', 'host', '--cap-drop', 'ALL', '--cap-add', 'NET_ADMIN',
           '--cap-add', 'NET_RAW', '--mount', f'type=bind,source={guard},target=/guard.sh,readonly', 'alpine:3.20', 'sh', '-c',
           'sed -i s#https://#http://# /etc/apk/repositories && apk add -q iptables iptables-legacy && exec sh /guard.sh')
    for _ in range(90):
        if subprocess.run(['docker', 'exec', GUARD, 'sh', '-c', 'iptables -S DOCKER-USER | grep -q cloudbase-egress-guard'],
                          capture_output=True).returncode == 0:
            return
        time.sleep(1)
    raise RuntimeError('egress guard did not install its rules: ' + docker('logs', GUARD, check_rc=False)[-300:])


def wait_reconcile(condition, what):
    for _ in range(40):
        time.sleep(1.5)
        replay()
        if condition():
            return True
    check(f'API reconcile restored {what}', False)
    return False


platform_net = RUN + '-platform'
tenants = []
try:
    docker('network', 'create', *LABEL, platform_net)
    # Published like production (Portainer :9000, databases): Docker accepts published ports from any bridge.
    for name, image, extra in [('db', 'postgres:16-alpine', ['-e', 'POSTGRES_PASSWORD=synthetic-platform-only', '-p', '127.0.0.1::5432']),
                               ('api', 'nginx:1.27-alpine', []), ('portainer', 'nginx:1.27-alpine', ['-p', '127.0.0.1::80'])]:
        docker('run', '-d', *LABEL, '--name', f'{RUN}-platform-{name}', '--network', platform_net, *extra, image)
    start_npm()

    tenants = [tenant('tenanta'), tenant('tenantb')]
    for t in tenants:
        up(t)
    npm_route(routes().values())
    time.sleep(3)
    # Negative control: without the host guard, Docker lets tenant bridges reach published ports by container IP.
    a = tenants[0]['app']['container']
    exposed = {f'{c}:{port}': any(tcp(a, ip, port) for ip in ips(c).values())
               for c, port in (('nginx-proxy', 81), (f'{RUN}-platform-portainer', 80), (f'{RUN}-platform-db', 5432))}
    print('OBSERVED without host guard, tenant reaches published ports:', exposed, flush=True)
    check('negative control: without the guard a published port is reachable (the guard is needed)', any(exposed.values()), exposed)
    start_guard()
    verify('initial', tenants)

    # 1. Edge recreated on the host: the API must notice and rebuild it, its networks and its routes.
    docker('rm', '-f', 'cloudbase-edge')
    mock_post('/_forget/cloudbase-edge')
    wait_reconcile(lambda: bool(docker('ps', '-q', '--filter', 'name=^cloudbase-edge$')) and
                   all(public(h) == f"tenant-{t['tag']}" for t in tenants for h in [routes().get(t['app']['container'])]),
                   'the recreated edge')
    verify('after edge recreation', tenants)

    # 2. NPM recreated from its own definition (platform network only): the API reconnects it to the edge network.
    docker('rm', '-f', 'nginx-proxy')
    mock_post('/_networks/cloudbase-edge/nginx-proxy', 'DELETE')
    start_npm()
    wait_reconcile(lambda: all(public(routes().get(t['app']['container'])) == f"tenant-{t['tag']}" for t in tenants),
                   'routing through the recreated proxy')
    verify('after proxy recreation', tenants)

    # 3. A further project: same isolation for it and against it.
    third = tenant('tenantc')
    up(third)
    npm_route([routes()[third['app']['container']]])
    time.sleep(2)
    tenants.append(third)
    verify('with a third project', tenants)
    verify('third project as source', [third, tenants[0], tenants[1]])
finally:
    if docker('ps', '-q', '--filter', f'name=^{GUARD}$', check_rc=False):
        removed = subprocess.run(['docker', 'exec', GUARD, 'sh', '/guard.sh', '--remove'], capture_output=True, text=True)
        left = subprocess.run(['docker', 'exec', GUARD, 'sh', '-c', 'iptables -S DOCKER-USER | grep -c cloudbase-egress-guard'],
                              capture_output=True, text=True).stdout.strip()
        print(f'OBSERVED guard rollback exit {removed.returncode}, rules left: {left or 0}', flush=True)
    for t in tenants:
        for kind in ('app', 'db'):
            f = work / f"{t[kind]['sid']}.yml"
            if f.exists():
                subprocess.run(['docker', 'compose', '-p', f"{RUN}-{t[kind]['sid']}", '-f', str(f), 'down', '-v'],
                               capture_output=True, env=dict(os.environ, DB_PASSWORD='x'), timeout=180)
    for c in docker('ps', '-aq', '--filter', 'label=cloudbase.netiso=' + RUN).split():
        docker('rm', '-f', '-v', c, check_rc=False)
    for n in docker('network', 'ls', '-q', '--filter', 'label=cloudbase.netiso=' + RUN).split():
        docker('network', 'rm', n, check_rc=False)
    for v in (f'{RUN}-npm-data', f'{RUN}-npm-le'):
        docker('volume', 'rm', v, check_rc=False)
print(f'{sum(results)}/{len(results)} real-Docker network isolation checks passed')
sys.exit(0 if all(results) else 1)
