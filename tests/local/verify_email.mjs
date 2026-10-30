// Email-verification recovery, real browser + real API + Postgres (lab.py start --email). Run once per lab.
// The test reads codes from the lab mail stand-in and expires them in the lab database; synthetic accounts only.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const lab = JSON.parse(readFileSync(join(tmpdir(), 'cloudbase-isolated-lab', 'state.json'), 'utf8'));
const WEB = lab.web, PASSWORD = 'Local-Qa-Only!2026';
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok || !d ? '' : ' — ' + d}`); };
const code = e => execFileSync('docker', ['exec', lab.prefix + '-api', 'cat', '/tmp/lab-mail/' + e], { encoding: 'utf8' }).trim();
const sql = q => execFileSync('docker', ['exec', lab.prefix + '-db', 'psql', '-U', 'cloudbase', '-d', 'cloudbase', '-Atc', q], { encoding: 'utf8' }).trim();
const post = async (p, b) => { const r = await fetch(lab.api + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return [r.status, await r.json().catch(() => ({}))]; };
const verified = e => sql(`select email_verified from users where email='${e}'`) === 't';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const fresh = async () => { const c = await browser.newContext(); return c.newPage(); };
const email = p => p.getByRole('textbox', { name: 'Email' });
const signIn = async (p, e) => {
  await p.goto(WEB + '/auth?mode=login');
  await email(p).fill(e);
  await p.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await p.getByRole('button', { name: 'Sign in', exact: true }).click();
};
const signUp = async (p, e) => {
  await p.goto(WEB + '/auth?mode=register');
  await p.getByLabel('Full name').fill('Verify QA');
  await email(p).fill(e);
  await p.locator('#auth-password').fill(PASSWORD);
  await p.locator('#auth-confirm').fill(PASSWORD);
  await p.getByRole('button', { name: 'Create account', exact: true }).last().click();
  await p.locator('#auth-code').waitFor({ timeout: 10000 });
};
const onVerify = p => p.locator('#auth-code').waitFor({ timeout: 8000 }).then(() => true, () => false);
const feedback = p => p.locator('.auth-form .pill').innerText({ timeout: 8000 }).catch(() => '');
const enter = async (p, c) => { await p.locator('#auth-code').fill(c); await p.getByRole('button', { name: 'Verify email' }).click(); };

try {
  const u = await post('/api/auth/register', { name: 'Undeliverable', email: 'undeliverable@cloudbase.test', password: PASSWORD });
  check('failed delivery at signup is a clear 503 and leaves no account', u[0] === 503 && /try again/i.test(u[1].message) && sql(`select count(*) from users where email='undeliverable@cloudbase.test'`) === '0', JSON.stringify(u));
  await signUp(await fresh(), 'welcomefail@cloudbase.test');
  const w = await post('/api/auth/verify-email', { email: 'welcomefail@cloudbase.test', code: code('welcomefail@cloudbase.test') });
  check('a failed welcome email does not undo verification', w[0] === 200 && verified('welcomefail@cloudbase.test'), JSON.stringify(w));
  // 1 + 2: leave after signup, come back in a new browser, sign in
  let e = 'leave@cloudbase.test';
  const a = await fresh();
  await signUp(a, e);
  await a.goto(WEB + '/help');
  await a.context().close();
  const b = await fresh();
  await signIn(b, e);
  check('2. unverified sign-in opens the verification screen', await onVerify(b), await feedback(b));
  check('account email is shown', await email(b).inputValue() === e);
  check('Verify, Resend and return actions exist', await b.getByRole('button', { name: 'Verify email' }).count() === 1
    && await b.getByRole('button', { name: /Resend code/ }).count() === 1 && await b.getByRole('button', { name: /Back to sign in/ }).count() === 1);
  check('no session token before verification', !(await b.evaluate(() => localStorage.getItem('cloudbase.token'))));

  // 4: refresh keeps the screen and the email; closing the tab too
  await b.reload();
  check('4. refresh stays on verification with the email', await onVerify(b) && await email(b).inputValue() === e);
  const reopened = await b.context().newPage();
  await reopened.goto(WEB + '/auth?mode=verify');
  check('reopening restores the pending email', await onVerify(reopened) && await email(reopened).inputValue() === e);

  // 5: wrong code, then correct code; after refresh the password is gone, so sign-in is the next step
  await enter(b, '000000');
  check('5. wrong code gives clear feedback', /incorrect or has expired/i.test(await feedback(b)), await feedback(b));
  await enter(b, code(e));
  await b.waitForURL(/mode=login/, { timeout: 10000 }).catch(() => {});
  check('correct code continues to sign-in with success text', /verified/i.test(await feedback(b)) && await email(b).inputValue() === e, await feedback(b));
  check('account is verified in the database', verified(e));
  await b.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await b.getByRole('button', { name: 'Sign in', exact: true }).click();
  await b.waitForURL(/dashboard/, { timeout: 10000 }).catch(() => {});
  check('sign-in succeeds without another signup', /dashboard/.test(b.url()));

  // 3: expired code -> resend -> verify; password still in memory, so the same flow signs in directly
  e = 'expired@cloudbase.test';
  const c = await fresh();
  await signUp(c, e);
  await c.goto(WEB + '/auth?mode=login');
  const old = code(e);
  sql(`update users set email_verification_expires_at = now() - interval '1 minute' where email='${e}'`);
  await signIn(c, e);
  await onVerify(c);
  await enter(c, old);
  check('3. expired code is refused with clear feedback', /incorrect or has expired/i.test(await feedback(c)) && !verified(e), await feedback(c));
  sql(`update users set email_verification_code = null where email='${e}'`); // resend cooldown from signup still applies
  const cooled = c.getByRole('button', { name: /Resend code/ });
  await cooled.click();
  await c.waitForTimeout(300);
  check('resend cooldown is shown', /wait \d+ seconds/i.test(await feedback(c)) && await cooled.isDisabled(), await feedback(c));
  await c.waitForTimeout(61000);
  await cooled.click();
  await c.waitForFunction(() => /new code/i.test(document.querySelector('.auth-form .pill')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {});
  check('resend reports success', /new code/i.test(await feedback(c)), await feedback(c));
  await enter(c, code(e));
  await c.waitForURL(/dashboard/, { timeout: 10000 }).catch(() => {});
  check('verified after resend and signed in directly', verified(e) && /dashboard/.test(c.url()), c.url());

  // 5: attempt lockout (survives in the database) and resend cap
  // The 5-sends-per-network cap is real and in memory: restart the lab API so this section starts clean.
  execFileSync('docker', ['restart', lab.prefix + '-api']);
  for (let i = 0; i < 90; i++) { if (await fetch(lab.api + '/actuator/health').then(r => r.ok, () => false)) break; await new Promise(r => setTimeout(r, 1000)); }
  e = 'limits@cloudbase.test';
  const d = await fresh();
  await signUp(d, e);
  for (let i = 0; i < 4; i++) await post('/api/auth/verify-email', { email: e, code: '000000' });
  await enter(d, '000000');
  check('fifth wrong code locks attempts', /too many wrong codes/i.test(await feedback(d)), await feedback(d));
  check('the code is destroyed on lockout', sql(`select email_verification_code is null from users where email='${e}'`) === 't');
  const right = code(e);
  check('even the right code is refused while locked', (await post('/api/auth/verify-email', { email: e, code: right }))[0] === 429 && !verified(e));

  // Enumeration: unknown, verified and pending accounts look alike
  const s = [await post('/api/auth/resend-verification', { email: 'nobody@cloudbase.test' }), await post('/api/auth/resend-verification', { email: 'leave@cloudbase.test' })];
  check('resend does not reveal whether an account exists', s[0][0] === 200 && s[1][0] === 200 && s[0][1].message === s[1][1].message, JSON.stringify(s));
  const v = [await post('/api/auth/verify-email', { email: 'nobody2@cloudbase.test', code: '123456' }), await post('/api/auth/verify-email', { email: 'leave@cloudbase.test', code: '123456' })];
  check('verify does not reveal whether an account exists', v[0][0] === 400 && v[1][0] === 400 && v[0][1].message === v[1][1].message, JSON.stringify(v));

  // Delivery failures

  // Pre-verification access stays closed
  const raw = await post('/api/auth/login', { email: 'limits@cloudbase.test', password: PASSWORD });
  check('API issues no token to an unverified account', raw[0] === 403 && !raw[1].token);

  // 6: normal sign-in
  const n = await fresh();
  await signIn(n, 'leave@cloudbase.test');
  await n.waitForURL(/dashboard/, { timeout: 10000 }).catch(() => {});
  check('6. verified account signs in normally', /dashboard/.test(n.url()));
  const logs = execFileSync('docker', ['logs', lab.prefix + '-api'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
  check('API log has no code or password', !logs.includes(right) && !logs.includes(PASSWORD));
} catch (err) {
  check('flow completed', false, err.message.split('\n')[0]);
}
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} verification checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
