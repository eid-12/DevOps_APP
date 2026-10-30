// Page walkthrough on the lab: real API and Postgres, Edge, desktop and 390px. Run after verify_api.py.
// Covers empty, permission, API-down and session-expired states, and measures API latency.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = join(tmpdir(), 'cloudbase-isolated-lab');
const lab = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
const WEB = lab.web, PASSWORD = 'Local-Qa-Only!2026';
const SHOTS = join(dir, 'walk'); mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok || !d ? '' : ' -- ' + d}`); };
const post = (p, b, t) => fetch(lab.api + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: JSON.stringify(b) }).then(r => r.json());
const email = `walk-${Date.now().toString(36)}@cloudbase.test`;
const user = await post('/api/auth/register', { name: 'Walk QA', email, password: PASSWORD });
const browser = await chromium.launch({ channel: 'msedge', headless: true });

async function session(mail, viewport) {
  const c = await browser.newContext({ viewport });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  p.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errs.push(m.text().slice(0, 160)));
  await p.goto(WEB + '/auth?mode=login');
  await p.getByRole('textbox', { name: 'Email' }).fill(mail);
  await p.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await p.getByRole('button', { name: 'Sign in', exact: true }).click();
  await p.waitForURL(u => !u.pathname.startsWith('/auth'), { timeout: 15000 });
  return { p, errs };
}
const settled = async p => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(600); };

for (const [tag, viewport] of [['desk', { width: 1280, height: 800 }], ['mob', { width: 390, height: 844 }]]) {
  const { p, errs } = await session(email, viewport);
  for (const path of ['/dashboard', '/account', '/billing', '/help']) {
    await p.goto(WEB + path); await settled(p);
    const text = (await p.locator('body').innerText()).trim();
    check(`${tag} ${path} has content`, text.length > 100 && !/undefined|NaN|\[object Object\]/.test(text), text.match(/.{0,30}(undefined|NaN|\[object Object\]).{0,30}/)?.[0]);
    check(`${tag} ${path} no horizontal scroll`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await p.screenshot({ path: join(SHOTS, `${tag}${path.replace('/', '-')}.png`) });
  }
  // Permission state
  await p.goto(WEB + '/admin'); await settled(p);
  check(`${tag} ordinary user cannot open /admin`, !new URL(p.url()).pathname.startsWith('/admin'), p.url());
  await p.goto(WEB + '/projects/proj-missing'); await settled(p);
  check(`${tag} missing project shows a way back`, /not found|back to projects/i.test(await p.locator('body').innerText()));
  await p.screenshot({ path: join(SHOTS, `${tag}-missing.png`) });
  check(`${tag} no console errors`, errs.length === 0, errs.join(' | '));
  await p.context().close();
}

// Admin
const a = await session('admin@cloudbase.test', { width: 1280, height: 800 });
await a.p.goto(WEB + '/admin'); await settled(a.p);
for (const tab of ['Infrastructure', 'User Governance', 'Audit Trail', 'Hosting', 'Account']) {
  await a.p.getByText(tab, { exact: true }).first().click(); await settled(a.p);
  const text = (await a.p.locator('body').innerText()).trim();
  check(`admin ${tab} renders`, text.length > 100 && !/undefined|NaN|\[object Object\]/.test(text), text.match(/.{0,30}(undefined|NaN|\[object Object\]).{0,30}/)?.[0]);
  await a.p.screenshot({ path: join(SHOTS, `admin-${tab.replace(' ', '')}.png`) });
}
check('admin no console errors', a.errs.length === 0, a.errs.join(' | '));
await a.p.context().close();

// API down and gateway HTML
const d = await session(email, { width: 1280, height: 800 });
await d.p.route('**/api/projects', r => r.request().method() === 'POST'
  ? r.fulfill({ status: 502, contentType: 'text/html', body: '<!DOCTYPE html><html><body>Bad gateway</body></html>' }) : r.continue());
await d.p.goto(WEB + '/account'); await settled(d.p);
await d.p.route('**/api/auth/profile', r => r.abort());
await d.p.getByRole('button', { name: /Save Profile/ }).click();
await d.p.waitForTimeout(800);
const offline = await d.p.locator('body').innerText();
check('offline save explains the unknown outcome', /may still have applied/i.test(offline), offline.slice(0, 120));
check('no raw HTML shown', !/<!DOCTYPE|<html/i.test(offline));
await d.p.screenshot({ path: join(SHOTS, 'offline.png') });

// Expired session
await d.p.evaluate(() => localStorage.setItem('cloudbase.token', 'expired.invalid.token'));
await d.p.goto(WEB + '/dashboard'); await settled(d.p);
check('invalid session returns to sign-in', new URL(d.p.url()).pathname.startsWith('/auth'), d.p.url());
await browser.close();

// Latency (median of 15, ms) with a fixture user that has services
const t = user.token;
const median = async (path, token) => { const x = []; for (let i = 0; i < 15; i++) { const s = performance.now(); await fetch(lab.api + path, { headers: { authorization: 'Bearer ' + token } }); x.push(performance.now() - s); } return Math.round(x.sort((m, n) => m - n)[7]); };
const admin = (await post('/api/auth/login', { email: 'admin@cloudbase.test', password: PASSWORD })).token;
for (const [path, tok] of [['/api/auth/me', t], ['/api/auth/usage', t], ['/api/auth/plan', t], ['/api/projects', t], ['/api/notifications', t], ['/api/admin/users', admin], ['/api/admin/audit-logs', admin], ['/api/admin/infrastructure', admin]]) console.log('latency', path, await median(path, tok));
console.log(`${results.filter(Boolean).length}/${results.length} walkthrough checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
