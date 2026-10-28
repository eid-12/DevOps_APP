// Minimal mock of the Portainer, GitHub compare and health endpoints used by deploy/portainer-deploy.sh.
// MODE=ok         new images come up healthy
// MODE=broken     new backend never passes the HTTP health checks -> script must roll back
// MODE=crashloop  new backend keeps restarting while "running" -> script must roll back
// COMPARE=ahead|behind|identical|diverged  GitHub compare status of deployed...new
// GET /_puts returns what each stack update sent (without the env values).
const http = require('http');
const MODE = process.env.MODE || 'ok';
const PORT = Number(process.env.PORT || 8080);
const OLD_SHA = 'a'.repeat(40);
let file = [
  'services:',
  '  postgres:',
  '    image: postgres:16-alpine',
  '    volumes:',
  '      - data:/var/lib/postgresql/data',
  '  backend:',
  `    image: minipcer/cloudbase-backend:${OLD_SHA}@sha256:${'1'.repeat(64)}`,
  '    environment:',
  '      DB_PASS: ${DB_PASS}',
  '  frontend:',
  `    image: minipcer/cloudbase-frontend:${OLD_SHA}@sha256:${'2'.repeat(64)}`,
  'volumes:',
  '  data:',
  ''
].join('\n');
const env = [{ name: 'DB_PASS', value: 'SECRET-DB-VALUE' }, { name: 'JWT_SECRET', value: 'SECRET-JWT-VALUE' }];
const puts = [];
let restarts = 0;
const img = name => (file.match(new RegExp(`image:\\s*(\\S*cloudbase-${name}\\S*)`)) || [])[1];
const rev = () => (img('backend').match(/:([0-9a-f]{40})@/) || [])[1];
const newDeployed = () => !img('backend').includes(OLD_SHA);

http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c)).on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    const u = req.url;
    if (u.startsWith('/github/')) return send(200, { status: process.env.COMPARE || 'ahead' });
    if (u === '/_puts') return send(200, puts);
    if (u.startsWith('/api/') && req.headers['x-api-key'] !== 'test-key') return send(401, { message: 'bad key' });
    if (u === '/api/stacks/44' && req.method === 'GET') return send(200, { Id: 44, Name: 'cloudbase-platform', EndpointId: 3, Env: env });
    if (u === '/api/stacks/44/file') return send(200, { StackFileContent: file });
    if (u.startsWith('/api/stacks/44?endpointId=3') && req.method === 'PUT') {
      const b = JSON.parse(body);
      puts.push({
        envPreserved: JSON.stringify(b.Env) === JSON.stringify(env),
        prune: b.Prune, pull: b.PullImage,
        backend: (b.StackFileContent.match(/cloudbase-backend\S*/) || [])[0],
        volumesKept: b.StackFileContent.includes('data:/var/lib/postgresql/data'),
        postgresUntouched: b.StackFileContent.includes('image: postgres:16-alpine')
      });
      file = b.StackFileContent;
      restarts = 0;
      return send(200, { Id: 44 });
    }
    const m = u.match(/^\/api\/endpoints\/3\/docker\/containers\/cloudbase-(backend|frontend|postgres)\/json$/);
    if (m) {
      if (m[1] === 'postgres') return send(200, { Config: { Image: 'postgres:16-alpine', Labels: {} }, State: { Status: 'running', Health: { Status: 'healthy' } }, RestartCount: 0 });
      const crashing = MODE === 'crashloop' && m[1] === 'backend' && newDeployed();
      if (crashing) restarts++;
      return send(200, { Config: { Image: img(m[1]), Labels: { 'org.opencontainers.image.revision': rev() } }, State: { Status: 'running' }, RestartCount: crashing ? restarts : 0 });
    }
    const healthy = !(MODE === 'broken' && newDeployed());
    if (u === '/health/api/public/app-config') return send(healthy ? 200 : 503, {});
    if (u === '/health/api/auth/me') return send(healthy ? 401 : 503, {});
    if (u === '/health/web/') return send(200, {});
    send(404, { u });
  });
}).listen(PORT, () => console.log(`mock portainer on :${PORT} (${MODE})`));
