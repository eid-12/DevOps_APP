"""Recovery of GitHub services created before repository authority was recorded (no ciRepoAccessVerified).
Real app + Postgres; GitHub and Portainer simulated (mock with /tmp/github-writable). Run on a fresh lab.

1. Such a service receives no webhook deploys.
2. "Sync CI" (POST /api/projects/services/{id}/github/sync-ci) revalidates push access, restores the flag and CI
   files, and never adds a second webhook (sync twice).
3. A service whose owner lost push access stays unverified after sync: no hook is created, no deploy happens.
4. The next authorized workflow_run deploys exactly once, also when GitHub redelivers it.
"""
import hashlib
import hmac
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from lab import request, state, connect_github, PASSWORD, ADMIN

results = []


def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok or not detail else ' -- ' + str(detail)[:240]), flush=True)


s = state()
env = json.loads(subprocess.check_output(['docker', 'inspect', s['prefix'] + '-api'], text=True))[0]['Config']['Env']
secret = next(e.split('=', 1)[1] for e in env if e.startswith('GITHUB_WEBHOOK_SECRET='))
mock = lambda *c: subprocess.check_output(['docker', 'exec', s['prefix'] + '-mock', *c], text=True)
sql = lambda q: subprocess.check_output(['docker', 'exec', s['prefix'] + '-db', 'psql', '-U', 'cloudbase', '-d', 'cloudbase', '-Atc', q], text=True).strip()
github = lambda: json.loads(mock('node', '-e', "fetch('http://127.0.0.1:9000/_github').then(r=>r.text()).then(console.log)"))
flag = lambda sid: sql(f"select coalesce(source_details->>'ciRepoAccessVerified','absent') from services where id='{sid}'")
mock('touch', '/tmp/github-writable')

at = request('POST', '/api/auth/login', {'email': ADMIN, 'password': PASSWORD})[1]['token']
reg = request('POST', '/api/auth/register', {'name': 'Recovery', 'email': f'recovery-{uuid.uuid4().hex[:6]}@cloudbase.test', 'password': PASSWORD})[1]
request('PATCH', f"/api/admin/users/{reg['user']['id']}/deployment-access", {'enabled': True}, at)
t = reg['token']
connect_github()
pid = request('POST', '/api/projects', {'name': 'recovery'}, t)[1]['id']
deps = lambda sid: request('GET', f'/api/projects/services/{sid}/deployments', token=t)[1] or []


def create(repo):
    code, svc = request('POST', f'/api/projects/{pid}/services', {'name': repo.split('/')[1], 'sourceType': 'GITHUB',
                        'sourceDetails': {'repositoryUrl': 'https://github.com/' + repo, 'branch': 'main', 'runtime': 'node'},
                        'quota': {'memoryMb': 64, 'cpuMilli': 100, 'storageGb': 0}}, t)
    if code != 201:
        raise RuntimeError(f'create {repo}: {code} {svc}')
    for _ in range(60):
        if sql(f"select setup_state from services where id='{svc['id']}'") not in ('PENDING_CI', ''):
            break
        time.sleep(0.5)
    return svc['id']


def hook(repo, sha):
    raw = json.dumps({'action': 'completed', 'repository': {'html_url': 'https://github.com/' + repo, 'full_name': repo},
                      'workflow_run': {'name': 'CloudBase Deploy', 'head_branch': 'main', 'head_sha': sha,
                                       'conclusion': 'success', 'html_url': 'https://github.com/x'}}).encode()
    req = urllib.request.Request(s['api'] + '/api/webhooks/github', data=raw, method='POST', headers={'Content-Type': 'application/json',
                                 'X-GitHub-Event': 'workflow_run', 'X-Hub-Signature-256': 'sha256=' + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()})
    try:
        return urllib.request.urlopen(req, timeout=30).status
    except urllib.error.HTTPError as e:
        return e.code


def deploys_for(sid, sha):
    for _ in range(60):
        d = [x for x in deps(sid) if x.get('commitSha') == sha]
        if not d or all(x['status'] not in ('QUEUED', 'BUILDING', 'DEPLOYING') for x in d):
            return d
        time.sleep(0.5)
    return d


repo = 'local-qa/recover-app'
sid = create(repo)
check('a new service records verified repository access', flag(sid) == 'true', flag(sid))
check('provisioning registered exactly one webhook', len(github().get(repo, {}).get('hooks', [])) == 1, github().get(repo))
# Make the lab deploy path work without GitHub Actions or a registry (same as deploy_verify.py).
sql(f"""update services set custom_domain='app.cloudbase.test', custom_domain_verified_at=now() where id='{sid}'""")

# 1. An installation from before the check: same service, flag absent.
sql(f"update services set source_details = source_details - 'ciRepoAccessVerified' where id='{sid}'")
check('older service starts without the flag', flag(sid) == 'absent')
old_sha = '1' * 40
hook(repo, old_sha)
time.sleep(3)
check('older service receives no webhook deploy', deploys_for(sid, old_sha) == [], deps(sid)[:2])

# 2. Recovery: Sync CI revalidates and restores, twice, without a second hook.
for attempt in (1, 2):
    code, body = request('POST', f'/api/projects/services/{sid}/github/sync-ci', {}, t)
    check(f'sync CI #{attempt} succeeds and restores the verified flag', code == 200 and flag(sid) == 'true', (code, str(body)[:160]))
check('syncing twice keeps exactly one webhook', len(github()[repo]['hooks']) == 1, github()[repo]['hooks'])
check('CI workflow file is present in the repository', '.github/workflows/cloudbase-deploy.yml' in
      ' '.join(github()[repo]['files']), list(github()[repo]['files']))

# 3. Lost access: a service pointing at a repository the owner cannot push to stays unverified.
lost = create('local-qa/lost-app')
sql(f"""update services set source_details = (source_details - 'ciRepoAccessVerified') || '{{"repositoryUrl":"https://github.com/victim-org/payments"}}'::jsonb where id='{lost}'""")
code, body = request('POST', f'/api/projects/services/{lost}/github/sync-ci', {}, t)
check('sync CI on a repository without push access leaves it unverified', flag(lost) == 'false' and 'cannot push' in str(body), (code, flag(lost), str(body)[:160]))
check('no webhook or file was written to that repository', 'victim-org/payments' not in github(), list(github()))
lost_sha = '2' * 40
hook('victim-org/payments', lost_sha)
time.sleep(3)
check('its repository events deploy nothing', deploys_for(lost, lost_sha) == [])

# 4. The next authorized event deploys exactly once, redelivery included.
new_sha = '3' * 40
hook(repo, new_sha)
first = deploys_for(sid, new_sha)
for _ in range(3):
    hook(repo, new_sha)
time.sleep(3)
after = deploys_for(sid, new_sha)
check('the next authorized event deploys exactly once (with redeliveries)',
      len(first) == 1 and len([x for x in after if x['status'] != 'CANCELLED']) == 1 and after[0]['status'] == 'SUCCESS',
      [(x['status'], x.get('errorMessage')) for x in after])
mock('rm', '-f', '/tmp/github-writable')
print(f'{sum(results)}/{len(results)} CI recovery checks passed (simulated GitHub and Portainer)')
sys.exit(0 if all(results) else 1)
