ALTER TABLE services ADD COLUMN IF NOT EXISTS custom_domain VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_services_subdomain_unique
    ON services (LOWER(subdomain))
    WHERE subdomain IS NOT NULL AND subdomain <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_services_custom_domain_unique
    ON services (LOWER(custom_domain))
    WHERE custom_domain IS NOT NULL AND custom_domain <> '';
