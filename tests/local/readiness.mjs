import { setTimeout as delay } from 'node:timers/promises';

// Read-only probes may retry; auth mutations must never be retried by this helper.
export async function waitForApi(base, { timeoutMs = 90000, probeMs = 3000, intervalMs = 1000 } = {}) {
  const start = performance.now();
  let last = 'no response';
  while (performance.now() - start < timeoutMs) {
    const remaining = timeoutMs - (performance.now() - start);
    try {
      const response = await fetch(base + '/actuator/health', {
        signal: AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(probeMs, remaining))))
      });
      last = `HTTP ${response.status}`;
      const body = await response.json();
      if (response.ok && body.status === 'UP') return;
    } catch (error) {
      last = error.name; // Never include response bodies or URLs containing credentials.
    }
    const remainingAfterProbe = timeoutMs - (performance.now() - start);
    if (remainingAfterProbe > 0) await delay(Math.min(intervalMs, remainingAfterProbe));
  }
  throw new Error(`INFRA: lab API not healthy within ${timeoutMs} ms (${last})`);
}
