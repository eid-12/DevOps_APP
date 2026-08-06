import { Service } from '../core/models';

/** Prefer custom domain; fall back to opaque platform host. */
export function publicHost(service: Pick<Service, 'subdomain' | 'customDomain'>): string | undefined {
  const custom = service.customDomain?.trim();
  if (custom) return custom;
  const platform = service.subdomain?.trim();
  return platform || undefined;
}

export function publicUrl(service: Pick<Service, 'subdomain' | 'customDomain'>): string | undefined {
  const host = publicHost(service);
  return host ? `https://${host}` : undefined;
}
