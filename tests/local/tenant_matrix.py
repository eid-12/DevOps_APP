"""Cross-tenant matrix on the lab: every project/service/deployment/notification endpoint called by another
deployment-enabled tenant with the victim's ids, including mixed ids (own service + victim deployment).
Each refused call must leave the victim's data unchanged. Simulated infrastructure; run on a fresh lab.
"""
import json
import subprocess
import sys
import time
import uuid
from lab import request, state, PASSWORD, ADMIN

results = []


def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok or not detail else ' -- ' + str(detail)[:240]))


s = state()
sql = lambda q: subprocess.check_output(['docker', 'exec', s['prefix'] + '-db', 'psql', '-U', 'cloudbase', '-d', 'cloudbase',
                                         '-Atc', q], text=True).strip()
admin = request('POST', '/api/auth/login', {'email': ADMIN, 'password': PASSWORD})[1]['token']


def tenant(tag):
    reg = request('POST', '/api/auth/register', {'name': tag, 'email': f'{tag}-{uuid.uuid4().hex[:6]}@cloudbase.test',
                                                 'password': PASSWORD})[1]
    request('PATCH', f"/api/admin/users/{reg['user']['id']}/deployment-access", {'enabled': True}, admin)
    return reg['user']['id'], reg['token']


def settle(sid, token):
    for _ in range(80):
        d = request('GET', f'/api/projects/services/{sid}/deployments', token=token)[1] or []
        if d and not any(x['status'] in ('QUEUED', 'BUILDING', 'DEPLOYING') for x in d):
            return d
        time.sleep(0.5)
    return d


def workload(token, name):
    pid = request('POST', '/api/projects', {'name': name}, token)[1]['id']
    svc = request('POST', f'/api/projects/{pid}/services', {'name': name + '-web', 'sourceType': 'DOCKER',
                  'sourceDetails': {'imageName': 'nginx', 'imageTag': 'alpine', 'containerPort': 80},
                  'quota': {'memoryMb': 64, 'cpuMilli': 100, 'storageGb': 0}}, token)[1]
    deps = settle(svc['id'], token)
    return pid, svc['id'], deps[0]['id']


a_id, at = tenant('victim')
b_id, bt = tenant('attacker')
a_pid, a_sid, a_dep = workload(at, 'victim')
b_pid, b_sid, b_dep = workload(bt, 'attacker')
request('PUT', f'/api/projects/services/{a_sid}/env', {'envVars': [{'key': 'VICTIM_SECRET', 'value': 'synthetic-v', 'isSecret': True}]}, at)
var = request('PUT', f'/api/projects/{a_pid}/variables', {'key': 'VICTIM_SHARED', 'value': 'synthetic-s', 'isSecret': True,
                                                         'serviceIds': [a_sid]}, at)[1]
# A second, deployable victim deployment to aim rollback/cancel at.
request('POST', f'/api/projects/services/{a_sid}/deploy', {'imageTag': '1.27-alpine'}, at)
settle(a_sid, at)
nid = str(uuid.uuid4())
sql(f"insert into notifications (id, user_id, title, body, is_read, created_at) values ('{nid}', '{a_id}', 'synthetic', 'victim note', false, now())")


def snapshot():
    return json.dumps([
        request('GET', f'/api/projects/{a_pid}', token=at)[1].get('name'),
        request('GET', f'/api/projects/services/{a_sid}', token=at)[1],
        request('GET', f'/api/projects/{a_pid}/variables', token=at)[1],
        [(d['id'], d['status']) for d in request('GET', f'/api/projects/services/{a_sid}/deployments', token=at)[1]],
        sql(f"select is_read from notifications where id='{nid}'"),
    ], sort_keys=True, default=str)


