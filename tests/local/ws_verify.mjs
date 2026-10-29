// Real-broker WebSocket checks against the isolated lab (python tests/local/lab.py start --jdk --jwt-expiration-ms 45000).
// STOMP over the SockJS websocket transport, synthetic accounts only. Events come from real deploys that the
// synthetic infrastructure fails quickly; nothing leaves the lab network.
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const lab = JSON.parse(readFileSync(join(tmpdir(), 'cloudbase-isolated-lab', 'state.json'), 'utf8'));
const API = lab.api;
const PASSWORD = 'Local-Qa-Only!2026';
const results = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ' — ' + detail}`); };

async function call(method, path, body, token, expected = 200) {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (res.status !== expected) throw new Error(`${method} ${path}: expected ${expected}, got ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
const login = async email => (await call('POST', '/api/auth/login', { email, password: PASSWORD })).token;

/** Minimal STOMP 1.2 client over the raw SockJS websocket transport. */
class Stomp {
  constructor(token) {
    this.frames = []; this.closed = false; this.waiters = [];
    const session = Math.random().toString(36).slice(2, 10);
    this.ws = new WebSocket(API.replace(/^http/, 'ws') + `/ws/000/${session}/websocket`);
    this.ws.addEventListener('message', ev => this.onRaw(String(ev.data), token));
    this.ws.addEventListener('close', () => { this.closed = true; this.wake(); });
    this.ws.addEventListener('error', () => { this.closed = true; this.wake(); });
  }
  static async open(token) { const c = new Stomp(token); await c.waitFor(f => f.command === 'CONNECTED' || f.command === 'ERROR', 10000); return c; }
  onRaw(data, token) {
    if (data === 'o') return this.send('CONNECT', { 'accept-version': '1.2', 'heart-beat': '0,0', ...(token ? { Authorization: 'Bearer ' + token } : {}) });
    if (data.startsWith('a')) {
      for (const raw of JSON.parse(data.slice(1))) {
        const [head, ...rest] = raw.split('\n\n');
        const [command, ...lines] = head.split('\n');
        if (!command) continue; // heart-beat
        const headers = Object.fromEntries(lines.map(l => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1)]));
        this.frames.push({ command, headers, body: rest.join('\n\n').replace(/\0$/, '') });
      }
      this.wake();
    }
    if (data.startsWith('c')) { this.closed = true; this.wake(); }
  }
  send(command, headers = {}, body = '') {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    const frame = command + '\n' + Object.entries(headers).map(([k, v]) => `${k}:${v}`).join('\n') + '\n\n' + body + '\0';
    this.ws.send(JSON.stringify([frame]));
  }
  subscribe(destination) { this.send('SUBSCRIBE', { id: 'sub-' + destination, destination }); }
  wake() { for (const w of this.waiters.splice(0)) w(); }
  async waitFor(pred, ms) {
    const until = Date.now() + ms;
    for (;;) {
      const hit = this.frames.find(pred);
      if (hit || Date.now() >= until) return hit;
      if (this.closed && !hit) { await sleep(50); const late = this.frames.find(pred); if (late || this.closed) return late; }
      await new Promise(r => { this.waiters.push(r); setTimeout(r, Math.min(500, until - Date.now())); });
    }
  }
  messages(dest) { return this.frames.filter(f => f.command === 'MESSAGE' && f.headers.destination === dest); }
  disconnect() { this.send('DISCONNECT'); this.ws.close(); }
}

async function settle(sid, token) {
  for (let i = 0; i < 60; i++) {
    const list = await call('GET', `/api/projects/services/${sid}/deployments`, undefined, token);
    if (!list.some(d => ['QUEUED', 'BUILDING', 'DEPLOYING'].includes(d.status))) return;
    await sleep(1000);
  }
  throw new Error('deployment did not settle');
}
async function deploy(sid, token) { await settle(sid, token); await call('POST', `/api/projects/services/${sid}/deploy`, {}, token, 202).catch(async e => {
  if (!/expected 202, got 200/.test(e.message)) throw e; }); }

