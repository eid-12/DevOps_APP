-- Pipeline stage reached during deploy (queued / building / deploying / verify / failed / success).
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS stage VARCHAR(40);
