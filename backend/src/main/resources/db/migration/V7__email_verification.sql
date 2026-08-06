-- Email verification code for signup (prove inbox ownership)
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS email_verification_code VARCHAR(20),
    ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ;

-- Existing seeded accounts are trusted
UPDATE users
SET email_verified = TRUE
WHERE email IN ('admin@cloudbase.dev', 'dev@cloudbase.dev');
