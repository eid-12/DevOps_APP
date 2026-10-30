"""Crash and retry tests of service creation, real app + Postgres, SIMULATED GitHub and Portainer.
Needs: lab.py start --email <compiled labmail> (fault injection is loaded from outside the JAR).
"""
import json
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from lab import request, state, PASSWORD, ADMIN

results = []
s = state()
api_c, mock_c, db_c = s['prefix'] + '-api', s['prefix'] + '-mock', s['prefix'] + '-db'
dk = lambda *c: subprocess.run(['docker', *c], capture_output=True, text=True)
sql = lambda q: dk('exec', db_c, 'psql', '-U', 'cloudbase', '-d', 'cloudbase', '-Atc', q).stdout.strip()
flag = lambda f: dk('exec', api_c, 'touch', '/tmp/' + f)
unflag = lambda f: dk('exec', api_c, 'rm', '-f', '/tmp/' + f)
ci_calls = lambda: len(dk('exec', api_c, 'cat', '/tmp/lab-ci-calls').stdout)
stacks = lambda: json.loads(dk('exec', mock_c, 'node', '-e', "fetch('http://127.0.0.1:9000/_stacks').then(r=>r.text()).then(console.log)").stdout)


def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else ' -- ' + str(detail)))


def wait_up():
    for _ in range(120):
        try:
            if request('GET', '/actuator/health')[0] == 200:
                return True
        except OSError:
            pass
        time.sleep(1)
    return False


def restart():
    dk('start', api_c)
    return wait_up()


