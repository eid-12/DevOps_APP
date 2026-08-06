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

export const DOCKER_IMAGE_PRESETS = [
  { image: 'nginxdemos/hello', tag: 'latest', port: 80, label: 'Hello (demo)' },
  { image: 'nginx', tag: 'alpine', port: 80, label: 'Nginx' },
  { image: 'traefik/whoami', tag: 'latest', port: 80, label: 'Whoami' },
  { image: 'httpd', tag: 'alpine', port: 80, label: 'Apache' }
] as const;

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

export function guessContainerPort(imageName: string): number {
  const n = (imageName || '').toLowerCase();
  if (n.includes('postgres')) return 5432;
  if (n.includes('mysql') || n.includes('mariadb')) return 3306;
  if (n.includes('redis')) return 6379;
  if (n.includes('mongo')) return 27017;
  if (n.includes('nginx') || n.includes('httpd') || n.includes('whoami') || n.includes('hello')) return 80;
  if (n.includes('traefik')) return 80;
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
