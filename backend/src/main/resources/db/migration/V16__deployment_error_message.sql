-- Persist short deploy failure reason for the UI (full trail stays in logs).
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS error_message TEXT;
