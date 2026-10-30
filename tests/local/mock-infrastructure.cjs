// Synthetic infrastructure only: this process never contacts Docker, GitHub, NPM or a registry.
// Stateful: created stacks yield "running" containers, so real deploy logic can finish successfully.
// A file /tmp/fail-delete makes stack deletion fail (partial-failure tests). /tmp/slow-deploy delays stack creation.
const http = require('node:http');
const fs = require('node:fs');
let nextId = 100;
const stacks = new Map(); // id -> { Id, Name, containers: [names] }
const containers = () => [...stacks.values()].flatMap(s => s.containers);
http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => (raw += c));
  req.on('end', () => {
    const path = new URL(req.url, 'http://mock').pathname;
    let code = 200, body = {};
    const send = () => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(code === 204 ? undefined : JSON.stringify(body)); };
    if (path === '/_stacks') body = [...stacks.values()];
    else if (req.method === 'GET' && path === '/api/status') body = { Version: 'local-test-stub' };
    else if (req.method === 'GET' && path === '/api/stacks') body = [...stacks.values()].map(({ Id, Name }) => ({ Id, Name, EndpointId: 1 }));
    else if (req.method === 'GET' && /\/containers\/json$/.test(path)) body = containers().map(n => ({ Id: n, Names: ['/' + n], State: 'running', Status: 'Up', Image: 'synthetic' }));
    else if (req.method === 'GET' && /\/containers\/[^/]+\/json$/.test(path)) {
      const n = path.split('/').at(-2);
      if (containers().includes(n)) body = { Id: n, Name: '/' + n, State: { Status: 'running', Running: true }, RestartCount: 0 };
      else { code = 404; body = { message: 'No such container' }; }
    } else if (req.method === 'GET' && /\/(registries|networks)$/.test(path)) body = [];
    else if (req.method === 'GET' && path === '/api/endpoints/1') body = { Id: 1, Snapshots: [] };
    else if (req.method === 'GET' && path.endsWith('/info')) body = { NCPU: 1, MemTotal: 268435456 };
    else if (req.method === 'POST' && path.includes('/stacks/create/')) {
      const b = JSON.parse(raw || '{}');
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
