-- Active developer user for local FE↔ BE (password: Dev@2026)
INSERT INTO users (id, name, email, password_hash, role, account_status, deployment_enabled)
VALUES (
    'u-dev-seed',
    'Developer One',
    'dev@cloudbase.dev',
    '$2a$12$25WSU09ywQWVxKt4j01k.uLsM4up7G3/Wj1gf5.w5ZobBC2DbHfhu',
    'USER',
    'ACTIVE',
    TRUE
) ON CONFLICT (email) DO NOTHING;

-- Optional display name for GitHub profile
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_display_name VARCHAR(255);
