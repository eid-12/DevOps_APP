// Synthetic infrastructure only: this process never contacts Docker, GitHub, NPM or a registry.
// Stateful: created stacks yield "running" containers, so real deploy logic can finish successfully.
// A file /tmp/fail-delete makes stack deletion fail (partial-failure tests). /tmp/slow-deploy delays stack creation.
// Network, standalone-container and exec calls are recorded in order (GET /_ops) so a test can replay exactly what
// the API asked for on a real Docker engine (tests/local/network_isolation.py).
const http = require('node:http');
const fs = require('node:fs');
let nextId = 100;
const stacks = new Map(); // id -> { Id, Name, containers: [names] }
const created = new Map(); // standalone containers (the edge): name -> { body, running }
const containers = () => [...stacks.values()].flatMap(s => s.containers).concat([...created.keys()]);
const networks = new Map(); // name -> Set of member container names
const subnets = new Map(); // name -> CIDR reported in IPAM
const ops = [];
const repos = {};
const stopped = new Set(); // stack containers stopped through the API
// Isolation probes (cb-probe-*) exit at once; their output says EXPOSED while /tmp/guard-off exists.
const probeOutput = () => (fs.existsSync('/tmp/guard-off') ? 'EXPOSED' : 'BLOCKED') + String.fromCharCode(10) + 'CONTROL_OK' + String.fromCharCode(10);
const frame = s => { const b = Buffer.from(s); const h = Buffer.alloc(8); h[0] = 1; h.writeUInt32BE(b.length, 4); return Buffer.concat([h, b]); }; // "owner/repo" -> { files: {path: base64}, hooks: [bodies] }
const networkBody = name => ({ Name: name, IPAM: { Config: [{ Subnet: subnets.get(name) }] },
  Containers: Object.fromEntries([...networks.get(name)].map((m, i) => ['c' + i, { Name: m }])) });
