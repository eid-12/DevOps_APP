// Run once on a fresh --email lab. Real API/DB, synthetic mail; never production.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const lab = JSON.parse(readFileSync(join(tmpdir(), 'cloudbase-isolated-lab', 'state.json'), 'utf8'));
const PASSWORD = 'Local-Qa-Only!2026';
const checks = [];
const check = (name, ok) => { checks.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 10000 }).trim();
const flag = name => docker('exec', lab.prefix + '-api', 'touch', '/tmp/' + name);
const remove = name => docker('exec', lab.prefix + '-api', 'rm', '-f', '/tmp/' + name);
const code = email => docker('exec', lab.prefix + '-api', 'cat', '/tmp/lab-mail/' + email);
const post = async (path, body) => {
  const r = await fetch(lab.api + '/api/auth/' + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000)
  });
  await r.arrayBuffer(); // Do not print bodies, tokens or codes.
  return r.status;
};
const browser = await chromium.launch({ channel: 'msedge', headless: true });
let releaseLogin = () => {};
try {
  const raceEmail = 'race-concurrent@cloudbase.test';
  check('race fixture registered', await post('register', { name: 'Race', email: raceEmail, password: PASSWORD }) === 200);
  const oldCode = code(raceEmail);
  const rollbackEmail = 'delivery-rollback@cloudbase.test';
  check('delivery rollback fixture registered', await post('register', { name: 'Rollback', email: rollbackEmail, password: PASSWORD }) === 200);
  const rollbackCode = code(rollbackEmail);
  const registered = performance.now();

  const page = await browser.newPage();
  const uiEmail = 'delayed-login@cloudbase.test';
  await page.goto(lab.web + '/auth?mode=register');
  await page.getByLabel('Full name').fill('Delayed login');
  await page.getByRole('textbox', { name: 'Email' }).fill(uiEmail);
  await page.locator('#auth-password').fill(PASSWORD);
  await page.locator('#auth-confirm').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click();
  await page.locator('#auth-code').waitFor();
  let loginReached;
  const reached = new Promise(resolve => { loginReached = resolve; });
  const release = new Promise(resolve => { releaseLogin = resolve; });
  await page.route('**/api/auth/login', async route => {
    const response = await route.fetch(); // Real backend authenticates; hold only delivery to browser.
    loginReached(response.status());
    await release;
    await route.fulfill({ response });
  });
  await page.locator('#auth-code').fill(code(uiEmail));
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  const status = await Promise.race([reached, delay(10000).then(() => { throw new Error('login not reached'); })]);
  check('automatic verified login reaches backend successfully', status === 200);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  check('submit stays disabled while automatic login response is pending', await page.locator('button[type=submit]').isDisabled());
  releaseLogin();
  await page.waitForURL(/dashboard/, { timeout: 10000 });
  check('delayed automatic login completes without another submission', /dashboard/.test(page.url()));

  // Real cooldown; no database/limiter bypass and no resend retries.
  await delay(Math.max(0, 61000 - (performance.now() - registered)));
  flag('lab-mail-pause');
  const resend = post('resend-verification', { email: raceEmail });
  const enteredDeadline = performance.now() + 10000;
  let entered = false;
  while (!entered && performance.now() < enteredDeadline) {
    entered = docker('exec', lab.prefix + '-api', 'sh', '-c', 'if test -f /tmp/lab-mail-entered; then echo ready; fi') === 'ready';
    if (!entered) await delay(50);
  }
  if (!entered) throw new Error('resend did not reach controlled provider pause');
  let verificationStatus;
  const verify = post('verify-email', { email: raceEmail, code: oldCode }).then(s => { verificationStatus = s; return s; });
  // Observe either completion or an actual Postgres lock waiter, not a guessed sleep.
  const overlapDeadline = performance.now() + 8000;
  let blocked = false;
  while (verificationStatus === undefined && !blocked && performance.now() < overlapDeadline) {
    blocked = Number(docker('exec', lab.prefix + '-db', 'psql', '-U', 'cloudbase', '-d', 'cloudbase', '-Atc',
      "select count(*) from pg_stat_activity where datname='cloudbase' and wait_event_type='Lock'")) > 0;
    if (!blocked && verificationStatus === undefined) await delay(50);
  }
  check('overlap is observed as completed verification or database serialization', verificationStatus !== undefined || blocked);
  console.log(`OBSERVED verificationBeforeResendCommit=${verificationStatus ?? 'locked'}`);
  remove('lab-mail-pause');
  check('resend completes', await resend === 200);
  const v = await verify;
  check('old code either verified before resend or is rejected after serialization', v === 200 || v === 400);
  if (v === 400) check('replacement code verifies after serialized resend', await post('verify-email', { email: raceEmail, code: code(raceEmail) }) === 200);
  check('successful verification survives concurrent resend and login succeeds', await post('login', { email: raceEmail, password: PASSWORD }) === 200);
  const row = docker('exec', lab.prefix + '-db', 'psql', '-U', 'cloudbase', '-d', 'cloudbase', '-Atc',
    `select email_verified and email_verification_code is null from users where email='${raceEmail}'`);
  check('verified database state has no residual verification code', row === 't');

  flag('lab-mail-fail-next');
  check('failed resend reports delivery failure', await post('resend-verification', { email: rollbackEmail }) === 503);
  const adminResponse = await fetch(lab.api + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@cloudbase.test', password: PASSWORD }), signal: AbortSignal.timeout(10000)
  });
  if (adminResponse.status !== 200) throw new Error('synthetic admin unavailable');
  const adminToken = (await adminResponse.json()).token;
  const rollbackId = docker('exec', lab.prefix + '-db', 'psql', '-U', 'cloudbase', '-d', 'cloudbase', '-Atc',
    `select id from users where email='${rollbackEmail}'`);
  const suspension = await fetch(lab.api + `/api/admin/users/${rollbackId}/account-status`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + adminToken },
    body: JSON.stringify({ accountStatus: 'SUSPENDED' }), signal: AbortSignal.timeout(10000)
  });
  await suspension.arrayBuffer();
  check('synthetic admin suspends the pending account', suspension.status === 200);
  const verifiedTwice = await Promise.all([
    post('verify-email', { email: rollbackEmail, code: rollbackCode }),
    post('verify-email', { email: rollbackEmail, code: rollbackCode })
  ]);
  check('failed resend preserves old code and concurrent verification consumes it only once', verifiedTwice.sort().join(',') === '200,400');
  check('verification cannot bypass administrative suspension', await post('login', { email: rollbackEmail, password: PASSWORD }) === 403);
  const suspended = docker('exec', lab.prefix + '-db', 'psql', '-U', 'cloudbase', '-d', 'cloudbase', '-Atc',
    `select email_verified and account_status='SUSPENDED' and not deployment_enabled from users where email='${rollbackEmail}'`);
  check('verified suspended account stays suspended without deployment access', suspended === 't');
} catch (error) {
  check('scenario completed: ' + error.message.split('\n')[0], false);
} finally {
  releaseLogin();
  remove('lab-mail-pause');
  await browser.close();
}
console.log(`${checks.filter(Boolean).length}/${checks.length} email concurrency checks passed`);
process.exitCode = checks.every(Boolean) ? 0 : 1;