def post(path, data, token, key, timeout=40):
    req = urllib.request.Request(s['api'] + path, method='POST', data=json.dumps(data).encode(),
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Idempotency-Key': key})
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        r = e
    except OSError:
        return 0, None  # connection lost: outcome unknown to the client
    raw = r.read()
    try:
        return r.status, json.loads(raw) if raw else None
    except ValueError:
        return r.status, None  # gateway text: the API did not answer


at = request('POST', '/api/auth/login', {'email': ADMIN, 'password': PASSWORD})[1]['token']
email = 'faults-' + uuid.uuid4().hex[:6] + '@cloudbase.test'
reg = request('POST', '/api/auth/register', {'name': 'Faults', 'email': email, 'password': PASSWORD})[1]
code = dk('exec', api_c, 'cat', '/tmp/lab-mail/' + email).stdout.strip()
request('POST', '/api/auth/verify-email', {'email': email, 'code': code})
request('PATCH', '/api/admin/users/' + reg['user']['id'] + '/deployment-access', {'enabled': True}, at)
t = request('POST', '/api/auth/login', {'email': email, 'password': PASSWORD})[1]['token']
pid = post('/api/projects', {'name': 'faults'}, t, uuid.uuid4().hex)[1]['id']
body = lambda n: {'name': n, 'sourceType': 'GITHUB', 'sourceDetails': {'repositoryUrl': 'https://github.com/local-qa/f-' + n, 'branch': 'main', 'runtime': 'node'},
                  'quota': {'memoryMb': 64, 'cpuMilli': 100, 'storageGb': 0}}
named = lambda n: [x for x in request('GET', f'/api/projects/{pid}', token=t)[1]['services'] if x['name'] == n]
state_of = lambda n: sql(f"select setup_state from services where name='{n}' and project_id='{pid}'")
deps = lambda sid: request('GET', f'/api/projects/services/{sid}/deployments', token=t)[1]

# 1. crash before the GitHub effect: tracked row, retry completes once
key = uuid.uuid4().hex
flag('lab-halt-before-ci')
c, _ = post(f'/api/projects/{pid}/services', body('before-ci'), t, key)
check('crash before GitHub loses the response', c in (0, 502), c)
check('row and progress survive the crash', state_of('before-ci') == 'PENDING_CI' and restart(), state_of('before-ci'))
n = ci_calls()
c, r = post(f'/api/projects/{pid}/services', body('before-ci'), t, key)
check('retry with the key completes the same service', c == 201 and len(named('before-ci')) == 1 and state_of('before-ci') == 'DONE', (c, state_of('before-ci')))
check('GitHub step ran once for this retry', ci_calls() == n + 1)

# 2. crash after the GitHub effect, before its commit: step repeats, reusing the resources
key = uuid.uuid4().hex
flag('lab-halt-after-ci')
post(f'/api/projects/{pid}/services', body('after-ci'), t, key)
check('crash after GitHub keeps PENDING_CI', state_of('after-ci') == 'PENDING_CI' and restart(), state_of('after-ci'))
c, r = post(f'/api/projects/{pid}/services', body('after-ci'), t, key)
check('retry repeats the idempotent step and finishes once', c == 201 and len(named('after-ci')) == 1 and state_of('after-ci') == 'DONE', (c, state_of('after-ci')))

# 3. recovery without any client retry
key = uuid.uuid4().hex
flag('lab-halt-before-ci')
post(f'/api/projects/{pid}/services', body('recover'), t, key)
restart()
sql(f"update services set created_at = now() - interval '5 minutes' where name='recover' and project_id='{pid}'")
for _ in range(100):
    if state_of('recover') == 'DONE':
        break
    time.sleep(1)
check('the recovery job finishes an abandoned setup', state_of('recover') == 'DONE', state_of('recover'))
rid = named('recover')[0]['id']
check('recovery started a deployment', len(deps(rid)) >= 1)

# 4. crash between the GitHub commit and the deploy
key = uuid.uuid4().hex
c, r = post(f'/api/projects/{pid}/services', body('between'), t, key)
sid = r['id']
time.sleep(1)
before = len(deps(sid))
sql(f"update services set setup_state='PENDING_DEPLOY' where id='{sid}'")  # the committed state after that crash
c, r = post(f'/api/projects/{pid}/services', body('between'), t, key)
check('retry from PENDING_DEPLOY deploys and ends DONE', c == 201 and state_of('between') == 'DONE' and len(deps(sid)) == before + 1, (c, len(deps(sid))))

# 5. crash after Portainer accepted the stack: name is reused, no second stack
key = uuid.uuid4().hex
dk('exec', mock_c, 'touch', '/tmp/slow-deploy')
docker = {'name': 'crash-stack', 'sourceType': 'DOCKER', 'sourceDetails': {'imageName': 'nginx', 'imageTag': 'alpine', 'containerPort': 80}, 'quota': {'memoryMb': 64, 'cpuMilli': 100, 'storageGb': 0}}
thr = threading.Thread(target=post, args=(f'/api/projects/{pid}/services', docker, t, key))
thr.start()
time.sleep(4)
dk('kill', api_c)
thr.join()
dk('exec', mock_c, 'rm', '-f', '/tmp/slow-deploy')
restart()
c, r = post(f'/api/projects/{pid}/services', docker, t, key)
check('retry after a crash during deploy returns one service', c == 201 and len(named('crash-stack')) == 1, c)
sid = r['id']
post(f'/api/projects/services/{sid}/deploy', {}, t, uuid.uuid4().hex)
time.sleep(4)
owned = [x for x in stacks() if sid[4:] in x['Name']]
check('one stack per service after retries', len(owned) == 1, owned)

# 6. lost response with concurrent retries
key = uuid.uuid4().hex
out = []
bar = threading.Barrier(4)
def go():
    bar.wait()
    out.append(post(f'/api/projects/{pid}/services', body('conc'), t, key))
ths = [threading.Thread(target=go) for _ in range(4)]
n = ci_calls()
[x.start() for x in ths]
[x.join() for x in ths]
check('4 concurrent retries make one service and one GitHub run', len(named('conc')) == 1 and ci_calls() == n + 1 and {o[1]['id'] for o in out} == {named('conc')[0]['id']}, (ci_calls() - n, [o[0] for o in out]))

# 7. GitHub failure is reported, retryable, and removes nothing
key = uuid.uuid4().hex
flag('lab-ci-fail')
c, _ = post(f'/api/projects/{pid}/services', body('gh-fail'), t, key)
check('GitHub failure is an error with a tracked FAILED service', c >= 400 and state_of('gh-fail') == 'FAILED', (c, state_of('gh-fail')))
check('failed setup is not resumed automatically', sql("select count(*) from services where setup_state='FAILED'") == '1')
unflag('lab-ci-fail')
c, r = post(f'/api/projects/{pid}/services', body('gh-fail'), t, key)
check('retry after the failure completes', c == 201 and state_of('gh-fail') == 'DONE', (c, state_of('gh-fail')))

# 8. authorization: another user cannot resume with a stolen key
other = 'x-' + uuid.uuid4().hex[:6] + '@cloudbase.test'
oreg = request('POST', '/api/auth/register', {'name': 'X', 'email': other, 'password': PASSWORD})[1]
ocode = dk('exec', api_c, 'cat', '/tmp/lab-mail/' + other).stdout.strip()
request('POST', '/api/auth/verify-email', {'email': other, 'code': ocode})
request('PATCH', '/api/admin/users/' + oreg['user']['id'] + '/deployment-access', {'enabled': True}, at)
ot = request('POST', '/api/auth/login', {'email': other, 'password': PASSWORD})[1]['token']
check("another user's retry cannot reach the project", post(f'/api/projects/{pid}/services', body('gh-fail'), ot, key)[0] == 403)
print(f'{sum(results)}/{len(results)} setup fault checks passed (simulated GitHub and Portainer)')
sys.exit(0 if all(results) else 1)
