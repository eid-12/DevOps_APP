const assert = require('node:assert/strict');
const { deployMaps, TARGET, PROJECT, REPOSITORY } = require('./core.cjs');
const release = 'b'.repeat(40), digest = 'sha256:' + '2'.repeat(64);
const oldRef = REPOSITORY + ':legacy', oldDigest = REPOSITORY + '@sha256:' + '1'.repeat(64);
const oldId = 'sha256:' + 'a'.repeat(64), newId = 'sha256:' + 'b'.repeat(64);
const desired = `${REPOSITORY}:${release}@${digest}`;
const original = `services:\n  frontend:\n    image: ${oldRef}\n    environment:\n      - FEATURE=enabled\n  database:\n    image: mysql:8\n    volumes:\n      - database:/var/lib/mysql\nvolumes:\n  database:\n`;
const copy = value => JSON.parse(JSON.stringify(value));

function fixture(options = {}) {
  const state = { source: options.ambiguous ? original + `  extra:\n    image: ${oldRef}\n` : original, ref: oldRef, frontId: 'front-old', imageId: oldId, puts: [], putCalls:0, records: [], env: options.nullEnv ? null : [{name:'DB_PASSWORD',value:'SECRET-test-only'}] };
  const stack = () => ({Id:7,Name:PROJECT,EndpointId:3,Type:2,GitConfig:options.gitManaged ? {URL:'https://example.test/repo'} : null,Env:copy(state.env)});
  const list = () => [
    {Id:state.frontId,Names:['/'+TARGET],Image:state.ref,State:'running',Labels:{'com.docker.compose.project':PROJECT,'com.docker.compose.service':'frontend'}},
    {Id:options.peerChanged && state.puts.length ? 'database-external' : 'database',Names:['/database'],Image:options.shared ? oldRef : 'mysql:8',State:'running',Labels:{'com.docker.compose.project':PROJECT,'com.docker.compose.service':'database'}}
  ];
  const api = async (method, route, body) => {
    if (method === 'GET' && route === '/stacks') return [stack()];
    if (method === 'GET' && route === '/stacks/7') return stack();
    if (method === 'GET' && route === '/stacks/7/file') return {StackFileContent:state.source};
    if (route.includes('/containers/json')) return list();
    if (route.includes('/containers/')) return {Id:state.frontId,Image:state.imageId,Config:{Image:state.ref,Labels:{'com.docker.compose.project':PROJECT,'com.docker.compose.service':'frontend'}},State:{Status:'running',Restarting:false},RestartCount:0};
    if (method === 'POST' && route.includes('/images/create')) {
      if (options.preflightChange) state.source += '# operator edit\n';
      return null;
    }
    if (route.includes('/images/')) {
      const ref = decodeURIComponent(route.split('/images/')[1].replace(/\/json$/, ''));
      return ref === oldId ? {Id:oldId,RepoDigests:options.noRollback ? [] : [oldDigest]} : {Id:newId,Config:{Labels:{'org.opencontainers.image.revision':options.wrongRevision ? 'c'.repeat(40) : release}}};
    }
    if (method === 'PUT' && route === '/stacks/7?endpointId=3') {
      state.putCalls++;
      if (options.notApplied) throw Error('transport failure before update');
      assert.equal(body.Prune, false); assert.equal(body.PullImage, false); assert.deepEqual(body.Env, state.env);
      const expected = body.StackFileContent.includes(desired) ? original.replace(oldRef,desired) : original.replace(oldRef,oldDigest);
      assert.equal(body.StackFileContent, expected, 'Only the frontend image field may change');
      state.puts.push(copy(body)); state.source = body.StackFileContent;
      const newRelease = state.source.includes(desired);
      state.ref = newRelease ? desired : oldDigest; state.imageId = newRelease ? newId : oldId; state.frontId = newRelease ? 'front-new' : 'front-restored';
      if (options.operatorChange && newRelease) state.source += '# external edit\n';
      if (options.lostResponse && state.puts.length === 1) throw Error('transport failure');
      return stack();
    }
    throw Error('Unexpected test API operation');
  };
  const config = { release, digest, api, publicHealthy:async localized => !localized || (state.imageId === newId && !options.unhealthy), sleep:async()=>{}, stableChecks:1, attempts:2, record:record=>state.records.push(record) };
  return {state,config};
}

(async()=>{
  {const f=fixture();const result=await deployMaps(f.config);assert.equal(result.status,'deployed');assert.equal(result.unchangedOtherServices,1);assert.equal(f.state.puts.length,1);assert.ok(!JSON.stringify(f.state.records).includes('SECRET-'));console.log('PASS: frontend-only rollout, environment preservation and safe evidence');}
  {const f=fixture({nullEnv:true});assert.equal((await deployMaps(f.config)).status,'deployed');assert.equal(f.state.puts[0].Env,null);console.log('PASS: empty/null stack environment remains unchanged');}
  {const f=fixture({unhealthy:true});await assert.rejects(deployMaps(f.config),/previous immutable frontend was restored/);assert.equal(f.state.puts.length,2);assert.equal(f.state.ref,oldDigest);console.log('PASS: failing new frontend rolls back to the immutable previous image');}
  {const f=fixture({lostResponse:true});assert.equal((await deployMaps(f.config)).status,'deployed');assert.equal(f.state.puts.length,1);console.log('PASS: lost update response reconciles without a duplicate write');}
  {const f=fixture({wrongRevision:true});await assert.rejects(deployMaps(f.config),/revision differs/);assert.equal(f.state.puts.length,0);console.log('PASS: wrong image revision refused before any stack update');}
  {const f=fixture({shared:true});await assert.rejects(deployMaps(f.config),/shares the frontend image/);assert.equal(f.state.puts.length,0);console.log('PASS: shared image reference refused');}
  {const f=fixture({preflightChange:true});await assert.rejects(deployMaps(f.config),/changed during preflight/);assert.equal(f.state.puts.length,0);console.log('PASS: operator changes during image pull are preserved');}
  {const f=fixture({operatorChange:true});await assert.rejects(deployMaps(f.config),/outside this rollout/);assert.equal(f.state.puts.length,1);assert.ok(f.state.source.includes('external edit'));console.log('PASS: concurrent operator change prevents blind rollback');}
  {const f=fixture({peerChanged:true});await assert.rejects(deployMaps(f.config),/Other service containers changed/);assert.equal(f.state.puts.length,1);console.log('PASS: backend/container changes stop further mutation');}
  {const f=fixture({ambiguous:true});await assert.rejects(deployMaps(f.config),/ambiguous Compose change/);assert.equal(f.state.putCalls,0);console.log('PASS: ambiguous Compose image references refused');}
  {const f=fixture({gitManaged:true});await assert.rejects(deployMaps(f.config),/Git-managed/);assert.equal(f.state.putCalls,0);console.log('PASS: Git-managed stack is not overwritten');}
  {const f=fixture({noRollback:true});await assert.rejects(deployMaps(f.config),/No immutable rollback image/);assert.equal(f.state.putCalls,0);console.log('PASS: unavailable rollback image prevents deployment');}
  {const f=fixture({notApplied:true});await assert.rejects(deployMaps(f.config),/no blind retry or rollback/);assert.equal(f.state.putCalls,1);assert.equal(f.state.source,original);console.log('PASS: unapplied/lost response does not cause blind repeat writes');}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
