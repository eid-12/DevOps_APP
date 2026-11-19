#!/usr/bin/env bash
set -euo pipefail
image="${1:?Pass the frontend image to test}"
container=cloudbase-locales-smoke
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$container" --add-host=cloudbase-backend:127.0.0.1 -p 127.0.0.1:3311:3000 "$image" >/dev/null
ready=false
for _ in $(seq 1 30); do
  if curl --silent --fail http://127.0.0.1:3311/ >/dev/null; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then docker logs "$container"; exit 1; fi
node <<'JS'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const locales = JSON.parse(fs.readFileSync('frontend/src/app/core/public-home.json', 'utf8'));
(async () => {
  for (const [language, route] of [['en', '/'], ['ar', '/ar/']]) {
    const response = await fetch('http://127.0.0.1:3311' + route);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const html = await response.text();
    assert.ok(html.includes(`lang="${language}"`));
    assert.ok(html.includes(`dir="${locales[language].dir}"`));
    assert.ok(html.includes('cb-dark'));
    assert.ok(html.includes(locales[language].description));
    for (const href of [locales.en.url, locales.ar.url]) assert.ok(html.includes(href));
    const entry = html.match(/<script[^>]+src="([^"]+)"/)[1];
    const asset = await fetch(new URL(entry, 'http://127.0.0.1:3311'));
    assert.equal(asset.status, 200);
  }
  const xml = await (await fetch('http://127.0.0.1:3311/sitemap.xml')).text();
  for (const locale of Object.values(locales)) assert.ok(xml.includes(`<loc>${locale.url}</loc>`));
  console.log('Localized CloudBase image serves both pages, assets, security/cache headers and sitemap.');
})().catch(error => { console.error(error); process.exitCode = 1; });
JS
