const assert = require('node:assert/strict');
const allowed = /^minipcer\/(cloudbase-frontend|cloudbase-backend|mapping-frontend)(?=[:@])/;
function eligible(image, containers) {
  const refs = [...(image.RepoTags || []), ...(image.RepoDigests || [])].filter(x => x !== '<none>:<none>');
  return /^sha256:[a-f0-9]{64}$/.test(image.Id) && refs.length > 0 && refs.every(x => allowed.test(x)) && !containers.some(c => c.ImageID === image.Id);
}
if (process.argv.includes('--test')) {
  const image = {Id:'sha256:'+'a'.repeat(64),RepoTags:['minipcer/cloudbase-frontend:old']};
  assert(eligible(image, []));
  assert(!eligible(image, [{ImageID:image.Id,State:'exited'}]));
  assert(!eligible({...image,RepoTags:['mysql:8']}, []));
  assert(!eligible({...image,RepoDigests:['private/backup@sha256:x']}, []));
  assert(!eligible({...image,RepoTags:[]}, []));
  console.log('PASS: unused-only, stopped-container protection, repository allowlist and ambiguous-image refusal');
} else {
  (async () => {
    if (!process.env.PORTAINER_API_KEY) throw Error('Missing existing deployment credential');
    const headers = {'X-API-Key':process.env.PORTAINER_API_KEY};
    if(process.env.CF_ACCESS_CLIENT_ID) { headers['CF-Access-Client-Id']=process.env.CF_ACCESS_CLIENT_ID; headers['CF-Access-Client-Secret']=process.env.CF_ACCESS_CLIENT_SECRET; }
    async function api(method, route) {
      const r=await fetch('https://manage.cloudbase.website/api/endpoints/3/docker'+route,{method,headers,redirect:'error',signal:AbortSignal.timeout(30000)});
      if(!r.ok) throw Error('Cleanup request refused: HTTP '+r.status);
      return r.status===204?null:r.json();
    }
    for(const host of ['www','maps']) {
      const r=await fetch('https://'+host+'.cloudbase.website/',{signal:AbortSignal.timeout(15000)});
      if(r.status!==200) throw Error('Public health check failed; no cleanup attempted');
    }
    let removed=0;
    for(const image of await api('GET','/images/json?all=false')) {
      // Re-read all running AND stopped container references before each deletion.
      if(!eligible(image,await api('GET','/containers/json?all=true'))) continue;
      await api('DELETE','/images/'+image.Id+'?force=false&noprune=true');
      removed++; console.log('Removed unused allowlisted image '+image.Id);
    }
    console.log('Cleanup complete: '+removed+' images; containers, volumes and networks untouched');
  })().catch(e=>{console.error('::error::'+e.message);process.exitCode=1;});
}
