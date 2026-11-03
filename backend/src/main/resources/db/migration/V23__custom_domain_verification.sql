-- A custom domain is routed only after its owner proves DNS control (TXT _cloudbase-challenge.<domain>).
-- A requested domain waits in custom_domain_pending; it is not routed and does not block anyone else.
ALTER TABLE services ADD COLUMN custom_domain_pending VARCHAR(255);
ALTER TABLE services ADD COLUMN custom_domain_token VARCHAR(64);
ALTER TABLE services ADD COLUMN custom_domain_requested_at TIMESTAMPTZ;
ALTER TABLE services ADD COLUMN custom_domain_verified_at TIMESTAMPTZ;
-- Domains active before this release keep routing; they were accepted without proof (see docs/operations.md).
UPDATE services SET custom_domain_verified_at = NOW() WHERE custom_domain IS NOT NULL AND custom_domain <> '';
