"""Disposable real API/Postgres lab. All credentials are synthetic; outbound networking is disabled.

python tests/local/lab.py start --jar <verified.jar> --frontend <dist/.../browser>
python tests/local/verify_api.py
python tests/local/lab.py stop
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[2]
STATE_DIR = Path(tempfile.gettempdir()) / 'cloudbase-isolated-lab'
STATE_FILE = STATE_DIR / 'state.json'
PASSWORD = 'Local-Qa-Only!2026'
ADMIN = 'admin@cloudbase.test'


def docker(*args):
    return subprocess.check_output(['docker', *map(str, args)], text=True).strip()


def state():
    return json.loads(STATE_FILE.read_text())


def save(value):
    STATE_DIR.mkdir(exist_ok=True)
    tmp = STATE_FILE.with_suffix('.tmp')
    tmp.write_text(json.dumps(value, indent=2))
    os.replace(tmp, STATE_FILE)


def request(method, path, data=None, token=None):
    s = state()
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(s['api'] + path, method=method, headers=headers,
                                 data=None if data is None else json.dumps(data).encode())
    try:
        response = urllib.request.urlopen(req, timeout=35)
    except urllib.error.HTTPError as error:
        response = error
    raw = response.read()
    try:
        body = json.loads(raw) if raw else None
    except ValueError:
        body = raw.decode(errors='replace')
    return response.status, body


def start(args):
    if STATE_FILE.exists():
        raise RuntimeError('A lab state already exists; stop that lab before starting another')
    jar = Path(args.jar).resolve()
    frontend = Path(args.frontend).resolve()
    with zipfile.ZipFile(jar) as archive:
        if any(n.startswith('BOOT-INF/classes/application-local.') for n in archive.namelist()):
            raise RuntimeError('Refusing a JAR containing local operator configuration')
    if not (frontend / 'index.html').exists():
        raise RuntimeError('Frontend build missing')
    prefix = 'cb-local-' + uuid.uuid4().hex[:8]
    s = {'prefix': prefix, 'containers': [], 'network': prefix, 'frontend': str(frontend),
         'jwtExpirationMs': args.jwt_expiration_ms or 7200000}
    save(s)
    try:
        docker('network', 'create', '--internal', '--label', 'cloudbase.local-test=' + prefix, prefix)
        common = ['--detach', '--network', prefix, '--label', 'cloudbase.local-test=' + prefix]
        for suffix, image, extra in [
            ('db', 'postgres:16-alpine', ['--memory', '256m', '--cpus', '0.5', '--network-alias', 'db',
             '--tmpfs', '/var/lib/postgresql/data:rw,size=192m', '-e', 'POSTGRES_DB=cloudbase',
             '-e', 'POSTGRES_USER=cloudbase', '-e', 'POSTGRES_PASSWORD=synthetic-local-db-only']),
            ('mock', 'cdtest-runner2', ['--memory', '128m', '--cpus', '0.5', '--network-alias', 'mock',
             '--mount', f'type=bind,source={ROOT / "tests/local/mock-infrastructure.cjs"},target=/mock.cjs,readonly',
             '--entrypoint', 'node']),
        ]:
            name = prefix + '-' + suffix
            s['containers'].append(name)
            save(s)
            docker('run', *common, '--name', name, *extra, image, *(['/mock.cjs'] if suffix == 'mock' else []))
        for _ in range(30):
            probe = subprocess.run(['docker', 'exec', prefix + '-db', 'pg_isready', '-U', 'cloudbase'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if probe.returncode == 0:
                break
            time.sleep(1)
        name = prefix + '-api'
        s['containers'].append(name)
        save(s)
        env = {
            'SPRING_PROFILES_ACTIVE': 'prod', 'DB_URL': 'jdbc:postgresql://db:5432/cloudbase',
            'DB_USER': 'cloudbase', 'DB_PASS': 'synthetic-local-db-only',
            'JWT_SECRET': 'local-qa-only-signing-key-' + uuid.uuid4().hex,
            'GITHUB_WEBHOOK_SECRET': 'local-qa-only-webhook',
            'CLOUDBASE_BOOTSTRAP_ADMIN_EMAIL': ADMIN, 'CLOUDBASE_BOOTSTRAP_ADMIN_PASSWORD': PASSWORD,
            'PORTAINER_URL': 'http://mock:9000', 'PORTAINER_API_KEY': 'synthetic-key', 'PORTAINER_ENDPOINT_ID': '1',
            'NPM_ENABLED': 'false', 'NPM_URL': 'http://mock:9000', 'RESEND_ENABLED': 'false',
            'GITHUB_CLIENT_ID': '', 'GITHUB_CLIENT_SECRET': '', 'DOCKER_HUB_TOKEN': '',
            'CLOUDBASE_BASE_DOMAIN': 'cloudbase.test', 'CLOUDBASE_PUBLIC_API_URL': 'http://localhost',
            'CLOUDBASE_WATCHTOWER_ENABLED': 'false', 'CLOUDBASE_VOLUME_ROOT': '/tmp/cloudbase-test',
            'CLOUDBASE_CORS_ALLOWED_ORIGINS': 'http://127.0.0.1',
        }
        if args.jwt_expiration_ms:
            env['JWT_EXPIRATION_MS'] = str(int(args.jwt_expiration_ms))
        envargs = [v for k, val in env.items() for v in ('-e', k + '=' + val)]
        # --email adds tests/local/labmail (compiled by the caller) beside the JAR; the JAR itself is unchanged.
        java_args = ['-jar', '/app.jar']
        mail_mount = []
        if args.email:
            java_args = ['-cp', '/app.jar', '-Dloader.path=/labmail', 'org.springframework.boot.loader.launch.PropertiesLauncher']
            mail_mount = ['--mount', f'type=bind,source={Path(args.email).resolve()},target=/labmail,readonly']
        docker('run', *common, '--name', name, '--network-alias', 'api', '--memory', '640m', '--cpus', '1', *mail_mount,
               '--mount', f'type=bind,source={jar},target=/app.jar,readonly',
               *envargs, '--entrypoint', 'java',
               # The JDK image adds jcmd, used by ws_verify.mjs to count retained session objects.
               'eclipse-temurin:17-jdk-alpine' if args.jdk else 'eclipse-temurin:17-jre-alpine',
               '-Xmx384m', *java_args)
        gateway = prefix + '-gateway'
        s['containers'].append(gateway)
        save(s)
        docker('run', '--detach', '--name', gateway, '--label', 'cloudbase.local-test=' + prefix,
               '--memory', '128m', '--cpus', '0.5', '-p', '127.0.0.1::8080',
               '--mount', f'type=bind,source={ROOT / "tests/local/gateway.cjs"},target=/gateway.cjs,readonly',
               '--mount', f'type=bind,source={frontend},target=/frontend,readonly',
               '--entrypoint', 'node', 'cdtest-runner2', '/gateway.cjs')
        docker('network', 'connect', prefix, gateway)
        port = docker('port', gateway, '8080').rsplit(':', 1)[1]
        s['api'] = s['web'] = 'http://127.0.0.1:' + port
        save(s)
        for _ in range(90):
            try:
                if request('GET', '/actuator/health')[0] == 200:
                    break
            except (OSError, urllib.error.URLError):
                pass
            time.sleep(1)
        else:
            print(subprocess.run(['docker', 'logs', '--tail', '400', name], capture_output=True, text=True, errors='replace').stdout[-40000:])
            raise RuntimeError('Isolated API did not become healthy')
        print(json.dumps({'api': s['api'], 'web': s['web'], 'state': str(STATE_FILE), 'outbound': 'disabled'}))
    except BaseException:
        stop()
        raise


def stop():
    if not STATE_FILE.exists():
        return
    s = state()
    for name in reversed(s['containers']):
        check = subprocess.run(['docker', 'inspect', '--format', '{{index .Config.Labels "cloudbase.local-test"}}', name],
                               capture_output=True, text=True)
        if check.returncode == 0 and check.stdout.strip() == s['prefix']:
            docker('rm', '-f', '-v', name)
    subprocess.run(['docker', 'network', 'rm', s['network']], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    STATE_FILE.unlink()
    print('Removed only this lab\'s labelled containers, ephemeral volumes and network')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['start', 'stop'])
    parser.add_argument('--jar')
    parser.add_argument('--frontend')
    parser.add_argument('--jwt-expiration-ms', type=int)
    parser.add_argument('--jdk', action='store_true')
    parser.add_argument('--email', help='directory with compiled labmail classes')
    args = parser.parse_args()
    {'start': lambda: start(args), 'stop': stop}[args.command]()
