-- MarTech Rescue Scheduler — database schema
-- Run once against a new, empty PostgreSQL database before first start:
--   psql "$DATABASE_URL" -f db/schema.sql
-- The app does not create tables itself. Columns match the queries in server.js.

CREATE TABLE IF NOT EXISTS kv_store (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS state_backups (
  id         serial PRIMARY KEY,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
