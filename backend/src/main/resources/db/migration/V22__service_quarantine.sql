-- Set while the platform holds a tenant service stopped because its network isolation could not be proven.
-- Additive; an older release ignores the column.
ALTER TABLE services ADD COLUMN quarantined BOOLEAN NOT NULL DEFAULT FALSE;
