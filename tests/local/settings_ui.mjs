// Settings, variables, network, hosting and reset-link UI on the lab (real app and Postgres, simulated infrastructure).
// External checks not covered here: real GitHub consent, real email delivery, real DNS and certificates.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const dir = join(tmpdir(), 'cloudbase-isolated-lab');
const lab = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
const WEB = lab.web, PASSWORD = 'Local-Qa-Only!2026';
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok || !d ? '' : ' -- ' + d}`); };
const api = async (m, p, b, t) => { const r = await fetch(lab.api + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); const x = await r.text(); let j; try { j = JSON.parse(x); } catch { j = x; } return [r.status, j]; };
const stamp = Date.now().toString(36);
const reg = async n => (await api('POST', '/api/auth/register', { name: n, email: `${n}-${stamp}@cloudbase.test`, password: PASSWORD }))[1];
const admin = (await api('POST', '/api/auth/login', { email: 'admin@cloudbase.test', password: PASSWORD }))[1].token;
const u = await reg('settings'), other = await reg('stranger');
for (const x of [u, other]) await api('PATCH', `/api/admin/users/${x.user.id}/deployment-access`, { enabled: true }, admin);
const [, project] = await api('POST', '/api/projects', { name: 'settings' }, u.token);
// Synthetic GitHub connection (same statement as lab.connect_github) so GitHub services pass the push-access check.
execFileSync('docker', ['exec', lab.prefix + '-db', 'psql', '-U', 'cloudbase', '-d', 'cloudbase', '-c',
  "update users set github_access_token='synthetic-token', github_username='local-qa', github_scopes='repo read:packages' where role='USER' and github_access_token is null"]);
const mkGh = async n => (await api('POST', `/api/projects/${project.id}/services`, { name: n, sourceType: 'GITHUB', sourceDetails: { repositoryUrl: 'https://github.com/local-qa/' + n, branch: 'main', runtime: 'node' }, quota: { memoryMb: 128, cpuMilli: 100, storageGb: 0 } }, u.token))[1];
const gh = await mkGh('gh-settings');
const victim = await mkGh('to-delete');
const svc = async id => (await api('GET', '/api/projects/services/' + id, undefined, u.token))[1];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const session = async mail => {
  const c = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage();
  await p.goto(WEB + '/auth?mode=login');
  await p.getByRole('textbox', { name: 'Email' }).fill(mail); await p.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await p.getByRole('button', { name: 'Sign in', exact: true }).click();
  await p.waitForURL(l => !l.pathname.startsWith('/auth'), { timeout: 15000 });
  return p;
};
const p = await session(u.user.email);
const openSvc = async (id, tab) => { await p.goto(`${WEB}/projects/${project.id}/services/${id}`); await p.waitForLoadState('networkidle').catch(() => {}); await p.getByRole('button', { name: tab, exact: true }).first().click(); await p.waitForTimeout(400); };
const section = async n => { await p.locator('.settings-nav-item', { hasText: n }).click(); await p.waitForTimeout(250); };
const saveIn = async () => { await p.getByRole('button', { name: /^Save/ }).first().click(); await p.waitForTimeout(1300); };

// Build
await openSvc(gh.id, 'Settings'); await section('Build');
await p.locator('input[placeholder^="backend"]').fill('app');
await p.locator('input[placeholder^="npm run build"]').fill('npm run build:prod');
await saveIn();
let s = await svc(gh.id);
check('Build settings persist', s.sourceDetails.rootDirectory === 'app' && s.sourceDetails.buildCommand === 'npm run build:prod', JSON.stringify(s.sourceDetails).slice(0, 200));
await openSvc(gh.id, 'Settings'); await section('Build');
check('Build values shown after reload', await p.locator('input[placeholder^="backend"]').inputValue() === 'app');

// Deploy
await section('Deploy');
await p.locator('input[placeholder^="/health"]').fill('/healthz');
await p.locator('select').first().selectOption('on-failure');
await saveIn();
s = await svc(gh.id);
check('Deploy settings persist', s.sourceDetails.healthcheckPath === '/healthz' && s.sourceDetails.restartPolicy === 'on-failure', JSON.stringify(s.sourceDetails).slice(0, 200));

// Scale
await openSvc(gh.id, 'Settings'); await section('Scale');
const mem = p.locator('input[type=number]').first();
await mem.fill('256'); await saveIn();
check('Scale persists', (await svc(gh.id)).quotaMemoryMb === 256);
await mem.fill('90000'); await saveIn();
check('Scale over the plan is refused and shown', (await svc(gh.id)).quotaMemoryMb === 256 && /limit|between|memory/i.test(await p.locator('body').innerText()));

// Danger: cancel, then confirm
// GitHub services deploy on creation; deletion is refused (409) mid-deploy, so wait for it to finish first.
for (let i = 0; i < 120; i++) {
  const d = (await api('GET', `/api/projects/services/${victim.id}/deployments`, undefined, u.token))[1] ?? [];
  if (!d.some(x => ['QUEUED', 'BUILDING', 'DEPLOYING'].includes(x.status))) break;
  await new Promise(r => setTimeout(r, 1000));
}
await openSvc(victim.id, 'Settings'); await section('Danger');
await p.getByRole('button', { name: /Delete/ }).first().click(); await p.waitForTimeout(400);
const confirmInput = p.locator('.modal-panel input, [role=dialog] input').first();
await p.getByRole('button', { name: 'Cancel' }).first().click(); await p.waitForTimeout(400);
check('Danger cancel keeps the service', (await api('GET', '/api/projects/services/' + victim.id, undefined, u.token))[0] === 200);
await p.getByRole('button', { name: /Delete/ }).first().click(); await p.waitForTimeout(400);
const del = p.locator('.modal-panel, [role=dialog]').last().getByRole('button', { name: /Delete/ }).last();
const disabledFirst = await del.isDisabled();
if (await confirmInput.count()) await confirmInput.fill('to-delete');
// Teardown of a deployed service takes ~2 s; wait for the API answer rather than a fixed delay.
await Promise.all([
  p.waitForResponse(r => r.request().method() === 'DELETE' && r.url().includes('/services/' + victim.id), { timeout: 30000 }).catch(() => null),
  del.click({ timeout: 5000 }).catch(() => {})
]);
await p.waitForTimeout(300);
const gone = (await api('GET', '/api/projects/services/' + victim.id, undefined, u.token))[0] === 404;
check('Danger confirm deletes after typed confirmation', disabledFirst && gone, gone ? disabledFirst : JSON.stringify({ disabledFirst,
  page: (await p.locator('body').innerText()).match(/.{0,80}(deploy|delet|error|wait).{0,80}/i)?.[0],
  deployments: ((await api('GET', `/api/projects/services/${victim.id}/deployments`, undefined, u.token))[1] ?? []).slice(0, 2).map(d => d.status) }));

// Network
await openSvc(gh.id, 'Network');
const domain = p.locator('input[placeholder="app.example.com"]');
await domain.fill('not a domain'); await p.getByRole('button', { name: 'Check availability' }).click(); await p.waitForTimeout(900);
check('invalid domain is rejected', /✗/.test(await p.locator('body').innerText()));
await domain.fill('qa-ui.example.test'); await p.getByRole('button', { name: 'Check availability' }).click(); await p.waitForTimeout(900);
await p.getByRole('button', { name: /Save domain|Save custom|Save$/ }).first().click(); await p.waitForTimeout(1300);
check('custom domain persists', (await svc(gh.id)).customDomain === 'qa-ui.example.test', (await svc(gh.id)).customDomain);
check('stranger cannot change the domain', (await api('PUT', `/api/projects/services/${gh.id}/custom-domain`, { domain: 'x.example.test' }, other.token))[0] === 403);

// Environment variables
await openSvc(gh.id, 'Variables');
await p.getByRole('button', { name: /Add.*(Variable|Var)|\+ ?Add|New Variable/i }).first().click(); await p.waitForTimeout(250);
const keys = p.locator('.var-row input[placeholder="KEY"]');
await keys.last().fill('BAD KEY');
await p.locator('.var-row .var-value-wrap input').last().fill('v1');
await p.getByRole('button', { name: 'Save Variables' }).click(); await p.waitForTimeout(1000);
check('invalid variable key is refused', !('BAD KEY' in ((await svc(gh.id)).envVars ?? {})));
await keys.last().fill('QA_UI');
await p.getByRole('button', { name: 'Save Variables' }).click(); await p.waitForTimeout(1000);
check('variable persists', (await svc(gh.id)).envVars?.QA_UI?.value === 'v1', JSON.stringify((await svc(gh.id)).envVars));
await openSvc(gh.id, 'Variables');
check('variable shown after reload', await p.locator('.var-row input[placeholder="KEY"]').last().inputValue() === 'QA_UI');
await p.locator('.var-row .danger').last().click();
await p.getByRole('button', { name: 'Save Variables' }).click(); await p.waitForTimeout(1000);
check('variable deletion persists', !((await svc(gh.id)).envVars ?? {}).QA_UI);

// Shared variables
await p.goto(`${WEB}/projects/${project.id}`); await p.waitForLoadState('networkidle').catch(() => {});
await p.getByRole('button', { name: 'Project Variables' }).click(); await p.waitForTimeout(500);
await p.getByRole('button', { name: '+ Add Variable' }).click(); await p.waitForTimeout(300);
await p.getByPlaceholder('DATABASE_URL').fill('SHARED_UI');
await p.getByPlaceholder('value').first().fill('shared');
await p.getByRole('button', { name: 'Create Variable' }).click(); await p.waitForTimeout(1000);
let shared = (await api('GET', `/api/projects/${project.id}/variables`, undefined, u.token))[1];
check('shared variable persists', shared.some(v => v.key === 'SHARED_UI'), JSON.stringify(shared).slice(0, 150));
check('stranger cannot read shared variables', (await api('GET', `/api/projects/${project.id}/variables`, undefined, other.token))[0] === 403);
await p.reload(); await p.waitForLoadState('networkidle').catch(() => {});
await p.getByRole('button', { name: 'Project Variables' }).click(); await p.waitForTimeout(500);
p.once('dialog', d => d.accept());
await p.getByRole('button', { name: /Delete/ }).first().click(); await p.waitForTimeout(1000);
shared = (await api('GET', `/api/projects/${project.id}/variables`, undefined, u.token))[1];
check('shared variable deletion persists', !shared.some(v => v.key === 'SHARED_UI'), JSON.stringify(shared).slice(0, 150));

// Hosting
const a = await session('admin@cloudbase.test');
await a.goto(WEB + '/admin'); await a.getByText('Hosting', { exact: true }).first().click(); await a.waitForTimeout(800);
const before = (await api('GET', '/api/admin/hosting-settings', undefined, admin))[1];
const ns = a.locator('.field', { hasText: 'Namespace' }).locator('input');
await ns.fill('qa-namespace');
await a.getByRole('button', { name: /Save/ }).last().click(); await a.waitForTimeout(1200);
const after = (await api('GET', '/api/admin/hosting-settings', undefined, admin))[1];
check('Hosting settings persist', after.dockerHubNamespace === 'qa-namespace', JSON.stringify(after).slice(0, 160));
check('Hosting never returns secrets', !JSON.stringify(after).includes('synthetic-key'));
await a.reload(); await a.getByText('Hosting', { exact: true }).first().click(); await a.waitForTimeout(800);
check('Hosting value shown after reload', await a.locator('.field', { hasText: 'Namespace' }).locator('input').inputValue() === 'qa-namespace');
check('ordinary user cannot read Hosting', (await api('GET', '/api/admin/hosting-settings', undefined, u.token))[0] === 403);
await api('PUT', '/api/admin/hosting-settings', { dockerHubNamespace: before.dockerHubNamespace ?? '' }, admin);

// Password-reset link UI (link minted as the server does; email itself is an external check)
const secret = JSON.parse(execFileSync('docker', ['inspect', lab.prefix + '-api'], { encoding: 'utf8' }))[0].Config.Env.find(e => e.startsWith('JWT_SECRET=')).slice(11);
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const alg = JSON.parse(Buffer.from(u.token.split('.')[0], 'base64url')).alg;
const mint = (exp, sv) => { const h = b64({ alg }), b = b64({ sub: other.user.id, purpose: 'password_reset', sv, iat: Math.floor(Date.now() / 1000) - 10, exp }); return `${h}.${b}.${createHmac('sha' + alg.slice(2), secret).update(`${h}.${b}`).digest('base64url')}`; };
const r = await (await browser.newContext()).newPage();
const fill = async pw => { await r.locator('#auth-password').fill(pw); await r.locator('#auth-confirm').fill(pw); await r.getByRole('button', { name: 'Update password' }).click(); await r.waitForTimeout(1200); };
await r.goto(`${WEB}/auth?mode=reset&token=${mint(Math.floor(Date.now() / 1000) - 60, 0)}`);
await fill('Reset-Ui!2026a');
const deadLink = async () => /mode=forgot/.test(r.url()) && /expired or was already used/i.test(await r.locator('body').innerText());
check('expired link is refused and leads to requesting a new one', await deadLink(), r.url());
await r.goto(`${WEB}/auth?mode=reset&token=${mint(Math.floor(Date.now() / 1000) + 600, 0)}`);
await fill('weak');
check('weak password is refused', (await api('POST', '/api/auth/login', { email: other.user.email, password: 'weak' }))[0] === 401);
await fill('Reset-Ui!2026a');
check('reset succeeds and returns to sign-in', /mode=login/.test(r.url()) && (await api('POST', '/api/auth/login', { email: other.user.email, password: 'Reset-Ui!2026a' }))[0] === 200, r.url());
check('old session ends after reset', (await api('GET', '/api/auth/me', undefined, other.token))[0] === 401);
await r.goto(`${WEB}/auth?mode=reset&token=${mint(Math.floor(Date.now() / 1000) + 600, 0)}`);
await fill('Reset-Ui!2026b');
check('the same link cannot be used twice', await deadLink(), r.url());
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} settings checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
