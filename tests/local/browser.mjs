// Real-browser checks against the isolated lab: the built frontend, the real API and Postgres, synthetic data.
// Run after verify_api.py (it creates the fixtures). Uses the installed Microsoft Edge; no browser download.
//   cd tests/local && npm ci && npm run browser
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const STATE_DIR = join(tmpdir(), 'cloudbase-isolated-lab');
const lab = JSON.parse(readFileSync(join(STATE_DIR, 'state.json'), 'utf8'));
if (!lab.fixtures) throw new Error('Run verify_api.py first: it creates the browser fixtures');
const { browserEmail, adminEmail, password } = lab.fixtures;
const WEB = lab.web;
const SHOTS = join(STATE_DIR, 'browser-shots');
mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ' — ' + detail}`); };

async function api(method, path, body, token, expected = 200) {
  const res = await fetch(lab.api + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (res.status !== expected) throw new Error(`${method} ${path}: expected ${expected}, got ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const consoleErrors = [];
const openPages = [];
async function newPage(label, viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  openPages.push([label, page]);
  page.on('pageerror', e => consoleErrors.push(`[${label}] ${e.message}`));
  page.on('console', m => {
    // Failed requests are logged by the browser itself; the deliberate 401/403/503 probes are not app errors.
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(`[${label}] ${m.text().slice(0, 200)}`);
  });
  return page;
}
async function signIn(page, email) {
  await page.goto(WEB + '/auth');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(u => !u.pathname.startsWith('/auth'), { timeout: 15000 }).catch(async () => {
    throw new Error(`still on ${page.url()}: ${(await page.locator('.auth-error, [role=alert], .error').allInnerTexts()).join(' | ')}`);
  });
}
const shot = (page, name) => page.screenshot({ path: join(SHOTS, name + '.png') });

