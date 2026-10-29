-- Per-user session version. Session tokens and password-reset links carry it; changing or resetting the
-- password increments it, which invalidates every earlier token without putting anything derived from the
-- password into a token. Additive: existing rows start at 0.
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
