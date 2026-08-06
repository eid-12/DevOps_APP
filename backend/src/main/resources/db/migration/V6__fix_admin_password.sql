-- Fix admin seed password so Admin@2026 works (previous hash did not match)
UPDATE users
SET password_hash = '$2a$12$2U3dntgmCjM4Dqcaa2rBh.H2gSHKYW3H.rLV3YQFtgmaeG68kvhLC'
WHERE email = 'admin@cloudbase.dev';