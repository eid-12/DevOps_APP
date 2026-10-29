"""Rollback compatibility of session revocation, on the isolated lab (synthetic data only).

    python tests/local/rollback_check.py --old-jar <jar> --new-jar <jar> [--expect-safe]

Without --expect-safe the old jar is a release that ignores "sv" (e.g. 1b885e9): the check proves the risk and the
JWT_SECRET-rotation recovery. With --expect-safe it is the rollback build (branch rollback/1b885e9-sv): revoked
sessions must stay revoked with no secret rotation.

Needs a running lab started with the NEW jar. Swaps only the lab's API container: new -> old -> old with a
rotated JWT secret (the recovery step) -> new again, all on the same lab database.
"""
import argparse
import json
import subprocess
import sys
import time
import uuid
from lab import request, state, PASSWORD, ADMIN

results = []


def check(name, ok):
    results.append(ok)
    print(('PASS ' if ok else 'FAIL ') + name)


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True, encoding='utf-8', errors='replace').strip()


def restart_api(jar, jwt_secret=None):
    """Recreate the lab API container with the same synthetic env, a different jar and optionally a new secret."""
    s = state()
    name = s['prefix'] + '-api'
    info = json.loads(docker('inspect', name))[0]
    env = [e for e in info['Config']['Env'] if not e.startswith(('PATH=', 'JAVA_HOME=', 'LANG=', 'LANGUAGE=', 'LC_ALL=', 'JAVA_VERSION='))]
    if jwt_secret:
        env = [e for e in env if not e.startswith('JWT_SECRET=')] + ['JWT_SECRET=' + jwt_secret]
    docker('rm', '-f', name)
    args = ['run', '--detach', '--name', name, '--network', s['network'], '--network-alias', 'api',
            '--label', 'cloudbase.local-test=' + s['prefix'], '--memory', '640m', '--cpus', '1',
            '--mount', f'type=bind,source={jar},target=/app.jar,readonly']
    for e in env:
        args += ['-e', e]
    docker(*args, '--entrypoint', 'java', info['Config']['Image'], '-Xmx384m', '-jar', '/app.jar')
    for _ in range(120):
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
parser.add_argument('--expect-safe', action='store_true')
args = parser.parse_args()

email = 'rollback-' + uuid.uuid4().hex[:6] + '@cloudbase.test'
code, reg = request('POST', '/api/auth/register', {'name': 'Rollback QA', 'email': email, 'password': PASSWORD})
assert code == 200, reg
t1 = request('POST', '/api/auth/login', {'email': email, 'password': PASSWORD})[1]['token']
changed = request('POST', '/api/auth/change-password', {'currentPassword': PASSWORD, 'newPassword': 'Rolled-Qa!2026'}, t1)[1]
t2 = changed['token']
check('new release: token from before the password change is revoked', request('GET', '/api/auth/me', token=t1)[0] == 401)

check('old release starts on the migrated database (V19 present)', restart_api(args.old_jar))
check('old release accepts tokens issued by the new release', request('GET', '/api/auth/me', token=t2)[0] == 200)
revived = request('GET', '/api/auth/me', token=t1)[0] == 200
if args.expect_safe:
    check('rollback build keeps the revoked token revoked (no secret rotation)', not revived)
    t4 = request('POST', '/api/auth/login', {'email': email, 'password': 'Rolled-Qa!2026'})[1]['token']
    check('rollback build: password change succeeds', request('POST', '/api/auth/change-password',
          {'currentPassword': 'Rolled-Qa!2026', 'newPassword': 'Compat-Qa!2026'}, t4)[0] == 200)
    check('rollback build: password change revokes earlier sessions', request('GET', '/api/auth/me', token=t4)[0] == 401
          and request('GET', '/api/auth/me', token=t2)[0] == 401)
    t5 = request('POST', '/api/auth/login', {'email': email, 'password': 'Compat-Qa!2026'})[1]['token']
    check('roll forward: new release starts again', restart_api(args.new_jar))
    check('roll forward: token issued by the rollback build is accepted', request('GET', '/api/auth/me', token=t5)[0] == 200)
    check('roll forward: tokens revoked on the rollback build stay revoked', request('GET', '/api/auth/me', token=t4)[0] == 401)
    print(f'{sum(results)}/{len(results)} rollback checks passed')
    sys.exit(0 if all(results) else 1)
check('RISK CONFIRMED: old release accepts the token the new release had revoked', revived)

check('recovery: old release restarts with a rotated JWT secret', restart_api(args.old_jar, 'rotated-' + uuid.uuid4().hex))
check('recovery: revoked token is rejected after rotation', request('GET', '/api/auth/me', token=t1)[0] == 401)
check('recovery: every earlier token is rejected after rotation', request('GET', '/api/auth/me', token=t2)[0] == 401)
check('recovery: users sign in again normally', request('POST', '/api/auth/login', {'email': email, 'password': 'Rolled-Qa!2026'})[0] == 200)

check('roll forward: new release starts again', restart_api(args.new_jar, 'rotated-' + uuid.uuid4().hex))
t3 = request('POST', '/api/auth/login', {'email': email, 'password': 'Rolled-Qa!2026'})[1]['token']
request('POST', '/api/auth/change-password', {'currentPassword': 'Rolled-Qa!2026', 'newPassword': PASSWORD}, t3)
check('roll forward: revocation works again', request('GET', '/api/auth/me', token=t3)[0] == 401)
admin = request('POST', '/api/auth/login', {'email': ADMIN, 'password': PASSWORD})
check('roll forward: admin can sign in', admin[0] == 200)

print(f'{sum(results)}/{len(results)} rollback checks passed')
sys.exit(0 if all(results) else 1)
