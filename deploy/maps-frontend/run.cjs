const fs = require('node:fs');
const path = require('node:path');
const { deployMaps, REPOSITORY } = require('./core.cjs');
const release = require('../maps-release.json').commit;
const origin = 'https://manage.cloudbase.website';
const web = 'https://maps.cloudbase.website';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let mutationAttempted = false;

async function publicJson(url) {
  const response = await fetch(url, {signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw Error('Public release metadata is not available (HTTP ' + response.status + ')');
  try { return await response.json(); } catch { throw Error('Invalid public release metadata'); }
}
async function api(method, route, body, stream = false) {
  if (!route.startsWith('/') || route.startsWith('//')) throw Error('Invalid Portainer route');
  if (!process.env.PORTAINER_API_KEY) throw Error('Missing existing Portainer deployment credential');
  const headers = {'Content-Type':'application/json','X-API-Key':process.env.PORTAINER_API_KEY};
  if (process.env.CF_ACCESS_CLIENT_ID) {
    headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID;
    headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET || '';
  }
  const tries = method === 'GET' && !mutationAttempted ? 6 : 1;
  if (method === 'PUT') mutationAttempted = true;
  for (let i = 0; i < tries; i++) {
    let response;
    try {
      response = await fetch(origin + '/api' + route, {method, headers, body:body ? JSON.stringify(body) : undefined, redirect:'error', signal:AbortSignal.timeout(method === 'PUT' || stream ? 180000 : 15000)});
    } catch {
      if (i + 1 < tries) { await sleep(5000); continue; }
      throw Error('Portainer transport unavailable');
    }
    if (!response.ok) {
      if (response.status >= 500 && i + 1 < tries) { await sleep(5000); continue; }
      throw Error('Portainer HTTP ' + response.status);
    }
    if (stream) {
      const text = await response.text();
      for (const line of text.split('\n').map(line => line.trim()).filter(Boolean)) {
        let item; try { item = JSON.parse(line); } catch { throw Error('Invalid image pull response'); }
        if (item.error || item.errorDetail) throw Error('Approved image could not be pulled; stack unchanged');
      }
      return null;
    }
    try { return await response.json(); } catch { throw Error('Invalid Portainer JSON response'); }
  }
}

(async () => {
  if (!/^[0-9a-f]{40}$/.test(release)) throw Error('Invalid approved Maps commit');
  const metadata = await publicJson(`https://raw.githubusercontent.com/eid-12/Wakeb-Project/${release}/client/src/public-site/home.json`);
  if (metadata.en?.url !== web + '/' || metadata.ar?.url !== web + '/ar/') throw Error('Release metadata points outside the approved site');
  const tag = await publicJson(`https://hub.docker.com/v2/repositories/${REPOSITORY}/tags/${release}/`);
  if (!/^sha256:[0-9a-f]{64}$/.test(tag.digest || '')) throw Error('Approved registry tag has no immutable digest');
  const evidence = path.resolve('maps-deployment.json');
  const record = value => {
    // Existing registry locations and stack environment values never enter public logs/artifacts.
    const safe = { ...value, previousImage: undefined, rollbackImage: undefined,
      rollbackDigest: value.rollbackImage?.match(/sha256:[0-9a-f]{64}$/)?.[0] };
    fs.writeFileSync(evidence, JSON.stringify({time:new Date().toISOString(),...safe},null,2));
    console.log('[maps-deploy] ' + value.status + ': ' + value.target);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `\n### Maps frontend: ${value.status}\n- Previous image ID: \`${value.previousImageId}\`\n- Rollback digest: \`${safe.rollbackDigest}\`\n- Target: \`${value.desiredImage}\`\n`);
  };
  const publicHealthy = async localized => {
    try {
      for (const language of localized ? ['en','ar'] : ['en']) {
        const url = language === 'ar' ? web + '/ar/' : web + '/';
        const response = await fetch(url,{signal:AbortSignal.timeout(10000),headers:{'Cache-Control':'no-cache'}});
        if (response.status !== 200) return false;
        if (localized) {
          const html = await response.text();
          if (!html.includes(metadata[language].title) || !html.includes(metadata[language].description) || !html.includes(`dir="${metadata[language].dir}"`)) return false;
        }
      }
      return true;
    } catch { return false; }
  };
  await deployMaps({release,digest:tag.digest,api,publicHealthy,sleep,record,stableChecks:4,attempts:30});
})().catch(error => { console.error('[maps-deploy] ' + error.message); process.exitCode = 1; });
