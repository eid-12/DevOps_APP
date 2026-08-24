import { DatabaseType } from '../core/models';

/** Defaults used when creating DATABASE / DOCKER services from the UI. */
export const DB_PRESETS: Record<
  DatabaseType,
  { name: string; mountPath: string; port: number; label: string; hint: string }
> = {
  POSTGRESQL: {
    name: 'postgres',
    mountPath: '/var/lib/postgresql/data',
    port: 5432,
    label: 'PostgreSQL',
    hint: 'Internal DB on the project network. Apps connect via service name + port 5432.'
  },
  MYSQL: {
    name: 'mysql',
    mountPath: '/var/lib/mysql',
    port: 3306,
    label: 'MySQL',
    hint: 'Internal DB on the project network. Apps connect via service name + port 3306.'
  },
  REDIS: {
    name: 'redis',
    mountPath: '/data',
    port: 6379,
    label: 'Redis',
    hint: 'In-memory cache/queue. Password is generated on deploy.'
  },
  MONGODB: {
    name: 'mongodb',
    mountPath: '/data/db',
    port: 27017,
    label: 'MongoDB',
    hint: 'Document store. Root credentials are generated on deploy.'
  }
};

/** User-facing demo apps only — never platform/infra tools (Portainer, etc.). */
export const DOCKER_IMAGE_PRESETS = [
  { image: 'nginxdemos/hello', tag: 'latest', port: 80, label: 'Hello (demo)' },
  { image: 'nginx', tag: 'alpine', port: 80, label: 'Nginx' },
  { image: 'traefik/whoami', tag: 'latest', port: 80, label: 'Whoami' },
  { image: 'httpd', tag: 'alpine', port: 80, label: 'Apache' },
  { image: 'ghost', tag: 'alpine', port: 2368, label: 'Ghost' }
] as const;

/** Default process start command shown/edited like Railway/Render (overrideable). */
export function defaultStartCommand(runtime: string | undefined | null): string {
  switch ((runtime || 'node').toLowerCase()) {
    case 'java':
      return 'java -jar /app/app.jar';
    case 'python':
      return 'python -m uvicorn main:app --host 0.0.0.0 --port 8000';
    case 'go':
      return '/app/app';
    case 'dotnet':
      return 'dotnet App.dll';
    case 'php':
      return 'apache2-foreground';
    case 'rust':
      return '/app/app';
    case 'node':
      // Prefer image default CMD (Vite/nginx SPA images already set their own).
      return '';
    default:
      return '';
  }
}

/** Client-side hint checks (server enforces the real rules). */
export function startCommandLooksUnsafe(cmd: string): string | null {
  const t = (cmd || '').trim();
  if (!t) return null;
  if (t.length > 400) return 'Max 400 characters';
  if (/[|&=`$<>\\]/.test(t) || /\$\(|\$\{/.test(t)) return 'Shell operators are not allowed';
  if (/[\r\n\t]/.test(t)) return 'Single line only';
  if (/(^|\s)(curl|wget|bash|sh|sudo|docker|nc|ncat)\b/i.test(t)) return 'Blocked binary';
  return null;
}

export function parseDockerImageRef(value: string): { imageName: string; imageTag: string } {
  const raw = (value || '').trim();
  if (!raw) return { imageName: '', imageTag: 'latest' };
  // registry/name:tag — split on last colon if tag has no slash after it
  const lastColon = raw.lastIndexOf(':');
  if (lastColon > 0 && !raw.slice(lastColon + 1).includes('/')) {
    return {
      imageName: raw.slice(0, lastColon),
      imageTag: raw.slice(lastColon + 1) || 'latest'
    };
  }
  return { imageName: raw, imageTag: 'latest' };
}

/** Stored Docker JSON may use imageName/imageTag or a single `image` field. */
export function dockerImageParts(details: Record<string, unknown> | undefined | null): {
  imageName: string;
  imageTag: string;
} {
  const rec = details ?? {};
  const name = String(rec['imageName'] ?? '').trim();
  const tag = String(rec['imageTag'] ?? rec['imageTag'] ?? '').trim();
  if (name && name !== 'undefined') {
    return { imageName: name, imageTag: tag || 'latest' };
  }
  return parseDockerImageRef(String(rec['image'] ?? ''));
}

export function formatDockerImage(details: Record<string, unknown> | undefined | null): string {
  const { imageName, imageTag } = dockerImageParts(details);
  return imageName ? `${imageName}:${imageTag}` : '';
}

export function withNormalizedDockerDetails<T extends Record<string, unknown>>(
  sourceType: string,
  details: T | undefined | null
): T {
  const rec = { ...(details ?? {}) } as Record<string, unknown>;
  if (sourceType === 'DOCKER') {
    const parts = dockerImageParts(rec);
    if (parts.imageName) {
      rec['imageName'] = parts.imageName;
      rec['imageTag'] = parts.imageTag;
    }
  }
  return rec as T;
}

export function guessContainerPort(imageName: string): number {
  const n = (imageName || '').toLowerCase();
  if (n.includes('postgres')) return 5432;
  if (n.includes('mysql') || n.includes('mariadb')) return 3306;
  if (n.includes('redis')) return 6379;
  if (n.includes('mongo')) return 27017;
  if (n.includes('grafana')) return 3000;
  if (n.includes('ghost')) return 2368;
  if (n.includes('portainer')) return 9000;
  if (n.includes('jenkins')) return 8080;
  if (n.includes('nginx') || n.includes('httpd') || n.includes('whoami') || n.includes('hello')) return 80;
  if (n.includes('traefik') && !n.includes('whoami')) return 80;
  return 8080;
}

export function slugifyServiceName(value: string): string {
  return value
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'service';
}
