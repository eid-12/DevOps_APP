"""Rollback safety of custom-domain verification (V23), on the isolated lab (synthetic data only).

    python tests/local/rollback_domain.py --old-jar <jar of the release before V23> --new-jar <release jar>

Needs a running lab started with the NEW jar (so V23 is applied). The old release writes custom_domain directly with
no proof; the V23 trigger must refuse that, so a rollback cannot activate an unverified domain. A domain verified
before the rollback must keep working, the old release must start and serve, and rolling forward must work.
"""
import argparse
import json
import subprocess
import sys
import time
import uuid
from lab import request, state, PASSWORD, ADMIN

results = []


def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok or not detail else ' -- ' + str(detail)[:240]), flush=True)


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True, encoding='utf-8', errors='replace').strip()


def restart_api(jar):
    """Recreate the lab API container with the same synthetic env and a different jar (as rollback_check.py)."""
    s = state()
    name = s['prefix'] + '-api'
    info = json.loads(docker('inspect', name))[0]
    env = [e for e in info['Config']['Env'] if not e.startswith(('PATH=', 'JAVA_HOME=', 'LANG=', 'LANGUAGE=', 'LC_ALL=', 'JAVA_VERSION='))]
    docker('rm', '-f', name)
    args = ['run', '--detach', '--name', name, '--network', s['network'], '--network-alias', 'api', '--network-alias', 'cloudbase-backend',
            '--label', 'cloudbase.local-test=' + s['prefix'], '--memory', '640m', '--cpus', '1',
            '--mount', f'type=bind,source={jar},target=/app.jar,readonly']
    for e in env:
        args += ['-e', e]
    docker(*args, '--entrypoint', 'java', info['Config']['Image'], '-Xmx384m', '-jar', '/app.jar')
    for _ in range(150):
        try:
            if request('GET', '/actuator/health')[0] == 200:
                return True
        except OSError:
            pass
        if json.loads(docker('inspect', name))[0]['State']['Status'] != 'running':
            break
        time.sleep(1)
    print(docker('logs', '--tail', '30', name))
    return False


parser = argparse.ArgumentParser()
parser.add_argument('--old-jar', required=True)
parser.add_argument('--new-jar', required=True)
args = parser.parse_args()
s = state()
sql = lambda q: subprocess.run(['docker', 'exec', s['prefix'] + '-db', 'psql', '-U', 'cloudbase', '-d', 'cloudbase', '-Atc', q],
                               capture_output=True, text=True)
mock = lambda *c: subprocess.check_output(['docker', 'exec', s['prefix'] + '-mock', *c], text=True)

admin = request('POST', '/api/auth/login', {'email': ADMIN, 'password': PASSWORD})[1]['token']
reg = request('POST', '/api/auth/register', {'name': 'rb', 'email': f'rb-{uuid.uuid4().hex[:6]}@cloudbase.test', 'password': PASSWORD})[1]
request('PATCH', f"/api/admin/users/{reg['user']['id']}/deployment-access", {'enabled': True}, admin)
t = reg['token']
pid = request('POST', '/api/projects', {'name': 'rb'}, t)[1]['id']
sid = request('POST', f'/api/projects/{pid}/services', {'name': 'rb-web', 'sourceType': 'DOCKER',
              'sourceDetails': {'imageName': 'nginx', 'imageTag': 'alpine', 'containerPort': 80},
              'quota': {'memoryMb': 64, 'cpuMilli': 100, 'storageGb': 0}}, t)[1]['id']
time.sleep(8)
kept = f'kept-{uuid.uuid4().hex[:6]}.example.test'
claim = request('PUT', f'/api/projects/services/{sid}/custom-domain', {'domain': kept}, t)[1]
mock('node', '-e', f"fetch('http://127.0.0.1:9053/_dns/_cloudbase-challenge.{kept}/cloudbase-verify={claim['customDomainToken']}',{{method:'POST'}}).then(r=>r.text())")
code, r = request('POST', f'/api/projects/services/{sid}/custom-domain/verify', {}, t)
check('setup on the new release: a verified domain is active', code == 200 and r.get('customDomain') == kept, (code, r))
check('V23 is applied', sql("select success from flyway_schema_history where version = '23'").stdout.strip() == 't')

raw = sql(f"update services set custom_domain = 'raw-{uuid.uuid4().hex[:6]}.example.test' where id = '{sid}'")
check('the database itself refuses an unverified active domain', raw.returncode != 0 and 'requires ownership verification' in raw.stderr, raw.stderr[-200:])

check('the old release starts on the V23 database', restart_api(args.old_jar))
check('it still serves the verified domain owner', request('GET', f'/api/projects/services/{sid}', token=t)[1].get('customDomain') == kept)
grab = f'grab-{uuid.uuid4().hex[:6]}.example.test'
code, r = request('PUT', f'/api/projects/services/{sid}/custom-domain', {'domain': grab}, t)
now = sql(f"select custom_domain from services where id = '{sid}'").stdout.strip()
check('the old release cannot activate an unverified domain (write refused, nothing changed)', code >= 400 and now == kept, (code, now))
other_pid = request('POST', '/api/projects', {'name': 'rb2'}, t)[1]['id']
other = request('POST', f'/api/projects/{other_pid}/services', {'name': 'rb2-web', 'sourceType': 'DOCKER',
                'sourceDetails': {'imageName': 'nginx', 'imageTag': 'alpine', 'containerPort': 80},
                'quota': {'memoryMb': 64, 'cpuMilli': 100, 'storageGb': 0}}, t)
check('the old release still creates services', other[0] == 201, other[0])
check('no unverified domain became active during the rollback',
      sql("select count(*) from services where custom_domain is not null and custom_domain_verified_at is null").stdout.strip() == '0')

check('roll forward: the new release starts again', restart_api(args.new_jar))
check('the verified domain is still active after rolling forward',
      request('GET', f'/api/projects/services/{sid}', token=t)[1].get('customDomain') == kept)
print(f'{sum(results)}/{len(results)} domain rollback checks passed')
sys.exit(0 if all(results) else 1)
