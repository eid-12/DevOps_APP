/**
 * Turn API / HTTP errors into short user-facing text.
 * Hides status codes, enum names, and internal container ids.
 */
export function friendlyApiMessage(err: unknown, fallback = 'Something went wrong'): string {
  const raw = extractRaw(err);
  if (!raw) return fallback;

  let text = raw
    // 404 NOT_FOUND "…"  or  404 NOT_FOUND …
    .replace(/^\s*\d{3}\s+[A-Z_]+\s*/i, '')
    .replace(/^["']|["']$/g, '')
    .replace(/\bHTTP\s*\d{3}\b/gi, '')
    .replace(/\b(NOT_FOUND|BAD_GATEWAY|BAD_REQUEST|CONFLICT|UNAUTHORIZED|FORBIDDEN)\b/gi, '')
    // internal docker / stack names
    .replace(/\bcb-svc-[a-z0-9]+\b/gi, 'this service')
    .replace(/\bcb-proj-[a-z0-9-]+\b/gi, 'this project')
    .replace(/\bContainer not found for[^.]*\./gi, 'No running container.')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:"'-]+|[\s:"'-]+$/g, '')
    .trim();

  if (!text) return fallback;

  // Known softer rewrites
  const lower = text.toLowerCase();
  if (lower.includes('deploy the service first') || lower.includes('no running container')) {
    return 'Service is not running yet. Click Deploy first.';
  }
  if (lower.includes('must be running')) {
    return 'Start or deploy the service before using this.';
  }
  if (lower.includes('portainer is unreachable')) {
    return 'Infrastructure is temporarily unreachable. Try again in a moment.';
  }

  return text.slice(0, 200);
}

function extractRaw(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const any = err as {
    error?: unknown;
    message?: string;
  };
  const body = any.error;
  if (typeof body === 'string' && body.trim()) return body;
  if (body && typeof body === 'object') {
    const o = body as { message?: string; error?: string; detail?: string; title?: string };
    if (o.message) return String(o.message);
    if (o.detail) return String(o.detail);
    if (o.error && o.error !== 'Not Found') return String(o.error);
  }
  if (any.message && !String(any.message).includes('Http failure')) {
    return String(any.message);
  }
  return '';
}
