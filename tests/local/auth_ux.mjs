// Auth form behaviour on an --email lab (best with --nginx), Edge desktop and 390px: a double click sends one
// request, sign-up does not end on a cooldown notice, and a dead reset link leads to requesting a new one with a
// single message. Synthetic accounts only.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const lab = JSON.parse(readFileSync(join(tmpdir(), 'cloudbase-isolated-lab', 'state.json'), 'utf8'));
const WEB = lab.web, PASSWORD = 'Local-Qa-Only!2026';
const sql = q => execFileSync('docker', ['exec', lab.prefix + '-db', 'psql', '-U', 'cloudbase', '-d', 'cloudbase', '-Atc', q], { encoding: 'utf8' }).trim();
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok || !d ? '' : ' -- ' + d}`); };
const browser = await chromium.launch({ channel: 'msedge', headless: true });

for (const [tag, viewport] of [['desk', { width: 1280, height: 800 }], ['mob', { width: 390, height: 844 }]]) {
  const p = await (await browser.newContext({ viewport })).newPage();
  const posts = [];
  p.on('request', r => r.method() === 'POST' && r.url().includes('/api/auth/') && posts.push(r.url().split('/api/auth/')[1]));
  const sent = name => posts.filter(x => x.startsWith(name)).length;
  const toasts = () => p.locator('.p-toast-message').count();

  const email = `ux-${tag}-${Date.now().toString(36)}@cloudbase.test`;
  await p.goto(WEB + '/auth?mode=register');
  await p.getByRole('textbox', { name: 'Full name' }).fill('UX QA');
  await p.getByRole('textbox', { name: 'Email' }).fill(email);
  await p.getByRole('textbox', { name: 'Password', exact: true }).fill(PASSWORD);
  await p.getByRole('textbox', { name: 'Confirm password' }).fill(PASSWORD);
  await p.getByRole('button', { name: 'Create account' }).dblclick();
  await p.locator('#auth-code').waitFor({ timeout: 10000 });
  await p.waitForTimeout(1500);
  const body = await p.locator('body').innerText();
  check(`${tag} double-clicked sign-up sends one request`, sent('register') === 1, sent('register'));
  check(`${tag} sign-up creates one account`, sql(`select count(*) from users where email='${email}'`) === '1');
  check(`${tag} sign-up does not end on a cooldown notice`, !/please wait \d+ seconds/i.test(body), body.match(/.{0,40}please wait.{0,40}/i)?.[0]);

  posts.length = 0;
  await p.goto(WEB + '/auth?mode=login');
  await p.getByRole('textbox', { name: 'Email' }).fill('admin@cloudbase.test');
  await p.getByRole('textbox', { name: 'Password' }).fill('Wrong-Password-1!');
  await p.getByRole('button', { name: 'Sign in', exact: true }).dblclick();
  await p.waitForTimeout(2000);
  check(`${tag} double-clicked sign-in sends one request`, sent('login') === 1, sent('login'));

  posts.length = 0;
  await p.goto(WEB + '/auth?mode=forgot');
  await p.getByRole('textbox', { name: 'Email' }).fill(`nobody-${tag}-${Date.now()}@cloudbase.test`);
  await p.locator('form button[type=submit]').dblclick();
  await p.waitForTimeout(2000);
  check(`${tag} double-clicked reset request sends one request`, sent('forgot') === 1, sent('forgot'));
  check(`${tag} reset request shows no cooldown error`, !/please wait \d+ seconds/i.test(await p.locator('body').innerText()));

  await p.goto(WEB + '/auth?mode=reset&token=not-a-real-token');
  const pw = p.locator('input[type=password]');
  await pw.first().fill('New-Local-Qa!2026');
  await pw.nth(1).fill('New-Local-Qa!2026');
  await p.locator('form button[type=submit]').click();
  await p.waitForTimeout(2000);
  const after = await p.locator('body').innerText();
  check(`${tag} dead reset link moves to requesting a new link`, /mode=forgot/.test(p.url()) && /get a new one/i.test(after), p.url());
  check(`${tag} dead reset link shows one message, not a toast too`, await toasts() === 0, await toasts());
  await p.context().close();
}
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} auth UX checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
