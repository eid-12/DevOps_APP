-- Durable progress of service creation, so an interrupted setup can be resumed. Additive; existing services are done.
ALTER TABLE services ADD COLUMN setup_state VARCHAR(16) NOT NULL DEFAULT 'DONE';
CREATE INDEX idx_services_setup_pending ON services (setup_state) WHERE setup_state <> 'DONE';
