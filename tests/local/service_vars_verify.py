"""Database connection details, variable references and project shared variables, end to end on the lab:
real API + Postgres, SIMULATED Portainer (mock records the env each stack receives). Run on a fresh lab after
verify_api.py. Checks what reaches the container, not just what the API stores.
"""
import json
import subprocess
import time

from lab import request, state, PASSWORD, ADMIN

results = []


def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  [{detail}]'))


s = state()
mock = lambda *c: subprocess.check_output(['docker', 'exec', s['prefix'] + '-mock', *c], text=True)
stacks = lambda: json.loads(mock('node', '-e', "fetch('http://127.0.0.1:9000/_stacks').then(r=>r.text()).then(console.log)"))
t = request('POST', '/api/auth/login', {'email': ADMIN, 'password': PASSWORD})[1]['token']
pid = request('POST', '/api/projects', {'name': 'vars-e2e'}, t)[1]['id']
quota = {'memoryMb': 128, 'cpuMilli': 100, 'storageGb': 1}


def wait_deployed(sid, dep_id=None, timeout=90):
    """The given deployment (or the latest one) once it has finished."""
    end = time.time() + timeout
    while time.time() < end:
        deps = request('GET', f'/api/projects/services/{sid}/deployments', None, t)[1]
        mine = [d for d in deps if dep_id is None or d['id'] == dep_id]
        if mine and mine[0]['status'] in ('SUCCESS', 'FAILED', 'CANCELLED'):
            return mine[0]
        time.sleep(1)
    return None


def stack_env(container):
    for st in stacks():
        if container in st.get('containers', []):
            return {e['name']: e['value'] for e in st.get('env', [])}
    return {}


def deploy(sid):
    wait_deployed(sid)  # let any automatic first deploy finish, so this one is not joined to it
    code, dep = request('POST', f'/api/projects/services/{sid}/deploy', {}, t)
    return wait_deployed(sid, dep.get('id')) if code == 202 else None


# 1. A database named with a hyphen: the shown schema is the one the container creates.
code, db = request('POST', f'/api/projects/{pid}/services', {'name': 'shop-db', 'sourceType': 'DATABASE',
                                                             'sourceDetails': {'dbType': 'POSTGRESQL'}, 'quota': quota}, t)
check('database service created', code == 201, code)
wait_deployed(db['id'])
conn = request('GET', f"/api/projects/services/{db['id']}/db-connection", None, t)[1]
compose = request('GET', f"/api/projects/services/{db['id']}/deployments", None, t)[1][0].get('composeSnapshot', '')
check('shown schema is what the container creates', conn['database'] == 'shop_db' and 'POSTGRES_DB: shop_db' in compose,
      (conn.get('database'), compose[:200]))
check('generated password is 32 strong characters', len(conn['password']) == 32 and conn['password'].isalnum())
check('standard URL for most apps', conn['url'] == f"postgresql://cbuser:{conn['password']}@shop-db:5432/shop_db", conn['url'])

# 2. Rename: address and reference line stay the same.
request('PUT', f"/api/projects/services/{db['id']}", {'name': 'Shop Database'}, t)
conn2 = request('GET', f"/api/projects/services/{db['id']}/db-connection", None, t)[1]
check('rename keeps the address and the suggested line', conn2['url'] == conn['url'] and conn2['appVariable'] == conn['appVariable'],
      conn2.get('appVariable'))

# 3. App using the suggested line + a project shared variable.
request('PUT', f'/api/projects/{pid}/variables', {'key': 'REGION', 'value': 'eu', 'isSecret': False, 'serviceIds': []}, t)
key, value = conn['appVariable'].split('=', 1)
code, app = request('POST', f'/api/projects/{pid}/services', {
    'name': 'shop-web', 'sourceType': 'DOCKER', 'sourceDetails': {'imageName': 'nginx', 'imageTag': 'alpine'}, 'quota': quota,
    'envVars': [{'key': key, 'value': value, 'isSecret': True}, {'key': 'ZONE', 'value': '${{Project.REGION}}', 'isSecret': False}]}, t)
check('app service created', code == 201, code)
variables = request('GET', f'/api/projects/{pid}/variables', None, t)[1]
region = next(v for v in variables if v['key'] == 'REGION')
request('PUT', f'/api/projects/{pid}/variables', {'id': region['id'], 'key': 'REGION', 'value': 'eu',
                                                   'isSecret': False, 'serviceIds': [app['id']]}, t)
dep = deploy(app['id'])
check('app deploy finished', dep is not None and dep['status'] == 'SUCCESS', dep and dep.get('status'))
env = stack_env(app['containerName'])
check('the container receives a working DATABASE_URL with the real password', env.get('DATABASE_URL') == conn['url'],
      env.get('DATABASE_URL'))
check('${{Project.KEY}} resolves', env.get('ZONE') == 'eu', env.get('ZONE'))
check('shared variable reaches the container', env.get('REGION') == 'eu', env.get('REGION'))

# 4. Shared variable deleted: gone from the container after the next deploy, own variables untouched.
request('DELETE', f"/api/projects/{pid}/variables/{region['id']}", None, t)
deploy(app['id'])
env = stack_env(app['containerName'])
check('a deleted shared variable no longer reaches the container', 'REGION' not in env, sorted(env))
check("the service's own variables are kept", env.get('DATABASE_URL') == conn['url'], sorted(env))
svc = request('GET', f"/api/projects/services/{app['id']}", None, t)[1]
check('nothing stale left in the stored service variables', 'REGION' not in (svc.get('envVars') or {}), svc.get('envVars'))

# 5. Another tenant cannot read this database's connection details.
other = request('POST', '/api/auth/login', {'email': 'browser@cloudbase.test', 'password': PASSWORD})[1].get('token')
if other:
    code, _ = request('GET', f"/api/projects/services/{db['id']}/db-connection", None, other)
    check("another tenant cannot read the database's credentials", code in (403, 404), code)

print(f'{sum(results)}/{len(results)} service variable checks passed')
raise SystemExit(0 if results and all(results) else 1)
