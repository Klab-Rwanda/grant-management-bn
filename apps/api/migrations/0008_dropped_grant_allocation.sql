-- Up Migration
ALTER TYPE allocation_status_enum ADD VALUE IF NOT EXISTS 'DROPPED';

-- Down Migration
-- PostgreSQL does not support safely removing a value from an enum type.
