"""Controlled integration: real application logic and Postgres, SIMULATED Portainer (mock-infrastructure.cjs).
This is not production evidence. Run on a fresh lab after: python tests/local/lab.py start --jar ... --frontend ...
"""
import hashlib
import hmac
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


def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok or not detail else ' -- ' + str(detail)))


def post(path, data, token, key=None):
    headers = {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token}
    if key:
        headers['Idempotency-Key'] = key
    req = urllib.request.Request(state()['api'] + path, method='POST', headers=headers, data=json.dumps(data).encode())
    try:
        r = urllib.request.urlopen(req, timeout=40)
    except urllib.error.HTTPError as e:
        r = e
    raw = r.read()
    return r.status, json.loads(raw) if raw else None


s = state()
env = json.loads(subprocess.check_output(['docker', 'inspect', s['prefix'] + '-api'], text=True))[0]['Config']['Env']
secret = next(e.split('=', 1)[1] for e in env if e.startswith('GITHUB_WEBHOOK_SECRET='))
mock = lambda *c: subprocess.check_output(['docker', 'exec', s['prefix'] + '-mock', *c], text=True)
sql = lambda q: subprocess.check_output(['docker', 'exec', s['prefix'] + '-db', 'psql', '-U', 'cloudbase', '-d', 'cloudbase', '-Atc', q], text=True).strip()
stacks = lambda: json.loads(mock('node', '-e', "fetch('http://127.0.0.1:9000/_stacks').then(r=>r.text()).then(console.log)"))

at = request('POST', '/api/auth/login', {'email': ADMIN, 'password': PASSWORD})[1]['token']
email = 'deploy-' + uuid.uuid4().hex[:6] + '@cloudbase.test'
reg = request('POST', '/api/auth/register', {'name': 'Deploy QA', 'email': email, 'password': PASSWORD})[1]
request('PATCH', '/api/admin/users/' + reg['user']['id'] + '/deployment-access', {'enabled': True}, at)
t = reg['token']
deps = lambda sid: request('GET', f'/api/projects/services/{sid}/deployments', token=t)[1]


def settle(sid):
    for _ in range(80):
        d = deps(sid)
        if d and not any(x['status'] in ('QUEUED', 'BUILDING', 'DEPLOYING') for x in d):
            return d
        time.sleep(0.5)
    return deps(sid)


# Idempotent create
key = str(uuid.uuid4())
a = post('/api/projects', {'name': 'same-name'}, t, key)
b = post('/api/projects', {'name': 'same-name'}, t, key)
check('retry with the same key returns the same project', a[0] == 201 and b[1]['id'] == a[1]['id'], (a[0], b[0]))
other = post('/api/projects', {'name': 'same-name'}, t, str(uuid.uuid4()))
check('a different key may reuse a name (names stay non-unique)', other[0] == 201 and other[1]['id'] != a[1]['id'])
check('a key reused for different input is refused', post('/api/projects', {'name': 'other'}, t, key)[0] == 409)
pid = a[1]['id']
codes, keyc = [], str(uuid.uuid4())
body = {'name': 'web', 'sourceType': 'DOCKER', 'sourceDetails': {'imageName': 'nginx', 'imageTag': 'alpine', 'containerPort': 80},
        'quota': {'memoryMb': 64, 'cpuMilli': 100, 'storageGb': 0}}
barrier = threading.Barrier(4)


def create():
    barrier.wait()
    codes.append(post(f'/api/projects/{pid}/services', body, t, keyc))


workers = [threading.Thread(target=create) for _ in range(4)]
[w.start() for w in workers]
[w.join() for w in workers]
ids = {c[1].get('id') for c in codes}
check('4 concurrent creates with one key make one service', len(ids) == 1 and len(request('GET', f'/api/projects/{pid}', token=t)[1]['services']) == 1, [c[0] for c in codes])
sid = ids.pop()