const addNetwork = name => { networks.set(name, new Set()); if (!subnets.has(name)) subnets.set(name, `10.200.${networks.size}.0/24`); };
http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://mock');
    const path = url.pathname;
    // Every external call, for tests that must prove what did (not) reach the infrastructure.
    if (!path.startsWith('/_')) fs.appendFileSync('/tmp/calls.log', JSON.stringify({ t: Date.now(), m: req.method, path }) + '\n');
    let code = 200, body = {};
    const send = () => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(code === 204 ? undefined : JSON.stringify(body)); };
    const json = () => JSON.parse(raw || '{}');
    const net = path.match(/\/docker\/networks\/([^/]+)(\/connect|\/disconnect)?$/);
    // GitHub repository permissions: the lab user may push to local-qa/* and shared-team/* (write collaborator);
    // any other owner's repository is visible read-only, and owner "private" is not visible at all.
    const gh = path.match(/^\/github\/repos\/([^/]+)\/([^/]+)$/);
    if (gh && req.method === 'GET') {
      const [, owner, repo] = gh;
      if (!req.headers.authorization || owner === 'private') { code = 404; body = { message: 'Not Found' }; }
      else body = { full_name: `${owner}/${repo}`, permissions: { admin: owner === 'local-qa', push: owner === 'local-qa' || owner === 'shared-team', pull: true } };
      return send();
    }
    // With /tmp/github-writable, repository contents and hooks behave like GitHub (stored, listed); otherwise 404,
    // so CI provisioning fails as it always did in the lab. Hooks are appended as sent: duplicates stay visible.
    const ghx = path.match(/^\/github\/repos\/([^/]+)\/([^/]+)\/(contents\/.+|hooks)$/);
    if (ghx && fs.existsSync('/tmp/github-writable')) {
      const key = `${ghx[1]}/${ghx[2]}`;
      repos[key] ??= { files: {}, hooks: [] };
      if (ghx[3] === 'hooks') {
        if (req.method === 'POST') { repos[key].hooks.push(json()); code = 201; body = { id: repos[key].hooks.length }; }
        else body = repos[key].hooks;
      } else if (req.method === 'PUT') { repos[key].files[ghx[3]] = json().content; code = 201; body = { content: { sha: 'sha-' + Date.now() } }; }
      else if (repos[key].files[ghx[3]]) body = { sha: 'sha-1', content: repos[key].files[ghx[3]], encoding: 'base64' };
      else { code = 404; body = { message: 'Not Found' }; }
      return send();
    }
    if (path === '/_github') body = repos;
    else if (path === '/_stacks') body = [...stacks.values()];
    else if (path === '/_networks') body = Object.fromEntries([...networks].map(([n, m]) => [n, [...m]]));
    else if (path === '/_ops') body = ops;
    else if (path === '/_stopped') body = [...stopped];
    // Test hooks: POST /_subnet/<net>/<a.b.c.d>/<bits> sets the CIDR a network reports (to match a real engine);
    // POST /_forget/<container> drops a standalone container and its memberships (as if removed on the host);
    // POST|DELETE /_networks/<net>/<container> adds or removes a member (e.g. a platform container, a recreated proxy).
    else if (req.method === 'POST' && path.startsWith('/_subnet/')) {
      const [, , name, ip, bits] = path.split('/');
      subnets.set(name, `${ip}/${bits}`);
    } else if (req.method === 'POST' && path.startsWith('/_forget/')) {
      const name = path.split('/')[2];
      created.delete(name);
      for (const m of networks.values()) m.delete(name);
    } else if (path.startsWith('/_networks/') && (req.method === 'POST' || req.method === 'DELETE')) {
      const [, , name, member] = path.split('/');
      if (!networks.has(name)) addNetwork(name);
      if (req.method === 'POST') networks.get(name).add(member); else networks.get(name).delete(member);
    } else if (req.method === 'POST' && path.endsWith('/networks/create')) {
      const name = json().Name;
      if (networks.has(name)) { code = 409; body = { message: 'network already exists' }; }
      else { addNetwork(name); ops.push({ op: 'network-create', name, labels: json().Labels, options: json().Options }); body = { Id: name }; }
    } else if (net && net[1] !== 'create' && req.method === 'POST' && net[2]) {
      const container = json().Container;
      if (!networks.has(net[1])) { code = 404; body = { message: 'No such network' }; }
      else if (net[2] === '/connect') { networks.get(net[1]).add(container); ops.push({ op: 'connect', net: net[1], container, gwPriority: json().EndpointConfig?.GwPriority }); }
      else { networks.get(net[1]).delete(container); ops.push({ op: 'disconnect', net: net[1], container }); }
    } else if (net && req.method === 'GET' && !net[2]) {
      if (networks.has(net[1])) body = networkBody(net[1]);
      else { code = 404; body = { message: 'No such network' }; }
    }
    else if (req.method === 'POST' && path.endsWith('/containers/create')) {
      const name = url.searchParams.get('name');
      const b = json();
      created.set(name, { body: b, running: false });
      const mode = b.HostConfig?.NetworkMode;
      if (mode && networks.has(mode)) networks.get(mode).add(name);
      ops.push({ op: 'create', name, body: b });
      body = { Id: name };
    } else if (req.method === 'POST' && /\/containers\/[^/]+\/start$/.test(path)) {
      const name = path.split('/').at(-2);
      if (created.has(name)) { created.get(name).running = !name.startsWith('cb-probe-'); ops.push({ op: 'start', name }); }
      stopped.delete(name);
      code = 204;
    } else if (req.method === 'POST' && /\/containers\/[^/]+\/stop$/.test(path)) {
      const name = path.split('/').at(-2);
      if (created.has(name)) created.get(name).running = false; else stopped.add(name);
      ops.push({ op: 'stop', name });
      code = 204;
    } else if (req.method === 'GET' && /\/containers\/cb-probe-[^/]+\/logs$/.test(path)) {
      res.writeHead(200, { 'content-type': 'application/vnd.docker.raw-stream' });
      return res.end(frame(probeOutput()));
    } else if (req.method === 'POST' && /\/containers\/[^/]+\/exec$/.test(path)) {
      const container = path.split('/').at(-2);
      ops.push({ op: 'exec', container, cmd: json().Cmd });
      body = { Id: 'exec-' + ops.length };
    } else if (req.method === 'POST' && /\/exec\/[^/]+\/start$/.test(path)) {
      if (fs.existsSync('/tmp/fail-exec')) { code = 500; body = { message: 'synthetic exec failure' }; return send(); }
      res.writeHead(200, { 'content-type': 'application/vnd.docker.raw-stream' });
      return res.end();
    }
    else if (req.method === 'GET' && path === '/api/status') body = { Version: 'local-test-stub' };
    else if (req.method === 'GET' && path === '/api/stacks') body = [...stacks.values()].map(({ Id, Name }) => ({ Id, Name, EndpointId: 1 }));
    else if (req.method === 'GET' && /\/containers\/json$/.test(path)) body = containers().map(n => ({ Id: n, Names: ['/' + n], State: 'running', Status: 'Up', Image: 'synthetic' }));
    else if (req.method === 'GET' && /\/containers\/[^/]+\/json$/.test(path)) {
      const n = path.split('/').at(-2);
      const c = created.get(n);
      const nets = Object.fromEntries([...networks].filter(([, m]) => m.has(n)).map(([net], i) => [net, { IPAddress: (subnets.get(net) || '10.9.9.0/24').replace(/\.0\/\d+$/, '.' + (10 + i)) }]));
      if (c) body = { Id: n, Name: '/' + n, Config: { Labels: c.body.Labels ?? {} }, NetworkSettings: { Networks: nets },
        State: { Status: c.running ? 'running' : 'exited', Running: c.running }, RestartCount: 0 };
      else if (containers().includes(n)) body = { Id: n, Name: '/' + n, NetworkSettings: { Networks: nets },
        State: { Status: stopped.has(n) ? 'exited' : 'running', Running: !stopped.has(n) }, RestartCount: 0 };
      else { code = 404; body = { message: 'No such container' }; }
    } else if (req.method === 'GET' && /\/(registries|networks)$/.test(path)) body = [];
    else if (req.method === 'GET' && path === '/api/endpoints/1') body = { Id: 1, Snapshots: [] };
    else if (req.method === 'GET' && path.endsWith('/info')) body = { NCPU: 1, MemTotal: 268435456 };
    else if (req.method === 'POST' && path.includes('/stacks/create/')) {
      const b = json();
      const names = [...String(b.stackFileContent ?? b.StackFileContent ?? '').matchAll(/container_name:\s*"?([\w.-]+)/g)].map(m => m[1]);
      const s = { Id: nextId++, Name: b.name ?? b.Name, containers: names };
      stacks.set(s.Id, s);
      body = { Id: s.Id, Name: s.Name };
      if (fs.existsSync('/tmp/slow-deploy')) return setTimeout(send, 8000);
    } else if (req.method === 'POST' && path.endsWith('/images/create')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ status: 'Status: Downloaded newer image for synthetic' }) + String.fromCharCode(10));
    } else if (req.method === 'PUT' && /\/api\/stacks\/\d+/.test(path)) {
      body = stacks.get(Number(path.split('/').at(-1))) ?? {};
      if (fs.existsSync('/tmp/slow-deploy')) return setTimeout(send, 20000);
    } else if (req.method === 'DELETE' && /\/api\/stacks\/\d+/.test(path)) {
      if (fs.existsSync('/tmp/fail-delete')) { code = 500; body = { message: 'synthetic delete failure' }; }
      else { stacks.delete(Number(path.split('/').at(-1))); code = 204; }
    } else if (req.method === 'DELETE' && /\/containers\/[^/]+$/.test(path) && created.has(path.split('/').at(-1))) {
      const name = path.split('/').at(-1);
      created.delete(name);
      for (const m of networks.values()) m.delete(name);
      ops.push({ op: 'remove', name });
      code = 204;
    } else if (req.method === 'DELETE') code = 204;
    else { code = 404; body = { message: 'Not present in isolated test infrastructure' }; }
    send();
  });
}).listen(9000, '0.0.0.0');
// The public site the deploy verification probes (network alias app.cloudbase.test).
http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><title>Synthetic</title><h1>Synthetic application page for local tests</h1>');
}).listen(80, '0.0.0.0');
// DNS TXT stand-in for custom-domain ownership checks (the API is pointed here with CLOUDBASE_DOMAINS_DNS_SERVER).
// Records are set over HTTP: POST /_dns/<name>/<value> adds a TXT value, DELETE /_dns/<name> removes the name.
const dgram = require('node:dgram');
const dnsRecords = new Map();
http.createServer((req, res) => {
  const [, , name, value] = new URL(req.url, 'http://mock').pathname.split('/');
  const key = (name || '').toLowerCase();
  if (req.method === 'POST') { if (!dnsRecords.has(key)) dnsRecords.set(key, []); dnsRecords.get(key).push(decodeURIComponent(value)); }
  else if (req.method === 'DELETE') dnsRecords.delete(key);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(Object.fromEntries(dnsRecords)));
}).listen(9053, '0.0.0.0');
const dns = dgram.createSocket('udp4');
dns.on('message', (q, rinfo) => {
  let i = 12; const labels = [];
  while (q[i] !== 0) { const n = q[i++]; labels.push(q.subarray(i, i + n).toString('ascii')); i += n; }
  const questionEnd = i + 5;
  const values = dnsRecords.get(labels.join('.').toLowerCase()) || [];
  const head = Buffer.from([q[0], q[1], 0x81, values.length ? 0x80 : 0x83, 0, 1, 0, values.length, 0, 0, 0, 0]);
  const answers = values.map(v => { const t = Buffer.from(v, 'ascii');
    return Buffer.concat([Buffer.from([0xc0, 12, 0, 16, 0, 1, 0, 0, 0, 60, 0, t.length + 1, t.length]), t]); });
  dns.send(Buffer.concat([head, q.subarray(12, questionEnd), ...answers]), rinfo.port, rinfo.address);
});
dns.bind(53, '0.0.0.0');