before = snapshot()
victim = 'VICTIM'
calls = [
    ('GET', f'/api/projects/{a_pid}', None),
    ('PUT', f'/api/projects/{a_pid}', {'name': 'x'}),
    ('POST', f'/api/projects/{a_pid}/services', {'name': 'implant', 'sourceType': 'DOCKER',
     'sourceDetails': {'imageName': 'nginx', 'imageTag': 'alpine'}, 'quota': {'memoryMb': 64, 'cpuMilli': 100, 'storageGb': 0}}),
    ('GET', f'/api/projects/{a_pid}/variables', None),
    ('PUT', f'/api/projects/{a_pid}/variables', {'key': 'X', 'value': 'y', 'serviceIds': [a_sid]}),
    ('DELETE', f"/api/projects/{a_pid}/variables/{var['id']}", None),
    ('GET', f'/api/projects/services/{a_sid}/logs', None),
    ('GET', f'/api/projects/services/{a_sid}/metrics', None),
    ('GET', f'/api/projects/services/{a_sid}/deployments', None),
    ('GET', f'/api/projects/services/{a_sid}/custom-domain/check?domain=a.example.test', None),
    ('GET', f'/api/projects/services/{a_sid}/vanity-subdomain/check?name=victimapp', None),
    ('PUT', f'/api/projects/services/{a_sid}/env', {'envVars': []}),
    ('PUT', f'/api/projects/services/{a_sid}/subdomain', {'subdomain': 'stolen'}),
    ('PUT', f'/api/projects/services/{a_sid}/vanity-subdomain', {'name': 'stolen'}),
    ('DELETE', f'/api/projects/services/{a_sid}/vanity-subdomain', None),
    ('PUT', f'/api/projects/services/{a_sid}/custom-domain', {'domain': 'stolen.example.test'}),
    ('DELETE', f'/api/projects/services/{a_sid}/custom-domain', None),
    ('POST', f'/api/projects/services/{a_sid}/custom-domain/verify', {}),
    ('POST', f'/api/projects/services/{a_sid}/github/sync-ci', {}),
    ('POST', f'/api/projects/services/{a_sid}/deploy', {'imageTag': 'alpine'}),
    ('POST', f'/api/projects/services/{a_sid}/deployments/{a_dep}/rollback', {}),
    ('POST', f'/api/projects/services/{a_sid}/deployments/{a_dep}/cancel', {}),
    ('POST', f'/api/projects/services/{a_sid}/restart', {}),
    ('POST', f'/api/projects/services/{a_sid}/stop', {}),
    ('DELETE', f'/api/projects/services/{a_sid}', None),
    ('DELETE', f'/api/projects/{a_pid}', None),
    # Mixed ids: the attacker's own service with the victim's deployment.
    ('POST', f'/api/projects/services/{b_sid}/deployments/{a_dep}/rollback', {}),
    ('POST', f'/api/projects/services/{b_sid}/deployments/{a_dep}/cancel', {}),
    ('POST', f'/api/notifications/{nid}/read', {}),
]
for method, path, body in calls:
    code, resp = request(method, path, body, bt)
    leaked = any(x in json.dumps(resp, default=str) for x in ('synthetic-v', 'synthetic-s', 'victim note', victim + '_'))
    check(f'{method} {path.replace(a_pid, "<A-project>").replace(a_sid, "<A-service>").replace(b_sid, "<B-service>").replace(a_dep, "<A-deploy>")} refused',
          code in (400, 403, 404) and not leaked, (code, str(resp)[:160]))
request('POST', '/api/notifications/read-all', {}, bt)
check('read-all by the attacker leaves the victim notification unread', sql(f"select is_read from notifications where id='{nid}'") == 'f')
check('attacker notification list holds none of the victim notes',
      'victim note' not in json.dumps(request('GET', '/api/notifications', token=bt)[1]))
check('attacker project list holds only its own project',
      [p['id'] for p in request('GET', '/api/projects', token=bt)[1]] == [b_pid])
check('victim project, service, env, variables, deployments and notification are unchanged', snapshot() == before)
# Revoked deployment access applies at once to the tenant's own resources, on the session it already holds.
request('PATCH', f'/api/admin/users/{b_id}/deployment-access', {'enabled': False}, admin)
for method, path, body in [('POST', f'/api/projects/services/{b_sid}/deploy', {'imageTag': 'alpine'}),
                           ('POST', f'/api/projects/services/{b_sid}/restart', {}),
                           ('POST', f'/api/projects/services/{b_sid}/exec', {'command': 'id'}),
                           ('PUT', f'/api/projects/services/{b_sid}/env', {'envVars': []}),
                           ('POST', f'/api/projects/{b_pid}/services', {'name': 'more', 'sourceType': 'DOCKER',
                            'sourceDetails': {'imageName': 'nginx', 'imageTag': 'alpine'},
                            'quota': {'memoryMb': 64, 'cpuMilli': 100, 'storageGb': 0}})]:
    code = request(method, path, body, bt)[0]
    check(f'after revocation {method} {path.replace(b_sid, "<own-service>").replace(b_pid, "<own-project>")} is 403', code == 403, code)
print(f'{sum(results)}/{len(results)} tenant isolation checks passed')
sys.exit(0 if all(results) else 1)