# Real deploy logic to success on simulated infrastructure
d = settle(sid)
check('deployment reaches SUCCESS through the real logic', d[0]['status'] == 'SUCCESS', d[0].get('errorMessage'))
check('service is RUNNING', request('GET', '/api/projects/services/' + sid, token=t)[1]['status'] == 'RUNNING')
check('one simulated stack exists', len(stacks()) == 1, stacks())

# Network isolation: tenant apps share an ingress network with the proxy only, never the platform network
nets = lambda: json.loads(mock('node', '-e', "fetch('http://127.0.0.1:9000/_networks').then(r=>r.text()).then(console.log)"))
check('ingress network was created with the proxy on it', 'nginx-proxy' in nets().get('cloudbase-tenants', []), nets())
snapshot = sql(f"select compose_snapshot from deployments where service_id='{sid}' and status='SUCCESS' limit 1")
check('app stack joins the tenant ingress network, not the platform network',
      '- cloudbase-tenants' in snapshot and '- cloudbase\n' not in snapshot + '\n' and 'no-new-privileges:true' in snapshot, snapshot[-300:])
dbs = post(f'/api/projects/{pid}/services', {'name': 'store', 'sourceType': 'DATABASE', 'sourceDetails': {'dbType': 'POSTGRESQL'},
           'quota': {'memoryMb': 128, 'cpuMilli': 100, 'storageGb': 1}}, t, str(uuid.uuid4()))
if dbs[0] == 201:
    dd = settle(dbs[1]['id'])
    dsnap = sql(f"select compose_snapshot from deployments where service_id='{dbs[1]['id']}' order by started_at desc limit 1")
    check('database stack stays on its project network only', dd[0]['status'] == 'SUCCESS' and 'external' not in dsnap
          and 'cloudbase-tenants' not in dsnap, (dd[0]['status'], dsnap[-300:]))
else:
    check('database service created', False, dbs)

# Deploy joining
mock('touch', '/tmp/slow-deploy')
x = post(f'/api/projects/services/{sid}/deploy', {'imageTag': 'alpine'}, t)
y = post(f'/api/projects/services/{sid}/deploy', {'imageTag': 'alpine'}, t)
check('same input joins the running deploy', x[1]['id'] == y[1]['id'], (x[1]['id'], y[1]['id']))
time.sleep(16)
z = post(f'/api/projects/services/{sid}/deploy', {'imageTag': 'alpine'}, t) if any(q['status'] in ('QUEUED', 'BUILDING', 'DEPLOYING') for q in deps(sid)) else None
check('a retry after 15 s does not start a second attempt while running', z is None or z[1]['id'] == x[1]['id'])
q = post(f'/api/projects/services/{sid}/deploy', {'imageTag': '1.27-alpine'}, t)
check('a different tag is a new deployment, not merged', q[1]['id'] != x[1]['id'] and q[1]['imageTag'] == '1.27-alpine')
mock('rm', '-f', '/tmp/slow-deploy')
settle(sid)

# Webhook: progress row, then completed, then redelivery; one real deploy per commit
gh = post(f'/api/projects/{pid}/services', {'name': 'gh', 'sourceType': 'GITHUB',
          'sourceDetails': {'repositoryUrl': 'https://github.com/local-qa/deploy-app', 'branch': 'main', 'runtime': 'node'},
          'quota': {'memoryMb': 64, 'cpuMilli': 100, 'storageGb': 0}}, t, str(uuid.uuid4()))