function liveTokens() {
  const out = execFileSync('docker', ['exec', lab.prefix + '-api', 'jcmd', '1', 'GC.class_histogram'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const line = out.split('\n').find(l => l.trim().endsWith('org.springframework.security.authentication.UsernamePasswordAuthenticationToken'));
  return line ? Number(line.trim().split(/\s+/)[1]) : 0;
}

// --- fixtures: two synthetic tenants with deploy access, one docker service ------------------------
const adminToken = await login('admin@cloudbase.test');
const admin = await call('GET', '/api/auth/me', undefined, adminToken);
await call('PATCH', `/api/admin/users/${admin.id}/deployment-access`, { enabled: true }, adminToken);
const users = {};
for (const role of ['ws-owner', 'ws-other']) {
  const r = await call('POST', '/api/auth/register', { name: role, email: role + '@cloudbase.test', password: PASSWORD });
  await call('PATCH', `/api/admin/users/${r.user.id}/deployment-access`, { enabled: true }, adminToken);
  users[role] = { id: r.user.id, email: role + '@cloudbase.test' };
}
let ownerToken = await login(users['ws-owner'].email);
const otherToken = await login(users['ws-other'].email);
const project = await call('POST', '/api/projects', { name: 'ws-events', description: 'synthetic' }, ownerToken, 201);
const svc = await call('POST', `/api/projects/${project.id}/services`, { name: 'ws-nginx', sourceType: 'DOCKER',
  sourceDetails: { imageName: 'nginx', imageTag: 'alpine', containerPort: 80 }, quota: { memoryMb: 64, cpuMilli: 100, storageGb: 0 } }, ownerToken, 201);
const topic = `/topic/deployments/${svc.id}`;
const baseline = liveTokens();

// 1. owner receives its own events
const owner = await Stomp.open(ownerToken);
check('owner CONNECT accepted', owner.frames.some(f => f.command === 'CONNECTED'));
owner.subscribe(topic);
await sleep(500);
check('owner subscription to own service accepted', !owner.closed && !owner.frames.some(f => f.command === 'ERROR'));
await deploy(svc.id, ownerToken);
check('owner receives its deployment event over the real broker', !!(await owner.waitFor(f => f.command === 'MESSAGE' && f.headers.destination === topic, 60000)));

// 2. another tenant cannot receive them
const other = await Stomp.open(otherToken);
check('other tenant CONNECT accepted', other.frames.some(f => f.command === 'CONNECTED'));
other.subscribe(topic);
check('other tenant subscription to owner service rejected with ERROR', !!(await other.waitFor(f => f.command === 'ERROR', 5000)));
await sleep(500);
check('rejected session is closed', other.closed);
const otherProbe = await Stomp.open(otherToken);
otherProbe.send('SEND', { destination: topic }, '{"forged":true}');
check('client SEND to the event topic is refused', !!(await otherProbe.waitFor(f => f.command === 'ERROR', 5000)));
check('other tenant never received an owner event', other.messages(topic).length === 0 && otherProbe.messages(topic).length === 0);

// 3. suspension stops delivery and closes the open session; deactivation blocks new sessions
const before = owner.messages(topic).length;
await call('PATCH', `/api/admin/users/${users['ws-owner'].id}/account-status`, { accountStatus: 'SUSPENDED' }, adminToken);
await deploy(svc.id, adminToken);
check('suspended owner session gets ERROR on next delivery', !!(await owner.waitFor(f => f.command === 'ERROR', 60000)));
await sleep(500);
check('suspended owner session is closed', owner.closed);
check('suspended owner received no further events', owner.messages(topic).length === before);
const suspendedRetry = await Stomp.open(ownerToken);
check('suspended owner cannot open a new session', suspendedRetry.frames.some(f => f.command === 'ERROR') && !suspendedRetry.frames.some(f => f.command === 'CONNECTED'));
await call('PATCH', `/api/admin/users/${users['ws-owner'].id}/account-status`, { accountStatus: 'PENDING_ACTIVATION' }, adminToken);
const pendingRetry = await Stomp.open(ownerToken);
check('deactivated owner cannot open a new session', pendingRetry.frames.some(f => f.command === 'ERROR'));
await call('PATCH', `/api/admin/users/${users['ws-owner'].id}/account-status`, { accountStatus: 'ACTIVE' }, adminToken);
// Leaving ACTIVE revoked Deploy by design; an admin grants it again explicitly.
await call('PATCH', `/api/admin/users/${users['ws-owner'].id}/deployment-access`, { enabled: true }, adminToken);
ownerToken = await login(users['ws-owner'].email);
const restored = await Stomp.open(ownerToken);
restored.subscribe(topic);
await sleep(500);
await deploy(svc.id, ownerToken);
check('reactivated owner receives events again on a new session', !!(await restored.waitFor(f => f.command === 'MESSAGE' && f.headers.destination === topic, 60000)));
restored.disconnect();

// 4. token expiry and reconnect (logout is client-side: a JWT stays valid until it expires)
const expiresAt = Date.now() + lab.jwtExpirationMs;
const expiring = await Stomp.open(ownerToken);
expiring.subscribe(topic);
await sleep(Math.max(0, expiresAt - Date.now()) + 2000);
await deploy(svc.id, await login('admin@cloudbase.test')); // the earlier admin token expired as well
check('expired-token session gets ERROR instead of the event', !!(await expiring.waitFor(f => f.command === 'ERROR', 60000)) && expiring.messages(topic).length === 0);
const expiredRetry = await Stomp.open(ownerToken);
check('reconnect with the expired token is refused', expiredRetry.frames.some(f => f.command === 'ERROR'));
ownerToken = await login(users['ws-owner'].email);
const renewed = await Stomp.open(ownerToken);
renewed.subscribe(topic);
await sleep(500);
await deploy(svc.id, ownerToken);
check('reconnect after signing in again receives events', !!(await renewed.waitFor(f => f.command === 'MESSAGE' && f.headers.destination === topic, 60000)));
renewed.disconnect();

// 4b. a password change signs out other sessions, including open WebSockets
const beforeChange = await Stomp.open(ownerToken);
beforeChange.subscribe(topic);
await sleep(500);
const changed = await call('POST', '/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'Changed-Ws!2026' }, ownerToken);
await deploy(svc.id, changed.token);
check('open session from before a password change gets ERROR, not the event',
  !!(await beforeChange.waitFor(f => f.command === 'ERROR', 60000)) && beforeChange.messages(topic).length === 0);
check('token from before the password change cannot reconnect', (await Stomp.open(ownerToken)).frames.some(f => f.command === 'ERROR'));
ownerToken = changed.token;
const afterChange = await Stomp.open(ownerToken);
check('token returned by the password change connects', afterChange.frames.some(f => f.command === 'CONNECTED'));
afterChange.disconnect();
await call('POST', '/api/auth/change-password', { currentPassword: 'Changed-Ws!2026', newPassword: PASSWORD }, ownerToken)
  .then(r => { ownerToken = r.token; });

// 5. session identities are released on disconnect (clean DISCONNECT and plain socket close)
await sleep(1500);
const idle = liveTokens();
const many = [];
for (let i = 0; i < 12; i++) many.push(await Stomp.open(ownerToken));
const open = liveTokens();
many.forEach((c, i) => (i % 2 ? c.ws.close() : c.disconnect()));
await sleep(3000);
const after = liveTokens();
check(`12 open sessions are held while connected (live tokens ${idle} -> ${open})`, open >= idle + 12);
check(`all session identities released after disconnect (live tokens ${open} -> ${after}, baseline ${baseline})`, after <= idle);

const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} WebSocket checks passed`);
process.exit(passed === results.length ? 0 : 1);
