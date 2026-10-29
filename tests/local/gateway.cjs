const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/') || req.url.startsWith('/actuator/') || req.url.startsWith('/ws/')) {
    const headers = { ...req.headers, host: 'api:8080' };
    delete headers.origin;
    const upstream = http.request({ hostname: 'api', port: 8080, path: req.url, method: req.method, headers }, reply => {
      res.writeHead(reply.statusCode, reply.headers); reply.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end('Local API unavailable'); });
    req.pipe(upstream);
    return;
  }
  let file = path.resolve('/frontend', '.' + decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith('/frontend/')) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = '/frontend/index.html';
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
// STOMP over SockJS: pass WebSocket upgrades for /ws/ straight through to the API container.
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/ws/')) { socket.destroy(); return; }
  const upstream = net.connect(8080, 'api', () => {
    const forwarded = { ...req.headers, host: 'api:8080' };
    delete forwarded.origin; // same as the HTTP path above: the lab has one origin
    const headers = Object.entries(forwarded).map(([k, v]) => k + ': ' + v).join('\r\n');
    upstream.write(req.method + ' ' + req.url + ' HTTP/1.1\r\n' + headers + '\r\n\r\n');
    upstream.write(head);
    upstream.pipe(socket); socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});
server.listen(8080, '0.0.0.0');
