// Buttons, dialogs, validation and admin actions on the lab (real API, simulated infrastructure), plus key scoping.
// Run once per lab, after verify_api.py.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const lab = JSON.parse(readFileSync(join(tmpdir(), 'cloudbase-isolated-lab', 'state.json'), 'utf8'));
const WEB = lab.web, PASSWORD = 'Local-Qa-Only!2026';
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok || !d ? '' : ' -- ' + d}`); };
const api = async (m, p, b, t, key) => { const r = await fetch(lab.api + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); const x = await r.text(); let j; try { j = JSON.parse(x); } catch { j = x; } return [r.status, j]; };
const stamp = Date.now().toString(36);
const mk = async n => { const [, r] = await api('POST', '/api/auth/register', { name: n, email: `${n}-${stamp}@cloudbase.test`, password: PASSWORD }); return r; };
const admin = (await api('POST', '/api/auth/login', { email: 'admin@cloudbase.test', password: PASSWORD }))[1].token;
const a = await mk('actor'), b2 = await mk('other');
for (const u of [a, b2]) await api('PATCH', `/api/admin/users/${u.user.id}/deployment-access`, { enabled: true }, admin);

// Idempotency scope
const key = crypto.randomUUID();
const [, pa] = await api('POST', '/api/projects', { name: 'scope' }, a.token, key);
const [sb, pb] = await api('POST', '/api/projects', { name: 'scope' }, b2.token, key);
check('same key under another owner is independent', sb === 201 && pb.id !== pa.id && pb.ownerId === b2.user.id);
check('same name, different payload with one key is refused', (await api('POST', '/api/projects', { name: 'scope', description: 'changed' }, a.token, key))[0] === 409);
const svc = { name: 's', sourceType: 'DOCKER', sourceDetails: { imageName: 'nginx', imageTag: 'alpine', containerPort: 80 }, quota: { memoryMb: 64, cpuMilli: 100, storageGb: 0 } };
check('a project key cannot be replayed as a service create', (await api('POST', `/api/projects/${pa.id}/services`, svc, a.token, key))[0] === 409);
const ck = crypto.randomUUID();
const conc = await Promise.all([1, 2, 3, 4, 5].map(() => api('POST', '/api/projects', { name: 'conc' }, a.token, ck)));
check('5 concurrent project creates with one key make one', new Set(conc.map(c => c[1].id)).size === 1, conc.map(c => c[0]));
check('invalid key format is refused', (await api('POST', '/api/projects', { name: 'x' }, a.token, 'bad key!'))[0] >= 400);
await api('DELETE', `/api/projects/${conc[0][1].id}`, undefined, a.token);
const [rs, re] = await api('POST', '/api/projects', { name: 'conc' }, a.token, ck);
check('after deleting the resource the same key may create again', rs === 201 && re.id !== conc[0][1].id);

// Pagination: older records stay reachable
const [, sv] = await api('POST', `/api/projects/${pa.id}/services`, svc, a.token, crypto.randomUUID());
await new Promise(r => setTimeout(r, 2500));
const page0 = (await api('GET', `/api/projects/services/${sv.id}/deployments?size=1`, undefined, a.token))[1];
const page1 = (await api('GET', `/api/projects/services/${sv.id}/deployments?page=1&size=1`, undefined, a.token))[1];
check('deployment pages are reachable', page0.length === 1 && Array.isArray(page1));

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const open = async mail => {
  const c = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const p = await c.newPage();
  await p.goto(WEB + '/auth?mode=login');
  await p.getByRole('textbox', { name: 'Email' }).fill(mail); await p.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await p.getByRole('button', { name: 'Sign in', exact: true }).click();
  await p.waitForURL(u => !u.pathname.startsWith('/auth'), { timeout: 15000 });
  await p.waitForLoadState('networkidle').catch(() => {});
  return p;
};

// Frontend keys: retry reuses, a new action does not
const u = await open(a.user.email);
const keys = [];
let drop = true;
await u.route('**/api/projects', async r => {
  if (r.request().method() !== 'POST') return r.continue();
  keys.push(r.request().headers()['idempotency-key']);
  if (drop) { drop = false; await r.fetch(); return r.fulfill({ status: 502, contentType: 'text/html', body: '<html>gateway</html>' }); } // applied, response lost
  return r.continue();
});
const emptyDialog = async name => {
  await u.getByRole('button', { name: /New/ }).first().click();
  await u.locator('.create-picker-input').fill(name);
  await u.getByRole('button', { name: /Empty Project/ }).click();
};
await emptyDialog('retry-ui');
await u.getByRole('button', { name: 'Create Project', exact: true }).click();
await u.waitForTimeout(1200);
check('lost response keeps the dialog and explains', /may still have applied/i.test(await u.locator('body').innerText()));
await u.getByRole('button', { name: 'Create Project', exact: true }).click();
await u.waitForTimeout(1500);
const listed = (await api('GET', '/api/projects', undefined, a.token))[1].filter(p => p.name === 'retry-ui').length;
check('UI retry reuses the key and creates one project', keys.length === 2 && keys[0] === keys[1] && listed === 1, JSON.stringify({ keys, listed }));
await u.goto(WEB + '/dashboard'); await u.waitForLoadState('networkidle').catch(() => {});
await emptyDialog('retry-ui');
await u.getByRole('button', { name: 'Create Project', exact: true }).click();
await u.waitForTimeout(1500);
check('a genuinely new action gets a new key', keys.length === 3 && keys[2] !== keys[0], JSON.stringify(keys));

// Validation and dialogs
await u.goto(WEB + '/dashboard'); await u.waitForLoadState('networkidle').catch(() => {});
await emptyDialog(' ');
const create = u.getByRole('button', { name: 'Create Project', exact: true });
const blocked = await create.isDisabled() || (await create.click().then(() => u.waitForTimeout(500)), (await api('GET', '/api/projects', undefined, a.token))[1].filter(p => !p.name.trim()).length === 0);
check('blank project name is not created', blocked);
await u.getByRole('button', { name: 'Cancel' }).first().click().catch(() => {});
await u.goto(`${WEB}/projects/${pa.id}`); await u.waitForLoadState('networkidle').catch(() => {});
await u.getByRole('button', { name: 'Delete', exact: true }).first().click();
await u.waitForTimeout(400);
const dlg = await u.locator('body').innerText();
check('service delete asks for confirmation', /delete service/i.test(dlg));
await u.keyboard.press('Escape');
await u.getByRole('button', { name: /Cancel/ }).first().click().catch(() => {});
await u.waitForTimeout(400);
check('cancelling keeps the service', (await api('GET', `/api/projects/${pa.id}`, undefined, a.token))[1].services.length === 1);

await u.goto(`${WEB}/projects/${pa.id}/services/${sv.id}`); await u.waitForLoadState('networkidle').catch(() => {});
await u.getByRole('button', { name: 'Variables', exact: true }).click(); await u.waitForTimeout(500);
const varText = await u.locator('body').innerText();
check('variables tab renders', /variable/i.test(varText));
let hits = 0;
await u.route('**/deploy', r => { hits++; r.continue(); });
const deployBtn = u.getByRole('button', { name: /^(Redeploy|Deploy)/ }).first();
await deployBtn.dblclick().catch(() => {});
await u.waitForTimeout(1500);
const running = (await api('GET', `/api/projects/services/${sv.id}/deployments`, undefined, a.token))[1];
check('double click starts at most one extra deploy', running.filter(d => ['QUEUED', 'BUILDING', 'DEPLOYING'].includes(d.status)).length <= 1, hits);

// Cancelling a running deploy: a double click sends one request and never ends on "already finished"
const mockExec = (...c) => execFileSync('docker', ['exec', lab.prefix + '-mock', ...c]);
for (let i = 0; i < 40 && (await api('GET', `/api/projects/services/${sv.id}/deployments`, undefined, a.token))[1]
  .some(d => ['QUEUED', 'BUILDING', 'DEPLOYING'].includes(d.status)); i++) await u.waitForTimeout(500);
mockExec('touch', '/tmp/slow-deploy');
await api('POST', `/api/projects/services/${sv.id}/deploy`, { imageTag: '1.27-alpine' }, a.token);
await u.goto(`${WEB}/projects/${pa.id}/services/${sv.id}`); await u.waitForLoadState('domcontentloaded');
await u.getByRole('button', { name: 'Deployments', exact: true }).first().click(); await u.waitForTimeout(800);
let cancels = 0;
await u.route('**/cancel', r => { cancels++; r.continue(); });
await u.getByRole('button', { name: 'Cancel', exact: true }).first().dblclick();
await u.waitForTimeout(2500);
const afterCancel = await u.locator('body').innerText();
check('double-clicked cancel sends one request and reports success only', cancels === 1 && /Deployment cancelled/.test(afterCancel)
  && !/already finished/i.test(afterCancel), JSON.stringify({ cancels, error: afterCancel.match(/.{0,40}already finished.{0,20}/i)?.[0] }));
mockExec('rm', '-f', '/tmp/slow-deploy');

// Older history stays reachable in the UI
execFileSync('docker', ['exec', lab.prefix + '-db', 'psql', '-U', 'cloudbase', '-d', 'cloudbase', '-c',
  `insert into deployments (id, service_id, project_id, status, started_at, finished_at) select 'old-'||g, '${sv.id}', '${pa.id}', 'SUCCESS', now() - (g||' minutes')::interval, now() from generate_series(1,120) g`]);
await u.goto(`${WEB}/projects/${pa.id}/services/${sv.id}`); await u.waitForLoadState('networkidle').catch(() => {});
await u.getByRole('button', { name: 'Deployments', exact: true }).first().click(); await u.waitForTimeout(800);
const before = await u.locator('.dep-list article').count();
await u.getByRole('button', { name: 'Load older deployments' }).click(); await u.waitForTimeout(1000);
await u.getByRole('button', { name: 'Load older deployments' }).click(); await u.waitForTimeout(1000);
check('Load older reaches every record', before === 50 && await u.locator('.dep-list article').count() >= 120, before);

// Admin actions
const ad = await open('admin@cloudbase.test');
await ad.goto(WEB + '/admin'); await ad.getByText('User Governance', { exact: true }).click();
await ad.getByPlaceholder('Name or email').fill(b2.user.email);
const row = ad.locator('tr', { hasText: b2.user.email });
ad.once('dialog', d => d.dismiss());
await row.getByRole('button', { name: 'Suspend' }).click(); await ad.waitForTimeout(500);
const dismiss = (await api('GET', '/api/admin/users', undefined, admin))[1].find(x => x.id === b2.user.id);
check('dismissing Suspend changes nothing', dismiss.accountStatus === 'ACTIVE');
ad.once('dialog', d => d.dismiss());
await row.getByRole('button', { name: 'Make Admin' }).click(); await ad.waitForTimeout(500);
check('dismissing Make Admin changes nothing', (await api('GET', '/api/admin/users', undefined, admin))[1].find(x => x.id === b2.user.id).role === 'USER');
ad.once('dialog', d => d.accept());
await row.getByRole('button', { name: 'Suspend' }).click(); await row.getByText('Suspended', { exact: true }).waitFor({ timeout: 8000 });
check('confirmed Suspend applies', true);
check('admin cannot be targeted by the ordinary API', (await api('GET', '/api/admin/users', undefined, a.token))[0] === 403);
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} action checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
