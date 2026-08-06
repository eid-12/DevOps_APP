-- Persist Portainer / NPM / rollback metadata for orchestration

ALTER TABLE services
    ADD COLUMN IF NOT EXISTS portainer_stack_id INTEGER,
    ADD COLUMN IF NOT EXISTS npm_proxy_host_id INTEGER,
    ADD COLUMN IF NOT EXISTS container_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS container_port INTEGER DEFAULT 8080,
    ADD COLUMN IF NOT EXISTS env_pending_deploy BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE deployments
    ADD COLUMN IF NOT EXISTS rollback_of VARCHAR(36),
    ADD COLUMN IF NOT EXISTS portainer_stack_id INTEGER,
    ADD COLUMN IF NOT EXISTS compose_snapshot TEXT;

CREATE INDEX IF NOT EXISTS idx_services_subdomain ON services(subdomain);
CREATE INDEX IF NOT EXISTS idx_services_github_repo
    ON services ((source_details->>'repositoryUrl'));
