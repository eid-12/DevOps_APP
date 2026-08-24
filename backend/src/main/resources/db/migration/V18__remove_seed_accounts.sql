-- Remove well-known seed accounts (and any leftover owned rows).
-- Project/service teardown should already have run via the API so Portainer/NPM
-- stacks are gone; this migration is the DB source of truth for new installs.

DELETE FROM notifications
WHERE user_id IN ('u-admin-seed', 'u-dev-seed')
   OR user_id IN (
        SELECT id FROM users
        WHERE email IN ('admin@cloudbase.dev', 'dev@cloudbase.dev')
    );

DELETE FROM users
WHERE id IN ('u-admin-seed', 'u-dev-seed')
   OR email IN ('admin@cloudbase.dev', 'dev@cloudbase.dev');
