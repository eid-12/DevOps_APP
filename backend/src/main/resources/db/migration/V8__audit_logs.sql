CREATE TABLE IF NOT EXISTS audit_logs (
    id           VARCHAR(36) PRIMARY KEY,
    timestamp    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_name   VARCHAR(255) NOT NULL,
    actor_email  VARCHAR(255) NOT NULL,
    action       VARCHAR(40) NOT NULL,
    target       VARCHAR(255) NOT NULL,
    details      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action);
