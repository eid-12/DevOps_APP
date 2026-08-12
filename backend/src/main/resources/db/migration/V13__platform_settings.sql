CREATE TABLE IF NOT EXISTS platform_settings (
    setting_key   VARCHAR(120) PRIMARY KEY,
    setting_value TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by    VARCHAR(255)
);