print('github service', gh[0], str(gh[1])[:140])
if gh[0] == 201:
    gid = gh[1]['id']
    settle(gid)
    # No GitHub in the lab: give the service an existing image so the real webhook path can deploy it.
    sql(f"""update services set source_details = source_details || '{{"ciWorkflowCreated":true,"ciBootstrapped":true}}'::jsonb where id='{gid}'""")
    sql(f"""update services set custom_domain='app.cloudbase.test' where id='{gid}'""")
    sql(f"""update users set github_username='local-qa', github_access_token='synthetic-token', github_scopes='repo read:packages' where id='{reg['user']['id']}'""")

    def hook(action, sha, conclusion):
        raw = json.dumps({'action': action, 'repository': {'html_url': 'https://github.com/local-qa/deploy-app', 'full_name': 'local-qa/deploy-app'},
                          'workflow_run': {'name': 'CloudBase Deploy', 'head_branch': 'main', 'head_sha': sha, 'conclusion': conclusion, 'html_url': 'https://github.com/x'}}).encode()
        req = urllib.request.Request(s['api'] + '/api/webhooks/github', data=raw, method='POST', headers={'Content-Type': 'application/json',
                                     'X-GitHub-Event': 'workflow_run', 'X-Hub-Signature-256': 'sha256=' + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()})
        try:
            return urllib.request.urlopen(req, timeout=30).status
        except urllib.error.HTTPError as e:
            return e.code
    sha = 'a' * 40
    print('hooks', hook('requested', sha, None), hook('in_progress', sha, None))
    print('completed', hook('completed', sha, 'success'))
    settle(gid)
    real = [x for x in deps(gid) if x.get('commitSha') == sha and x.get('imageTag')]
    check('progress row does not swallow the real deploy, which succeeds', len(real) == 1 and real[0]['status'] == 'SUCCESS', [(x['status'], x.get('errorMessage')) for x in deps(gid)][:3])
    last = real[0]['status'] if real else None
    hook('completed', sha, 'success')
    if last == 'SUCCESS':
        threads = [threading.Thread(target=hook, args=('completed', sha, 'success')) for _ in range(4)]
        [w.start() for w in threads]
        [w.join() for w in threads]
    settle(gid)
    real = [x for x in deps(gid) if x.get('commitSha') == sha and x.get('imageTag') and x['status'] != 'CANCELLED']
    print('deployment for commit', [x['status'] for x in real])
    check('redelivered and concurrent webhooks after success do not redeploy', len(real) == 1, real)
    subprocess.check_call(['docker', 'restart', s['prefix'] + '-api'], stdout=subprocess.DEVNULL)
    for _ in range(90):
        try:
            if request('GET', '/actuator/health')[0] == 200:
                break
        except OSError:
            pass
        time.sleep(1)
    hook('completed', sha, 'success')
    settle(gid)
    real = [x for x in deps(gid) if x.get('commitSha') == sha and x.get('imageTag') and x['status'] != 'CANCELLED']
    check('dedupe survives an application restart', len(real) == 1, real)

# A platform container on the ingress network must stop deploys rather than expose it to tenants
before = len(stacks())
mock('node', '-e', "fetch('http://127.0.0.1:9000/_networks/cloudbase-tenants/cloudbase-postgres',{method:'POST'}).then(r=>r.text())")
bad = post(f'/api/projects/services/{sid}/deploy', {'imageTag': 'stable-alpine'}, t)
fd = settle(sid)
blocked = next((x for x in fd if x['id'] == (bad[1] or {}).get('id')), {})
check('deploy refuses an ingress network holding a platform container', blocked.get('status') == 'FAILED'
      and 'cloudbase-postgres' in (blocked.get('errorMessage') or ''),
      (bad[0], blocked.get('status'), blocked.get('stage'), blocked.get('errorMessage'), (blocked.get('logs') or '')[-400:]))
check('no stack was created for the refused deploy', len(stacks()) == before, (before, len(stacks())))

# Deletion with a partial external failure
mock('touch', '/tmp/fail-delete')
code = request('DELETE', '/api/projects/' + pid, token=t)[0]
check('failed teardown reports an error and keeps the project', code >= 400 and request('GET', '/api/projects/' + pid, token=t)[0] == 200, code)
check('service is still listed after failed delete', len(request('GET', f'/api/projects/{pid}', token=t)[1]['services']) >= 1)
mock('rm', '-f', '/tmp/fail-delete')
code = request('DELETE', '/api/projects/' + pid, token=t)[0]
check('retrying the delete succeeds', code == 204 and request('GET', '/api/projects/' + pid, token=t)[0] == 404, code)
check('no simulated stack of this project remains', len(stacks()) == 0, stacks())
print(f'{sum(results)}/{len(results)} deployment checks passed (simulated infrastructure)')
sys.exit(0 if all(results) else 1)
