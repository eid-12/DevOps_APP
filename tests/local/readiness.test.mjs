import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { waitForApi } from './readiness.mjs';

async function server(t, handler) {
  const s = http.createServer(handler);
  await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
  t.after(() => { s.closeAllConnections(); s.close(); });
  return `http://127.0.0.1:${s.address().port}`;
}

test('waits through unavailable and DOWN before accepting UP', async t => {
  let calls = 0;
  const url = await server(t, (req, res) => {
    assert.equal(req.url, '/actuator/health');
    calls++;
    res.writeHead(calls === 1 ? 502 : 200);
    res.end(JSON.stringify({ status: calls >= 3 ? 'UP' : 'DOWN' }));
  });
  await waitForApi(url, { timeoutMs: 2000, intervalMs: 1 });
  assert.equal(calls, 3);
});

test('never falls through an exhausted readiness deadline', async t => {
  const url = await server(t, (_, res) => { res.writeHead(503); res.end('{"status":"DOWN"}'); });
  await assert.rejects(waitForApi(url, { timeoutMs: 100, intervalMs: 1 }), /INFRA:.*HTTP 503/);
});

test('bounds a hung response body as well as the connection', async t => {
  const url = await server(t, (_, res) => { res.writeHead(200); res.write('{'); });
  const start = performance.now();
  await assert.rejects(waitForApi(url, { timeoutMs: 150, probeMs: 30, intervalMs: 1 }), /INFRA:/);
  assert.ok(performance.now() - start < 2000);
});
