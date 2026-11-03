-- A custom domain is routed only after its owner proves DNS control (TXT _cloudbase-challenge.<domain>).
-- A requested domain waits in custom_domain_pending; it is not routed and does not block anyone else.
ALTER TABLE services ADD COLUMN custom_domain_pending VARCHAR(255);
ALTER TABLE services ADD COLUMN custom_domain_token VARCHAR(64);
ALTER TABLE services ADD COLUMN custom_domain_requested_at TIMESTAMPTZ;
ALTER TABLE services ADD COLUMN custom_domain_verified_at TIMESTAMPTZ;
-- Domains active before this release keep routing; they were accepted without proof (see docs/operations.md).
UPDATE services SET custom_domain_verified_at = NOW() WHERE custom_domain IS NOT NULL AND custom_domain <> '';

-- Rollback safety: an older release would write custom_domain directly, without proof. Refuse any new active domain
-- unless custom_domain_verified_at is set in the same write (only the verification path does that). Clearing a domain
-- and writes that leave custom_domain unchanged are allowed.
CREATE OR REPLACE FUNCTION services_require_verified_domain() RETURNS trigger AS $$
BEGIN
    IF NEW.custom_domain IS NOT NULL AND NEW.custom_domain <> ''
       AND (TG_OP = 'INSERT' OR NEW.custom_domain IS DISTINCT FROM OLD.custom_domain)
       AND (NEW.custom_domain_verified_at IS NULL
            OR (TG_OP = 'UPDATE' AND NEW.custom_domain_verified_at IS NOT DISTINCT FROM OLD.custom_domain_verified_at)) THEN
        RAISE EXCEPTION 'custom domain % requires ownership verification', NEW.custom_domain USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER services_require_verified_domain
    BEFORE INSERT OR UPDATE OF custom_domain, custom_domain_verified_at ON services
    FOR EACH ROW EXECUTE FUNCTION services_require_verified_domain();
