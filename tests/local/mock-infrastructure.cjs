// Synthetic infrastructure only: this process never contacts Docker, GitHub, NPM or a registry.
const http = require('node:http');
http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    const path = new URL(req.url, 'http://mock').pathname;
    let code = 200, body = {};
    if (req.method === 'GET' && path === '/api/status') body = { Version: 'local-test-stub' };
    else if (req.method === 'GET' && /\/(stacks|registries|containers\/json|networks)$/.test(path)) body = [];
    else if (req.method === 'GET' && path === '/api/endpoints/1') body = { Id: 1, Snapshots: [] };
    else if (req.method === 'GET' && path.endsWith('/info')) body = { NCPU: 1, MemTotal: 268435456 };
    else if (req.method === 'POST' && path.includes('/stacks/create/')) {
      code = 503; body = { message: 'Synthetic infrastructure unavailable: no runtime was created' };
    } else if (req.method === 'DELETE') code = 204;
    else { code = 404; body = { message: 'Not present in isolated test infrastructure' }; }
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(code === 204 ? undefined : JSON.stringify(body));
  });
}).listen(9000, '0.0.0.0');
