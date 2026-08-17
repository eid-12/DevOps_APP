-- Persist CPU/RAM samples for service metrics charts (kept ~30 days).
-- Rows are removed automatically when the parent service is deleted.

CREATE TABLE IF NOT EXISTS service_metrics (
    id              BIGSERIAL PRIMARY KEY,
    service_id      VARCHAR(36) NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cpu_percent     DOUBLE PRECISION NOT NULL DEFAULT 0,
    memory_usage_mb DOUBLE PRECISION NOT NULL DEFAULT 0,
    memory_limit_mb DOUBLE PRECISION NOT NULL DEFAULT 0,
    memory_percent  DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_service_metrics_service_time
    ON service_metrics (service_id, recorded_at DESC);
