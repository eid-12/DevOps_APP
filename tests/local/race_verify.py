"""Single-use and atomicity of password resets and password changes under concurrency (isolated lab only).

    python tests/local/race_verify.py

The lab has no email, so the reset link is minted exactly as the server would: same claims, signed with the
lab's synthetic JWT_SECRET read from the lab API container, with the algorithm taken from a real token header.
"""
import base64
import hashlib
import hmac
import json
import subprocess
import sys
import threading
import time
import uuid
from lab import request, state, PASSWORD

results = []


def check(name, ok):
    results.append(ok)
    print(('PASS ' if ok else 'FAIL ') + name)


def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def decode(part):
    return json.loads(base64.urlsafe_b64decode(part + '=' * (-len(part) % 4)))


def lab_secret():
    env = json.loads(subprocess.check_output(['docker', 'inspect', state()['prefix'] + '-api'], text=True))[0]['Config']['Env']
    return next(e.split('=', 1)[1] for e in env if e.startswith('JWT_SECRET='))


def mint_reset_link(user_id, session_version, alg):
    digest = {'HS256': hashlib.sha256, 'HS384': hashlib.sha384, 'HS512': hashlib.sha512}[alg]
    now = int(time.time())
    head = b64(json.dumps({'alg': alg}).encode())
    body = b64(json.dumps({'sub': user_id, 'purpose': 'password_reset', 'sv': session_version,
                           'iat': now, 'exp': now + 1800}).encode())
    sig = b64(hmac.new(lab_secret().encode(), f'{head}.{body}'.encode(), digest).digest())
    return f'{head}.{body}.{sig}'


def burst(n, fn):
    codes, barrier = [], threading.Barrier(n)  # results in completion order

    def run(i):
        barrier.wait()
        codes.append(fn(i))
    workers = [threading.Thread(target=run, args=(i,)) for i in range(n)]
    [w.start() for w in workers]
    [w.join() for w in workers]
    return codes


def new_user():
    email = 'race-' + uuid.uuid4().hex[:8] + '@cloudbase.test'
    code, reg = request('POST', '/api/auth/register', {'name': 'Race QA', 'email': email, 'password': PASSWORD})
    assert code == 200, reg
    return email, reg['user']['id'], reg['token']


# 1. one reset link, ten concurrent uses -> exactly one success, and only that password works
email, uid, token = new_user()
alg = decode(token.split('.')[0])['alg']
link = mint_reset_link(uid, decode(token.split('.')[1])['sv'], alg)
outcomes = burst(10, lambda i: (request('POST', '/api/auth/reset-password', {'token': link, 'password': f'Reset-Race!{i:02d}x'})[0], i))
codes = [c for c, _ in outcomes]
check(f'10 concurrent uses of one reset link: exactly one succeeds ({sorted(codes)})', codes.count(200) == 1 and codes.count(400) == 9)
# Sign in only with the winner (probing all ten would trip the login rate limiter).
winner = next((i for c, i in outcomes if c == 200), None)
check('the winning request set the password', winner is not None
      and request('POST', '/api/auth/login', {'email': email, 'password': f'Reset-Race!{winner:02d}x'})[0] == 200)
loser = next(i for c, i in outcomes if c != 200)
check('a losing request did not set its password', request('POST', '/api/auth/login', {'email': email, 'password': f'Reset-Race!{loser:02d}x'})[0] == 401)
check('the link cannot be used again afterwards', request('POST', '/api/auth/reset-password', {'token': link, 'password': 'Reset-Again!9x'})[0] == 400)
check('session from before the reset is revoked', request('GET', '/api/auth/me', token=token)[0] == 401)

# 2. five concurrent password changes from the same session -> exactly one success
email, uid, token = new_user()
outcomes = burst(5, lambda i: (request('POST', '/api/auth/change-password',
                                       {'currentPassword': PASSWORD, 'newPassword': f'Change-Race!{i}x'}, token)[0], i))
codes = [c for c, _ in outcomes]
check(f'5 concurrent password changes: exactly one succeeds ({sorted(codes)})', codes.count(200) == 1)
winner = next((i for c, i in outcomes if c == 200), None)
check('the winning change set the password', winner is not None
      and request('POST', '/api/auth/login', {'email': email, 'password': f'Change-Race!{winner}x'})[0] == 200)

# 3. a reset racing a password change: never both
email, uid, token = new_user()
link = mint_reset_link(uid, decode(token.split('.')[1])['sv'], alg)
codes = sorted(burst(2, lambda i: request('POST', '/api/auth/reset-password', {'token': link, 'password': 'Reset-Mixed!1x'})[0] if i == 0
              else request('POST', '/api/auth/change-password', {'currentPassword': PASSWORD, 'newPassword': 'Change-Mixed!1x'}, token)[0]))
check(f'reset racing a password change: exactly one succeeds ({codes})', codes.count(200) == 1)

print(f'{sum(results)}/{len(results)} race checks passed')
sys.exit(0 if all(results) else 1)