let step = 'start';
try {
  // Re-runnable: put the fixture user back to active with deploy access (a previous run suspends it).
  step = 'reset fixture';
  const adminToken = (await api('POST', '/api/auth/login', { email: adminEmail, password })).token;
  const fixture = (await api('GET', '/api/admin/users', undefined, adminToken)).find(u => u.email === browserEmail);
  await api('PATCH', `/api/admin/users/${fixture.id}/account-status`, { accountStatus: 'ACTIVE' }, adminToken);
  await api('PATCH', `/api/admin/users/${fixture.id}/deployment-access`, { enabled: true }, adminToken);
  // Earlier runs' projects would count against the free plan's service limit.
  const fixtureToken = (await api('POST', '/api/auth/login', { email: browserEmail, password })).token;
  for (const p of await api('GET', '/api/projects', undefined, fixtureToken)) {
    if (p.name.startsWith('browser-')) await api('DELETE', '/api/projects/' + p.id, undefined, fixtureToken, 204);
  }

  // 1. sign in, theme
  step = 'sign in';
  const user = await newPage('user');
  await signIn(user, browserEmail);
  check('user signs in through the real API and lands on the dashboard', /\/dashboard/.test(user.url()));
  check('dark colour scheme is active', await user.evaluate(() => getComputedStyle(document.documentElement).colorScheme) === 'dark');
  const token = await user.evaluate(() => localStorage.getItem('cloudbase.token'));

  // 2. create a project through the UI
  step = 'create project';
  const projectName = 'browser-' + Date.now().toString(36);
  await user.getByRole('button', { name: /New/ }).first().click();
  await user.locator('.create-picker-input').fill(projectName);
  await user.getByRole('button', { name: /Empty Project/ }).click();
  await user.getByRole('button', { name: 'Create Project', exact: true }).click();
  await user.waitForURL(/\/projects\/[^/]+$/, { timeout: 15000 }).catch(() => {});
  const projects = await api('GET', '/api/projects', undefined, token);
  const project = projects.find(p => p.name === projectName);
  check('project created in the UI is persisted', !!project);
  await shot(user, '01-project');

  // 3. add a Docker service, choosing a preset from a PrimeNG Select
  step = 'add docker service';
  await user.goto(WEB + '/projects/' + project.id);
  await user.getByRole('button', { name: /Add Service/ }).first().click(); // header button; an empty project shows a second one
  await user.getByRole('button', { name: /Docker Image/ }).click();
  await user.getByPlaceholder('my-service').fill('web-ui');
  const presetSelect = user.locator('p-select').filter({ hasText: /Custom image/ });
  await presetSelect.click();
  await user.locator('.p-select-overlay .p-select-option').filter({ has: user.getByText('Nginx', { exact: true }) }).click();
  check('preset chosen from the Select is shown',
    await user.locator('p-select .p-select-label', { hasText: 'Nginx' }).first().waitFor({ timeout: 5000 }).then(() => true, () => false));
  await shot(user, '02-docker-dialog');
  await user.getByRole('button', { name: /^(Deploy|Create|Add service|Deploy service|Create service)$/i }).last().click();
  let dockerSvc;
  for (let i = 0; i < 20 && !dockerSvc; i++) {
    dockerSvc = (await api('GET', '/api/projects/' + project.id, undefined, token)).services?.find(s => s.name === 'web-ui');
    if (!dockerSvc) await user.waitForTimeout(500);
  }
  check('Docker service created in the UI is persisted with the preset image', dockerSvc?.sourceDetails?.imageName?.includes('nginx'));

  // 4. GitHub service settings save (the request must not carry CloudBase-managed fields)
  step = 'github settings save';
  const gh = await api('POST', `/api/projects/${project.id}/services`, { name: 'gh-ui', sourceType: 'GITHUB',
    sourceDetails: { repositoryUrl: 'https://github.com/local-qa/browser-app', branch: 'main', runtime: 'node' },
    quota: { memoryMb: 128, cpuMilli: 100, storageGb: 0 } }, token, 201);
  await user.goto(`${WEB}/projects/${project.id}/services/${gh.id}`);
  await user.getByRole('button', { name: 'Settings', exact: true }).click();
  const branch = user.locator('label:has-text("Branch") + input, label:has-text("Branch") ~ input').first();
  await branch.fill('release');
  await user.getByRole('button', { name: /^Save/ }).first().click();
  await user.waitForTimeout(1500);
  const saved = await api('GET', '/api/projects/services/' + gh.id, undefined, token);
  check('GitHub service settings save succeeds from the UI', saved.sourceDetails.branch === 'release');
  await shot(user, '03-github-settings');

  // 4b. changing the password in the UI keeps this browser signed in (the old token is revoked server-side)
  step = 'password change';
  await user.goto(WEB + '/account');
  await user.locator('#acc-cur').fill(password);
  await user.locator('#acc-new').fill('Browser-Changed!2026');
  await user.locator('#acc-confirm').fill('Browser-Changed!2026');
  await user.getByRole('button', { name: 'Change Password' }).click();
  await user.getByText('Password changed', { exact: false }).first().waitFor({ timeout: 10000 });
  const newToken = await user.evaluate(() => localStorage.getItem('cloudbase.token'));
  check('UI password change stores the fresh session token', !!newToken && newToken !== token);
  check('token from before the UI password change is revoked',
    await api('GET', '/api/auth/me', undefined, token, 401).then(() => true, () => false));
  await user.goto(WEB + '/dashboard');
  await user.waitForTimeout(1500);
  check('browser stays signed in after changing its password', /\/dashboard/.test(user.url()));
  // Put the fixture password back so the next run can sign in.
  await api('POST', '/api/auth/change-password', { currentPassword: 'Browser-Changed!2026', newPassword: password }, newToken);

  // 5. mobile layout
  step = 'mobile';
  const mobile = await newPage('mobile', { width: 390, height: 844 });
  await mobile.goto(WEB + '/auth');
  await mobile.evaluate(t => { localStorage.setItem('cloudbase.token', t); localStorage.setItem('cloudbase.token.exp', String(Date.now() + 3600e3)); },
    (await api('POST', '/api/auth/login', { email: browserEmail, password })).token); // earlier tokens were revoked by 4b
  for (const path of ['/dashboard', '/projects/' + project.id, `/projects/${project.id}/services/${gh.id}`]) {
    await mobile.goto(WEB + path);
    await mobile.waitForLoadState('networkidle');
    check(`no horizontal scroll at 390px on ${path.replace(/[a-z]+-[0-9a-f]{8}/g, ':id')}`,
      await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  }
  await shot(mobile, '04-mobile-service');

  // 5b. at the plan limit both Add Service buttons are disabled with the same reason (verify_api fills quota@)
  step = 'plan limit buttons';
  const quotaPage = await newPage('quota');
  await signIn(quotaPage, 'quota@cloudbase.test');
  const quotaToken = await quotaPage.evaluate(() => localStorage.getItem('cloudbase.token'));
  const emptyProject = await api('POST', '/api/projects', { name: 'browser-empty-' + Date.now().toString(36) }, quotaToken, 201);
  await quotaPage.goto(WEB + '/projects/' + emptyProject.id);
  const addButtons = quotaPage.getByRole('button', { name: /Add Service/ });
  await addButtons.nth(1).waitFor({ timeout: 10000 });
  const states = await addButtons.evaluateAll(bs => bs.map(b => ({ disabled: b.disabled, title: b.title })));
  check('header and empty-state Add Service are both disabled at the plan limit',
    states.length === 2 && states.every(s => s.disabled), JSON.stringify(states));
  check('both buttons give the same plan-limit reason', states.length === 2 && states[0].title === states[1].title && /Free plan limit/.test(states[0].title));
  check('empty state explains why', await quotaPage.getByText(states[0]?.title || '-', { exact: true }).count() >= 1);
  await shot(quotaPage, '05b-plan-limit');
  await api('DELETE', '/api/projects/' + emptyProject.id, undefined, quotaToken, 204);

  // 6. admin suspends the user in the admin UI; the user's open session ends
  step = 'admin suspend';
  const admin = await newPage('admin');
  await signIn(admin, adminEmail);
  await admin.goto(WEB + '/admin');
  await admin.getByText('User Governance', { exact: true }).click();
  await admin.getByPlaceholder('Name or email').fill(browserEmail);
  const row = admin.locator('tr', { hasText: browserEmail });
  await row.getByRole('button', { name: 'Suspend' }).click();
  await row.getByText('Suspended', { exact: true }).waitFor({ timeout: 10000 }); // no confirm dialog; the row updates
  await shot(admin, '05-admin-suspended');
  check('admin UI suspends the account', (await api('POST', '/api/auth/login', { email: browserEmail, password }, undefined, 403).then(() => true, () => false)));
  await user.goto(WEB + '/dashboard');
  await user.waitForURL(u => !/\/dashboard/.test(u.pathname), { timeout: 15000 }).catch(() => {});
  check('suspended user is sent out of the app on the next navigation', !/\/dashboard/.test(new URL(user.url()).pathname));
  await shot(user, '06-user-after-suspend');

  // 7. sign out
  step = 'sign out';
  await admin.getByRole('button', { name: 'Logout' }).click();
  await admin.waitForTimeout(800);
  check('sign out clears the stored session', !(await admin.evaluate(() => localStorage.getItem('cloudbase.token'))));
} catch (e) {
  check(`browser flow "${step}" completed`, false, e.message.split('\n')[0]);
  for (const [label, page] of openPages) await page.screenshot({ path: join(SHOTS, `failure-${label}.png`) }).catch(() => {});
} finally {
  check('no uncaught errors or console errors in the app', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  await browser.close();
}
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} browser checks passed (screenshots: ${SHOTS})`);
process.exit(passed === results.length ? 0 : 1);
