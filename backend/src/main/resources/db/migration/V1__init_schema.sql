-- CloudBase Platform Schema v1

CREATE TABLE users (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'USER',
    account_status VARCHAR(30) NOT NULL DEFAULT 'PENDING_ACTIVATION',
    deployment_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE projects (
    id VARCHAR(36) PRIMARY KEY,
    owner_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_name VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE services (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    source_type VARCHAR(20) NOT NULL,
    source_details JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    subdomain VARCHAR(255),
    env_vars JSONB,
    volume_mount_path VARCHAR(512),
    volume_size_gb INTEGER,
    quota_memory_mb INTEGER NOT NULL DEFAULT 512,
    quota_cpu_milli INTEGER NOT NULL DEFAULT 500,
    quota_storage_gb INTEGER NOT NULL DEFAULT 2,
    latest_deployment_id VARCHAR(36),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE deployments (
    id VARCHAR(36) PRIMARY KEY,
    service_id VARCHAR(36) NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    project_id VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
    triggered_by VARCHAR(255),
    commit_sha VARCHAR(40),
    image_tag VARCHAR(255),
    logs TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE INDEX idx_projects_owner ON projects(owner_id);
CREATE INDEX idx_services_project ON services(project_id);
CREATE INDEX idx_deployments_service ON deployments(service_id);
CREATE INDEX idx_deployments_project ON deployments(project_id);
