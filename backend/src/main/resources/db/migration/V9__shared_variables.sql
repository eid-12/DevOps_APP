ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS shared_variables jsonb NOT NULL DEFAULT '[]'::jsonb;
