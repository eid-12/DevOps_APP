"""Network isolation on REAL Docker, using the compose files the real API generated in a running lab.

Run on a fresh lab (python tests/local/lab.py start ...). The script creates two synthetic tenants, each with a
project holding an nginx app and a Postgres database, through the real API (simulated Portainer). It then takes
the generated compose snapshots and the networks the API asked for, and brings them up on the local Docker engine
next to stand-ins for the platform (database, API, Portainer on a platform network) and a reverse proxy with a
public listener (:80, routes by Host) and an admin listener (:81).

From tenant A's app container it attempts TCP connections, by container name and by IP, to: tenant B's app and
database, the platform database, API and Portainer, and the proxy's admin listener. Positive controls: each app
reaches its own database, the proxy reaches both apps, and the proxy serves each tenant's public host.
Everything it starts carries the label cloudbase.netiso=<run id> and is removed at the end.
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from lab import request, state, PASSWORD, ADMIN

RUN = 'netiso-' + uuid.uuid4().hex[:6]
LABEL = ['--label', 'cloudbase.netiso=' + RUN]
results = []
work = Path(tempfile.mkdtemp(prefix=RUN))


def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok or not detail else ' -- ' + str(detail)[:300]), flush=True)


def docker(*args, check_rc=True, timeout=180):
    p = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=timeout)
    if check_rc and p.returncode:
        raise RuntimeError(f"docker {' '.join(args[:3])} failed: {p.stderr[-400:]}")
    return p.stdout.strip()


s = state()
sql = lambda q: subprocess.check_output(['docker', 'exec', s['prefix'] + '-db', 'psql', '-U', 'cloudbase', '-d', 'cloudbase',
                                         '-Atc', q], text=True).strip()
mock = lambda *c: subprocess.check_output(['docker', 'exec', s['prefix'] + '-mock', *c], text=True)
admin = request('POST', '/api/auth/login', {'email': ADMIN, 'password': PASSWORD})[1]['token']


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
    out = {'pid': pid}
    for kind, body in [('app', {'name': f'{tag}-web', 'sourceType': 'DOCKER',
                                'sourceDetails': {'imageName': 'nginx', 'imageTag': '1.27-alpine', 'containerPort': 80},
                                'quota': {'memoryMb': 64, 'cpuMilli': 200, 'storageGb': 0}}),
                       ('db', {'name': f'{tag}-db', 'sourceType': 'DATABASE', 'sourceDetails': {'dbType': 'POSTGRESQL'},
                               'quota': {'memoryMb': 256, 'cpuMilli': 200, 'storageGb': 1}})]:
        svc = request('POST', f'/api/projects/{pid}/services', body, t)[1]
        dep = settle(svc['id'], t)
        if dep.get('status') != 'SUCCESS':
            raise RuntimeError(f'{tag} {kind} deploy did not succeed: {dep}')
        snap = sql(f"select compose_snapshot from deployments where id='{dep['id']}'")
        container = sql(f"select container_name from services where id='{svc['id']}'")
        out[kind] = {'sid': svc['id'], 'container': container, 'compose': snap}
    return out


A, B = tenant('tenanta'), tenant('tenantb')
requested = json.loads(mock('node', '-e', "fetch('http://127.0.0.1:9000/_networks').then(r=>r.text()).then(console.log)"))
print('networks the API prepared:', requested, flush=True)

proxy_conf = work / 'proxy.conf'
proxy_conf.write_text(
    'server { listen 81; location / { return 200 "proxy-admin\\n"; } }\n'
    'server { listen 80; resolver 127.0.0.11 valid=5s;\n'
    f'  location / {{ set $up ""; if ($host = "a.{RUN}.test") {{ set $up {A["app"]["container"]}; }}\n'
    f'    if ($host = "b.{RUN}.test") {{ set $up {B["app"]["container"]}; }}\n'
    '    proxy_pass http://$up:80; add_header X-Upstream $up always; } }\n')
platform_net = RUN + '-platform'
started = []
try:
    docker('network', 'create', *LABEL, platform_net)
    for name, image, extra in [('db', 'postgres:16-alpine', ['-e', 'POSTGRES_PASSWORD=synthetic-platform-only']),
                               ('api', 'nginx:1.27-alpine', []), ('portainer', 'nginx:1.27-alpine', [])]:
        docker('run', '-d', *LABEL, '--name', f'{RUN}-platform-{name}', '--network', platform_net, *extra, image)
        started.append(f'{RUN}-platform-{name}')
    proxy = f'{RUN}-proxy'
    docker('run', '-d', *LABEL, '--name', proxy, '--network', platform_net, '-p', '127.0.0.1::80',
           '--mount', f'type=bind,source={proxy_conf},target=/etc/nginx/conf.d/default.conf,readonly', 'nginx:1.27-alpine')
    started.append(proxy)

    # Networks exactly as the API prepared them (name, and whether the proxy joined).
    for net, members in requested.items():
        if net.startswith('project-') and net.split('project-', 1)[1] not in (A['pid'], B['pid']):
            continue
        docker('network', 'create', *LABEL, net)
        if 'nginx-proxy' in members:
            docker('network', 'connect', net, proxy)
    for t in (A, B):
        for kind in ('db', 'app'):
            f = work / f"{t[kind]['sid']}.yml"
            f.write_text(t[kind]['compose'])
            env = dict(os.environ, DB_PASSWORD='synthetic-tenant-db')
            p = subprocess.run(['docker', 'compose', '-p', f"{RUN}-{t[kind]['sid']}", '-f', str(f), 'up', '-d'],
                               capture_output=True, text=True, env=env, timeout=300)
            if p.returncode:
                raise RuntimeError(f"compose up {t[kind]['sid']}: {p.stderr[-600:]}")
    time.sleep(6)

    def ips(container):
        nets = json.loads(docker('inspect', container, '--format', '{{json .NetworkSettings.Networks}}'))
        return {n: v['IPAddress'] for n, v in nets.items()}

    def tcp(src, host, port):
        r = subprocess.run(['docker', 'exec', src, 'sh', '-c', f'nc -z -w 2 {host} {port}'], capture_output=True, text=True, timeout=30)
        return r.returncode == 0

    a_app, b_app, a_db, b_db = A['app']['container'], B['app']['container'], A['db']['container'], B['db']['container']
    for c in (a_app, b_app, a_db, b_db):
        nets = ips(c)
        check(f'{c} is attached only to its own project network', len(nets) == 1 and next(iter(nets)).startswith('project-'), nets)

    # Positive controls
    check('tenant A app reaches its own database by name', tcp(a_app, a_db, 5432))
    check('tenant B app reaches its own database by name', tcp(b_app, b_db, 5432))
    check('proxy reaches tenant A app', tcp(proxy, a_app, 80))
    check('proxy reaches tenant B app', tcp(proxy, b_app, 80))
    port = docker('port', proxy, '80').rsplit(':', 1)[1]
    for host, want in ((f'a.{RUN}.test', a_app), (f'b.{RUN}.test', b_app)):
        r = subprocess.run(['curl', '-s', '-o', os.devnull, '-D', '-', '-H', f'Host: {host}', f'http://127.0.0.1:{port}/'],
                           capture_output=True, text=True, timeout=30)
        check(f'proxy serves {host.split(".")[0]} from its own app', ' 200 ' in r.stdout.splitlines()[0] and want in r.stdout, r.stdout[:200])

    # Negative: from tenant A's app, by name and by every IP the target has
    targets = [('tenant B app', b_app, 80), ('tenant B database', b_db, 5432),
               ('platform database', f'{RUN}-platform-db', 5432), ('platform API', f'{RUN}-platform-api', 80),
               ('Portainer', f'{RUN}-platform-portainer', 80)]
    for label, container, p in targets:
        check(f'tenant A cannot reach {label} by name', not tcp(a_app, container, p))
        for net, ip in ips(container).items():
            check(f'tenant A cannot reach {label} at {ip} ({net})', not tcp(a_app, ip, p))
    reach_admin = tcp(a_app, proxy, 81)
    print(f"OBSERVED proxy admin listener reachable from tenant A app by name: {reach_admin}", flush=True)
    for net, ip in ips(proxy).items():
        print(f"OBSERVED proxy admin listener at {ip} ({net}) reachable from tenant A: {tcp(a_app, ip, 81)}", flush=True)
finally:
    for t in (A, B):
        for kind in ('app', 'db'):
            f = work / f"{t[kind]['sid']}.yml"
            if f.exists():
                subprocess.run(['docker', 'compose', '-p', f"{RUN}-{t[kind]['sid']}", '-f', str(f), 'down', '-v'],
                               capture_output=True, env=dict(os.environ, DB_PASSWORD='x'), timeout=180)
    for c in docker('ps', '-aq', '--filter', 'label=cloudbase.netiso=' + RUN).split():
        docker('rm', '-f', '-v', c, check_rc=False)
    for n in docker('network', 'ls', '-q', '--filter', 'label=cloudbase.netiso=' + RUN).split():
        docker('network', 'rm', n, check_rc=False)
print(f'{sum(results)}/{len(results)} real-Docker network isolation checks passed')
sys.exit(0 if all(results) else 1)
