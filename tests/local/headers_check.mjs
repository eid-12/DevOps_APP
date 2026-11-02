// Frontend nginx headers on a lab started with --nginx: security headers on every page response, index.html never
// cached, one-year caching only for content-hashed build files, dotfiles not served as the app.
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const lab = JSON.parse(readFileSync(join(tmpdir(), 'cloudbase-isolated-lab', 'state.json'), 'utf8'));
const WEB = lab.web;
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok || !d ? '' : ' -- ' + d}`); };
const get = async p => { const r = await fetch(WEB + p, { redirect: 'manual' }); await r.body?.cancel(); return r; };
const security = ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy'];

check('lab serves through nginx', WEB !== lab.api, 'start the lab with --nginx');
for (const path of ['/', '/index.html', '/dashboard', '/projects/proj-x/services/svc-y', '/auth?mode=login']) {
  const r = await get(path);
  const missing = security.filter(h => !r.headers.get(h));
  check(`${path} 200 with security headers`, r.status === 200 && missing.length === 0, `${r.status} missing ${missing}`);
  check(`${path} is not cached`, /no-store/.test(r.headers.get('cache-control') ?? ''), r.headers.get('cache-control'));
  check(`${path} hides nginx version`, !/\d/.test(r.headers.get('server') ?? ''), r.headers.get('server'));
}

const dist = readdirSync(join(lab.frontend));
const index = await (await fetch(WEB + '/')).text();
const referenced = [...index.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(m => m[1]);
check('index references hashed bundles', referenced.length > 0 && referenced.every(f => /-[A-Z0-9]{8}\.(js|css)$/.test(f)), referenced.join(' '));
const unhashed = dist.filter(f => /\.(js|css|woff2?)$/.test(f) && !/-[A-Z0-9]{8}\.(js|css|woff2?)$/.test(f));
check('every long-cached build file is content-hashed', unhashed.length === 0, unhashed.join(' '));
for (const f of referenced.slice(0, 3)) {
  const r = await get('/' + f);
  check(`${f} cached for a year as immutable`, r.status === 200 && /max-age=31536000/.test(r.headers.get('cache-control') ?? '') && /immutable/.test(r.headers.get('cache-control') ?? ''), r.headers.get('cache-control'));
  check(`${f} keeps security headers`, !!r.headers.get('x-content-type-options'));
}
for (const f of ['/favicon.svg', '/favicon.ico']) {
  const r = await get(f);
  check(`${f} is not cached as immutable`, r.status === 200 && !/immutable/.test(r.headers.get('cache-control') ?? ''), `${r.status} ${r.headers.get('cache-control')}`);
}
const gone = await get('/main-AAAAAAAA.js');
check('a bundle from an older release is 404, not the app page', gone.status === 404, String(gone.status));
for (const p of ['/.env', '/.git/config', '/.well-known/../.env']) {
  const r = await get(p);
  check(`${p} is 404`, r.status === 404, String(r.status));
}
const api = await get('/api/public/app-config');
check('/api proxies to the backend', api.status === 200, String(api.status));

console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
