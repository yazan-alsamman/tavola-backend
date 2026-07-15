-- Runs once, automatically, the first time the postgres container starts
-- with an empty data directory (official postgres image convention:
-- /docker-entrypoint-initdb.d/*.sql). Only enables the extensions
-- DATABASE_SCHEMA.md's "Required PostgreSQL Extensions" section names -
-- no business tables are created here, per this phase's instructions.

-- ADR-013: backs the exclusion constraint that prevents overlapping
-- confirmed reservations for the same table. Not used yet - no Reservation
-- table exists - but enabling it now means the first migration that adds
-- one never has to touch extension setup.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Required for gen_random_uuid()-based UUID generation on PostgreSQL
-- versions where it is not already built in.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
