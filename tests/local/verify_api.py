"""Real HTTP + PostgreSQL integration checks. Infrastructure is the local mock, never production."""
import json
import sys
import time
from lab import request, state, save, PASSWORD, ADMIN, STATE_DIR

checks = []


def check(name, condition):
    checks.append({'check': name, 'passed': bool(condition)})
    print(('PASS ' if condition else 'FAIL ') + name)


def call(method, path, data=None, token=None, expected=200):
    code, body = request(method, path, data, token)
    check(method + ' ' + path + ' status ' + str(expected), code == expected)
    if code != expected:
        raise AssertionError(f'{method} {path}: expected {expected}, got {code}; {body}')
    return body


admin = call('POST', '/api/auth/login', {'email': ADMIN, 'password': PASSWORD})
at = admin['token']
call('GET', '/api/auth/me', expected=401)
call('GET', '/api/admin/users', expected=401)
health = call('GET', '/actuator/health')
check('anonymous health hides component details', set(health) == {'status'})
users = {}
for role in ['owner', 'other', 'browser']:
    email = role + '@cloudbase.test'
    registered = call('POST', '/api/auth/register', {'name': role.title() + ' QA', 'email': email,
                      'password': PASSWORD}, expected=200)
    check('registration defaults to non-admin with deploy disabled',
          registered['user']['role'] == 'USER' and not registered['user']['deploymentEnabled'])
    users[role] = registered
    call('POST', '/api/projects', {'name': 'blocked'}, registered['token'], expected=403)
    call('PATCH', '/api/admin/users/' + registered['user']['id'] + '/deployment-access', {'enabled': True}, at)
ot, bt = users['owner']['token'], users['other']['token']
admin_health = call('GET', '/actuator/health', token=at)
check('admin health includes component details', 'components' in admin_health and 'db' in admin_health['components'])
check('non-admin health hides component details', set(call('GET', '/actuator/health', token=ot)) == {'status'})
call('GET', '/api/admin/users', token=ot, expected=403)
call('PUT', '/api/admin/hosting-settings', {}, ot, expected=403)
call('PATCH', '/api/admin/users/' + users['owner']['user']['id'] + '/role', {'role': 'ADMIN'}, ot, expected=403)
all_users = call('GET', '/api/admin/users', token=at)
check('user responses never serialize hashes, codes or OAuth access tokens',
      not any(k in json.dumps(all_users) for k in ['passwordHash', 'githubAccessToken', 'emailVerificationCode']))
project = call('POST', '/api/projects', {'name': 'Local integration', 'description': 'synthetic data'}, ot, 201)
pid = project['id']
call('GET', '/api/projects/' + pid, token=bt, expected=403)
call('PUT', '/api/projects/' + pid, {'name': 'stolen'}, bt, 403)
call('DELETE', '/api/projects/' + pid, token=bt, expected=403)
check('other tenant project list excludes owner project',
      all(p['id'] != pid for p in call('GET', '/api/projects', token=bt)))
call('PUT', '/api/projects/' + pid, {'description': 'updated via real API'}, ot)
check('project update persisted', call('GET', '/api/projects/' + pid, token=ot)['description'] == 'updated via real API')
svc = call('POST', '/api/projects/' + pid + '/services', {
    'name': 'local-web', 'sourceType': 'GITHUB',
    'sourceDetails': {'repositoryUrl': 'https://github.com/local-qa/synthetic-app', 'branch': 'main', 'runtime': 'node'},
    'quota': {'memoryMb': 128, 'cpuMilli': 100, 'storageGb': 0}}, ot, 201)
sid = svc['id']
code, _ = request('POST', '/api/projects/' + pid + '/services', {'name': 'forged-image', 'sourceType': 'GITHUB',
    'sourceDetails': {'repositoryUrl': 'https://github.com/local-qa/synthetic-app', 'branch': 'main', 'runtime': 'node',
                      'imageName': 'ghcr.io/victim/private'}, 'quota': {'memoryMb': 128, 'cpuMilli': 100, 'storageGb': 0}}, ot)
check('GitHub service cannot be created with a caller-chosen image', code == 400)
for field in ['imageName', 'ciBootstrapped', 'ciWorkflowCreated', 'ciWebhookRegistered', 'ciMessage']:
    code, _ = request('PUT', '/api/projects/services/' + sid, {'sourceDetails': {field: True if field.startswith('ci') and field != 'ciMessage' else 'x'}}, ot)
    check('GitHub field ' + field + ' is rejected on update', code == 400)
docker_svc = call('POST', '/api/projects/' + pid + '/services', {'name': 'local-docker', 'sourceType': 'DOCKER',
    'sourceDetails': {'imageName': 'nginx', 'imageTag': 'alpine', 'containerPort': 80},
    'quota': {'memoryMb': 64, 'cpuMilli': 100, 'storageGb': 0}}, ot, 201)
call('PUT', '/api/projects/services/' + docker_svc['id'], {'sourceDetails': {'imageName': 'nginxdemos/hello', 'imageTag': 'latest'}}, ot)
check('Docker services may still change their own image',
      call('GET', '/api/projects/services/' + docker_svc['id'], token=ot)['sourceDetails']['imageName'] == 'nginxdemos/hello')
