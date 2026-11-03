"""Custom-domain ownership on the lab: real API + Postgres, DNS TXT answers from the mock (CLOUDBASE_DOMAINS_DNS_SERVER).

A saved domain is only a claim: not routed, not blocking anyone. It becomes active (and routed by the edge) only when
TXT _cloudbase-challenge.<domain> carries the claim's token. Another tenant's claim or token never activates it, a claim
expires after 72 h, and clearing removes the route. Run on a fresh lab.
"""
import base64
import json
import re
import subprocess
import sys
import time
import uuid
from lab import request, state, PASSWORD, ADMIN

results = []


def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok or not detail else ' -- ' + str(detail)[:240]), flush=True)


s = state()
mock = lambda *c: subprocess.check_output(['docker', 'exec', s['prefix'] + '-mock', *c], text=True)
sql = lambda q: subprocess.check_output(['docker', 'exec', s['prefix'] + '-db', 'psql', '-U', 'cloudbase', '-d', 'cloudbase', '-Atc', q], text=True).strip()
dns = lambda method, name, value='': mock('node', '-e', f"fetch('http://127.0.0.1:9053/_dns/{name}/{value}',{{method:'{method}'}}).then(r=>r.text())")
admin = request('POST', '/api/auth/login', {'email': ADMIN, 'password': PASSWORD})[1]['token']


def routes():
    ops = json.loads(mock('node', '-e', "fetch('http://127.0.0.1:9000/_ops').then(r=>r.text()).then(console.log)"))
    writes = [o for o in ops if o['op'] == 'exec' and 'cb-routes.map' in ' '.join(o['cmd'])]
    if not writes:
        return ''
    return base64.b64decode(re.search(r'printf %s (\S+) \|', writes[-1]['cmd'][-1]).group(1)).decode()


def tenant(tag):
    reg = request('POST', '/api/auth/register', {'name': tag, 'email': f'{tag}-{uuid.uuid4().hex[:6]}@cloudbase.test', 'password': PASSWORD})[1]
    request('PATCH', f"/api/admin/users/{reg['user']['id']}/deployment-access", {'enabled': True}, admin)
    t = reg['token']
    pid = request('POST', '/api/projects', {'name': tag}, t)[1]['id']
    sid = request('POST', f'/api/projects/{pid}/services', {'name': tag + '-web', 'sourceType': 'DOCKER',
                  'sourceDetails': {'imageName': 'nginx', 'imageTag': 'alpine', 'containerPort': 80},
                  'quota': {'memoryMb': 64, 'cpuMilli': 100, 'storageGb': 0}}, t)[1]['id']
    for _ in range(60):
        d = request('GET', f'/api/projects/services/{sid}/deployments', token=t)[1] or []
        if d and d[0]['status'] in ('SUCCESS', 'FAILED'):
            break
        time.sleep(0.5)
    return t, sid


def wait_routes(cond):
    for _ in range(30):
        if cond(routes()):
            return True
        time.sleep(0.5)
    return False


at, a_sid = tenant('owner')
bt, b_sid = tenant('squatter')
domain = f'shop-{uuid.uuid4().hex[:6]}.example.test'
challenge = '_cloudbase-challenge.' + domain

code, a = request('PUT', f'/api/projects/services/{a_sid}/custom-domain', {'domain': domain}, at)
check('saving a domain records a claim with a token, not an active domain',
      code == 200 and a.get('customDomain') in (None, '') and a.get('customDomainPending') == domain and len(a.get('customDomainToken') or '') == 32, (code, a))
time.sleep(2)
check('a claimed domain is not routed', domain not in routes())
code, b = request('PUT', f'/api/projects/services/{b_sid}/custom-domain', {'domain': domain}, bt)
check("another tenant's pending claim does not block a second claim", code == 200 and b.get('customDomainPending') == domain, (code, b))
check('each claim has its own token', b.get('customDomainToken') != a.get('customDomainToken'))

code, r = request('POST', f'/api/projects/services/{a_sid}/custom-domain/verify', {}, at)
check('verify without the TXT record is refused with the exact record to add', code == 400
      and challenge in str(r) and 'cloudbase-verify=' + a['customDomainToken'] in str(r), (code, r))
dns('POST', challenge, 'cloudbase-verify=' + b['customDomainToken'])
code, r = request('POST', f'/api/projects/services/{a_sid}/custom-domain/verify', {}, at)
check("a TXT record carrying another tenant's token does not verify", code == 400, (code, str(r)[:120]))
dns('POST', challenge, 'cloudbase-verify=' + a['customDomainToken'])
code, r = request('POST', f'/api/projects/services/{a_sid}/custom-domain/verify', {}, at)
check('the owner verifies with the correct TXT record and the domain becomes active',
      code == 200 and r.get('customDomain') == domain and not r.get('customDomainPending') and r.get('customDomainVerifiedAt'), (code, r))
check('the verified domain is routed to the owner', wait_routes(lambda t: f'{domain} cb-{a_sid}:' in t), routes()[-300:])

code, r = request('POST', f'/api/projects/services/{b_sid}/custom-domain/verify', {}, bt)
check("the other claim can no longer verify (409), even though its own TXT value is published", code == 409, (code, r))
code, r = request('PUT', f'/api/projects/services/{b_sid}/custom-domain', {'domain': domain}, bt)
check('nor can it claim the active domain again', code == 409, (code, r))
check('the route still points at the owner', f'{domain} cb-{a_sid}:' in routes() and f'cb-{b_sid}:' not in routes().split(domain, 1)[-1].split(';', 1)[0])

other = f'late-{uuid.uuid4().hex[:6]}.example.test'
code, c = request('PUT', f'/api/projects/services/{b_sid}/custom-domain', {'domain': other}, bt)
sql(f"update services set custom_domain_requested_at = now() - interval '73 hours' where id = '{b_sid}'")
dns('POST', '_cloudbase-challenge.' + other, 'cloudbase-verify=' + c['customDomainToken'])
code, r = request('POST', f'/api/projects/services/{b_sid}/custom-domain/verify', {}, bt)
check('a claim older than 72 h cannot be verified (410) and must be requested again', code == 410, (code, r))
code, c2 = request('PUT', f'/api/projects/services/{b_sid}/custom-domain', {'domain': other}, bt)
check('requesting it again issues a fresh token', code == 200 and c2.get('customDomainToken') != c['customDomainToken'], (code, c2))

code, r = request('PUT', f'/api/projects/services/{a_sid}/custom-domain', {'domain': ''}, at)
check('clearing removes the active domain', code == 200 and not r.get('customDomain'), (code, r))
check('and its route', wait_routes(lambda t: domain not in t), routes()[-300:])
print(f'{sum(results)}/{len(results)} custom domain ownership checks passed')
sys.exit(0 if all(results) else 1)
