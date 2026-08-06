-- Seed default admin user (password: Admin@2026 bcrypt hashed)
INSERT INTO users (id, name, email, password_hash, role, account_status, deployment_enabled)
VALUES (
    'u-admin-seed',
    'CloudBase Admin',
    'admin@cloudbase.dev',
    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdAWkpjOyWb5g6e',
    'ADMIN',
    'ACTIVE',
    TRUE
) ON CONFLICT (email) DO NOTHING;
