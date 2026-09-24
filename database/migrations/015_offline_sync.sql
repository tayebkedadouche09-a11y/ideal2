-- 015_offline_sync.sql
-- V3 offline-first foundation: device sessions, outbox mirror, conflict records.
-- Additive only. Server remains authoritative; clients never overwrite newer server state silently.

CREATE TABLE IF NOT EXISTS device_session (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'web'
    CHECK (platform IN ('web','android','ios','desktop')),
  label TEXT,
  app_version TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_device_session_company_user
  ON device_session(company_id, user_id) WHERE revoked_at IS NULL;

-- Server-side mirror of client outbox items (audit + retry visibility).
CREATE TABLE IF NOT EXISTS sync_mutation (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  user_id UUID NOT NULL REFERENCES "user"(id),
  device_id TEXT NOT NULL,
  client_mutation_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  client_entity_id TEXT,
  operation TEXT NOT NULL CHECK (operation IN ('create','update','delete','action')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  base_version BIGINT,
  status TEXT NOT NULL DEFAULT 'accepted'
    CHECK (status IN ('accepted','applied','conflict','rejected','duplicate')),
  server_entity_id UUID,
  conflict_reason TEXT,
  conflict_server_payload JSONB,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, client_mutation_id)
);
CREATE INDEX IF NOT EXISTS idx_sync_mutation_company_status
  ON sync_mutation(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_mutation_device
  ON sync_mutation(company_id, device_id, created_at DESC);

-- Explicit conflict queue for human or client resolution.
CREATE TABLE IF NOT EXISTS sync_conflict (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  mutation_id UUID NOT NULL REFERENCES sync_mutation(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  client_payload JSONB NOT NULL,
  server_payload JSONB NOT NULL,
  resolution TEXT CHECK (resolution IN ('client_wins','server_wins','merged','cancelled')),
  resolved_by UUID REFERENCES "user"(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sync_conflict_open
  ON sync_conflict(company_id, created_at DESC) WHERE resolved_at IS NULL;

-- Per-entity revision for optimistic concurrency on offline-capable tables.
ALTER TABLE project ADD COLUMN IF NOT EXISTS row_version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE project_task ADD COLUMN IF NOT EXISTS row_version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE daily_report ADD COLUMN IF NOT EXISTS row_version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE incident ADD COLUMN IF NOT EXISTS row_version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE capture_item ADD COLUMN IF NOT EXISTS row_version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE stock_level ADD COLUMN IF NOT EXISTS row_version BIGINT NOT NULL DEFAULT 1;
