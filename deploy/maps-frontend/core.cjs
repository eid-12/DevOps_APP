const TARGET = 'wakeb-application-frontend-1';
const PROJECT = 'wakeb-application';
const ENDPOINT = 3;
const REPOSITORY = 'minipcer/mapping-frontend';
const equalEnv = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const docker = path => `/endpoints/${ENDPOINT}/docker${path}`;
const validDigest = value => /^sha256:[0-9a-f]{64}$/.test(value || '');
const fail = message => { throw new Error(message); };

function replaceImage(source, previous, next) {
  let count = 0;
  const changed = source.replace(/^([ \t]*image:[ \t]*)(["']?)([^"' \t\r\n#]+)\2([ \t]*(?:#[^\r\n]*)?)(\r?)$/gm,
    (line, prefix, quote, image, suffix, cr) => {
      if (image !== previous) return line;
      count++;
      return prefix + quote + next + quote + suffix + cr;
    });
  if (count !== 1) fail('Expected one literal frontend image reference; refusing an ambiguous Compose change');
  return changed;
}

async function deployMaps({ release, digest, api, publicHealthy, sleep, record = () => {}, stableChecks = 4, attempts = 30 }) {
  if (!/^[0-9a-f]{40}$/.test(release) || !validDigest(digest)) fail('Invalid release identity');
  const desired = `${REPOSITORY}:${release}@${digest}`;
  const list = () => api('GET', docker('/containers/json?all=true'));
  const target = containers => {
    const matches = containers.filter(c => c.Names?.includes('/' + TARGET));
    if (matches.length !== 1) fail('Expected exactly one Maps frontend container');
    return matches[0];
  };
  const inspect = id => api('GET', docker(`/containers/${id}/json`));
  const containers = await list();
  const before = await inspect(target(containers).Id);
  if (before.Config?.Labels?.['com.docker.compose.project'] !== PROJECT || before.Config?.Labels?.['com.docker.compose.service'] !== 'frontend') fail('Maps container ownership does not match the approved target');
  if (before.State?.Status !== 'running') fail('Existing Maps frontend is not running; no change attempted');
  const stacks = await api('GET', '/stacks');
  const matches = stacks.filter(s => s.Name === PROJECT && s.EndpointId === ENDPOINT);
  if (matches.length !== 1) fail('Expected exactly one matching Maps stack');
  const stack = await api('GET', `/stacks/${matches[0].Id}`);
  if (stack.Type !== 2 || stack.EndpointId !== ENDPOINT || stack.GitConfig) fail('Unsupported or Git-managed Maps stack; use its configured deployment path');
  if (stack.Env !== null && !Array.isArray(stack.Env)) fail('Stack environment could not be preserved');
  const source = (await api('GET', `/stacks/${stack.Id}/file`)).StackFileContent;
  if (typeof source !== 'string') fail('Stack source was not returned');
  const previousRef = before.Config.Image;
  replaceImage(source, previousRef, previousRef); // Validate the literal image field before any mutation.
  const peers = containers.filter(c => c.Labels?.['com.docker.compose.project'] === PROJECT && c.Id !== before.Id);
  if (peers.some(c => c.Image === previousRef)) fail('Another service shares the frontend image; deployment refused');
  const oldImage = await api('GET', docker(`/images/${encodeURIComponent(before.Image)}/json`));
  const rollbackRef = oldImage.RepoDigests?.find(ref => /^[\w./:@-]+@sha256:[0-9a-f]{64}$/.test(ref));
  if (!rollbackRef) fail('No immutable rollback image is available; no change attempted');
  if (!await publicHealthy(false)) fail('Existing public Maps page is unavailable; no change attempted');

  const summary = { target: TARGET, stackId: stack.Id, previousImage: previousRef, previousImageId: oldImage.Id, rollbackImage: rollbackRef, desiredImage: desired, release };
  record({ ...summary, status: 'planned' });
  await api('POST', docker(`/images/create?fromImage=${encodeURIComponent(REPOSITORY + '@' + digest)}`), undefined, true);
  const newImage = await api('GET', docker(`/images/${encodeURIComponent(REPOSITORY + '@' + digest)}/json`));
  if (newImage.Config?.Labels?.['org.opencontainers.image.revision'] !== release) fail('Pulled image revision differs from the approved release; stack unchanged');
  const planned = replaceImage(source, previousRef, desired);
  const rollback = replaceImage(source, previousRef, rollbackRef);
  const readState = async () => ({ stack: await api('GET', `/stacks/${stack.Id}`), source: (await api('GET', `/stacks/${stack.Id}/file`)).StackFileContent });
  const peersUnchanged = current => peers.every(peer => current.some(c => c.Id === peer.Id && c.Image === peer.Image && (peer.State !== 'running' || c.State === 'running')));
  const verify = async (imageId, localized) => {
    let stable = 0;
    for (let i = 0; i < attempts; i++) {
      try {
        const current = await list();
        if (!peersUnchanged(current)) return 'other-services-changed';
        const c = await inspect(target(current).Id);
        if (c.Image === imageId && c.State?.Status === 'running' && !c.State.Restarting && (c.RestartCount || 0) === 0 && (!c.State.Health || c.State.Health.Status === 'healthy') && await publicHealthy(localized)) {
          if (++stable >= stableChecks) return 'healthy';
        } else stable = 0;
      } catch { stable = 0; }
      await sleep(10000);
    }
    return 'unhealthy';
  };
  const current = await readState();
  if (current.source !== source || !equalEnv(current.stack.Env, stack.Env)) fail('Stack changed during preflight; operator changes were preserved');
  const latest = await list();
  if (!peersUnchanged(latest)) fail('Other services changed during preflight; no stack update attempted');
  const fresh = await inspect(target(latest).Id);
  if (fresh.Image === newImage.Id && await verify(newImage.Id, true) === 'healthy') {
    const result = { ...summary, status: 'already-current' }; record(result); return result;
  }
  if (fresh.Id !== before.Id || fresh.Image !== before.Image) fail('Frontend changed during preflight; no stack update attempted');

  const put = content => api('PUT', `/stacks/${stack.Id}?endpointId=${ENDPOINT}`, { StackFileContent: content, Env: stack.Env, Prune: false, PullImage: false });
  let writeFailed = false;
  try { await put(planned); } catch { writeFailed = true; }
  let reconciled;
  for (let i = 0; i < attempts; i++) {
    try {
      const observed = await readState();
      if (!equalEnv(observed.stack.Env, stack.Env) || (observed.source !== source && observed.source !== planned)) {
        record({ ...summary, status: 'unknown-operator-change' });
        fail('Stack changed outside this rollout; no blind rollback attempted');
      }
      if (observed.source === planned) { reconciled = observed; break; }
    } catch (error) {
      if (error.message.includes('outside this rollout')) throw error;
    }
    await sleep(10000);
  }
  if (!reconciled) {
    record({ ...summary, status: 'unknown' });
    fail(writeFailed ? 'Update response was lost and state is unknown; no blind retry or rollback attempted' : 'Updated stack source could not be verified; no blind rollback attempted');
  }
  const health = await verify(newImage.Id, true);
  if (health === 'healthy') {
    const result = { ...summary, status: 'deployed', unchangedOtherServices: peers.length }; record(result); return result;
  }
  if (health === 'other-services-changed') {
    record({ ...summary, status: 'unknown-other-services' });
    fail('Other service containers changed; no additional stack mutation attempted');
  }
  const rollbackState = await readState();
  if (rollbackState.source !== planned || !equalEnv(rollbackState.stack.Env, stack.Env)) fail('Stack changed before rollback; operator changes were preserved');
  try { await put(rollback); } catch {
    record({ ...summary, status: 'unknown-rollback' });
    fail('Rollback response was lost; inspect current state before retrying');
  }
  const restored = await readState();
  if (restored.source !== rollback || !equalEnv(restored.stack.Env, stack.Env) || await verify(oldImage.Id, false) !== 'healthy') {
    record({ ...summary, status: 'unknown-rollback' }); fail('Previous frontend could not be verified after rollback');
  }
  record({ ...summary, status: 'rolled-back' });
  fail('New Maps frontend failed health checks; the previous immutable frontend was restored');
}

module.exports = { deployMaps, replaceImage, TARGET, PROJECT, ENDPOINT, REPOSITORY };
