-- User preferences for onboarding + notification emails
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS onboarding_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS notify_email_deployments BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS notify_email_failures BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS notify_email_weekly_usage BOOLEAN NOT NULL DEFAULT FALSE;
