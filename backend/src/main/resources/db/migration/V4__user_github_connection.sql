-- Step 1: Persist per-user GitHub connection (Account page contract)

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS github_username VARCHAR(255),
    ADD COLUMN IF NOT EXISTS github_avatar_url VARCHAR(512),
    ADD COLUMN IF NOT EXISTS github_connected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS github_scopes TEXT,
    ADD COLUMN IF NOT EXISTS github_access_token TEXT;

COMMENT ON COLUMN users.github_access_token IS 'OAuth token — filled in Step 2; null in Step 1 stub connect';
