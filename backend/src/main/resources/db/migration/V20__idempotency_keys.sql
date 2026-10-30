-- Lets a client retry a create after a lost response and get the original resource. Additive.
CREATE TABLE idempotency_keys (
    owner_id      VARCHAR(36)  NOT NULL,
    request_key   VARCHAR(64)  NOT NULL,
    request_hash  VARCHAR(64)  NOT NULL,
    resource_type VARCHAR(16)  NOT NULL,
    resource_id   VARCHAR(36)  NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, request_key)
);
CREATE INDEX idx_idempotency_keys_created ON idempotency_keys (created_at);