for suffix in ['', '/logs', '/metrics', '/db-connection', '/deployments', '/vanity-subdomain']:
    call('GET', '/api/projects/services/' + sid + suffix, token=bt, expected=403)
call('PUT', '/api/projects/services/' + sid, {'name': 'stolen'}, bt, 403)
call('POST', '/api/projects/services/' + sid + '/exec', {'command': 'id'}, bt, 403)
call('PUT', '/api/projects/services/' + sid + '/env', {'envVars': [{'key': 'QA_VALUE', 'value': 'synthetic', 'isSecret': True}]}, ot)
check('service environment persisted', call('GET', '/api/projects/services/' + sid, token=ot)['envVars']['QA_VALUE']['value'] == 'synthetic')
call('PUT', '/api/projects/services/' + sid + '/env', {'envVars': [{'key': 'BAD\nKEY', 'value': 'x'}]}, ot, 400)
call('PUT', '/api/projects/services/' + sid, {'quota': {'memoryMb': 0, 'cpuMilli': 100, 'storageGb': 0}}, ot, 400)
code, _ = request('PUT', '/api/projects/services/' + sid, {'sourceDetails': {'imageName': 'ghcr.io/other/private', 'ciBootstrapped': True}}, ot)
check('GitHub image and CI status cannot be overwritten by request fields', code == 400)
call('PUT', '/api/projects/services/' + sid, {'sourceDetails': {'branch': 'qa'},
     'quota': {'memoryMb': 160, 'cpuMilli': 120, 'storageGb': 0}}, ot)
updated = call('GET', '/api/projects/services/' + sid, token=ot)
check('GitHub source and quota update both persist', updated['sourceDetails']['branch'] == 'qa' and updated['quotaMemoryMb'] == 160)
var = call('PUT', '/api/projects/' + pid + '/variables', {'key': 'SHARED_QA', 'value': 'synthetic', 'isSecret': True, 'serviceIds': [sid]}, ot)
call('GET', '/api/projects/' + pid + '/variables', token=bt, expected=403)
check('shared variable persisted', any(v['id'] == var['id'] for v in call('GET', '/api/projects/' + pid + '/variables', token=ot)))
call('PUT', '/api/auth/profile', {'name': 'Owner QA Updated'}, ot)
check('profile update persisted', call('GET', '/api/auth/me', token=ot)['name'] == 'Owner QA Updated')
call('PUT', '/api/auth/notifications', {'emailDeployments': False, 'emailFailures': True, 'emailWeeklyUsage': False}, ot)
call('POST', '/api/auth/change-password', {'currentPassword': 'wrong', 'newPassword': 'Changed-Qa!2026'}, ot, 400)
call('POST', '/api/auth/change-password', {'currentPassword': PASSWORD, 'newPassword': 'Changed-Qa!2026'}, ot)
call('POST', '/api/auth/login', {'email': 'owner@cloudbase.test', 'password': PASSWORD}, expected=401)
call('POST', '/api/auth/login', {'email': 'owner@cloudbase.test', 'password': 'Changed-Qa!2026'})
uid = users['other']['user']['id']
call('PATCH', '/api/admin/users/' + uid + '/account-status', {'accountStatus': 'PENDING_ACTIVATION'}, at)
check('deactivated account session rejected', request('GET', '/api/auth/me', token=bt)[0] == 401)
check('deactivated account cannot obtain fresh session', request('POST', '/api/auth/login', {'email': 'other@cloudbase.test', 'password': PASSWORD})[0] == 403)
call('PATCH', '/api/admin/users/' + uid + '/account-status', {'accountStatus': 'ACTIVE'}, at)
call('PATCH', '/api/admin/users/' + uid + '/account-status', {'accountStatus': 'SUSPENDED'}, at)
call('GET', '/api/auth/me', token=bt, expected=401)
check('suspended account cannot sign in', request('POST', '/api/auth/login', {'email': 'other@cloudbase.test', 'password': PASSWORD})[0] == 403)
check('suspended account is refused on project APIs too', request('GET', '/api/projects', token=bt)[0] == 401)
call('POST', '/api/auth/forgot-password', {'email': 'owner@cloudbase.test'}, expected=503)
call('GET', '/api/auth/github/authorize', token=ot, expected=503)
call('POST', '/api/auth/github/exchange', {'code': 'synthetic-never-valid'}, ot, 503)
call('GET', '/api/projects/proj-missing', token=ot, expected=404)
s = state()
s['fixtures'] = {'projectId': pid, 'serviceId': sid, 'adminEmail': ADMIN, 'browserEmail': 'browser@cloudbase.test', 'password': PASSWORD}
save(s)
(STATE_DIR / 'api-results.json').write_text(json.dumps(checks, indent=2))
print(f'{sum(c["passed"] for c in checks)}/{len(checks)} API checks passed')
sys.exit(0 if all(c['passed'] for c in checks) else 1)
