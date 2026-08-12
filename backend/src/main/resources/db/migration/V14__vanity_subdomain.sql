-- One vanity platform subdomain per user account (e.g. acme.cloudbase.website).
-- All other services keep opaque random hosts (cloudbase####.baseDomain).

ALTER TABLE users ADD COLUMN IF NOT EXISTS vanity_slug VARCHAR(63);
ALTER TABLE users ADD COLUMN IF NOT EXISTS vanity_service_id VARCHAR(36);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_vanity_slug_unique
    ON users (LOWER(vanity_slug))
    WHERE vanity_slug IS NOT NULL AND vanity_slug <> '';
