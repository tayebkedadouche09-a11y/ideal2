-- 012_automation_chat_zones_boq.sql — IDEAIL V2 Phase F (Automation) + E (Chat) + C (Zones/BOQ)
-- Evolution of existing schema: additive only, no drops, existing tables untouched.

DO $$ BEGIN
  CREATE TYPE zone_status AS ENUM ('planned','in_progress','completed','blocked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ PHASE F — AUTOMATION ENGINE (spec §44) ============
-- Event → Context → Rule/Condition → Action → (Approval) → Execution → Notification → Audit

CREATE TABLE automation_rule (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN
    ('stock_low','invoice_overdue','project_delayed','incident_created','quote_accepted','approval_needed')),
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,  -- e.g. {"severity":"critical"} or {"days_overdue":5}
  action_type TEXT NOT NULL CHECK (action_type IN
    ('notify','notify_role','create_purchase_suggestion','assign_task')),
  action_params JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {"role":"owner"} / {"message":"..."} / {"title":"...","assignee_employee_id":"...","project_id":"..."}
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_arule_company_trigger ON automation_rule(company_id, trigger_type);
CREATE INDEX idx_arule_company_enabled ON automation_rule(company_id) WHERE enabled;

CREATE TABLE automation_run (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_id UUID NOT NULL REFERENCES automation_rule(id) ON DELETE CASCADE,
  company_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success','no_match','failed','awaiting_approval')),
  trigger_payload JSONB,
  action_output JSONB,
  error TEXT,
  created_by UUID REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_arun_rule ON automation_run(rule_id, created_at DESC);
CREATE INDEX idx_arun_company_time ON automation_run(company_id, created_at DESC);

-- ============ PHASE E — INTERNAL COMMUNICATION / CHAT (spec §32, §33) ============
CREATE TABLE chat_channel (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  kind TEXT NOT NULL DEFAULT 'project' CHECK (kind IN ('project','department','private','group','company')),
  name TEXT NOT NULL,
  project_id UUID REFERENCES project(id),
  created_by UUID REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
CREATE INDEX idx_channel_company ON chat_channel(company_id);
CREATE INDEX idx_channel_project ON chat_channel(project_id);

CREATE TABLE chat_message (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  channel_id UUID NOT NULL REFERENCES chat_channel(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES "user"(id),
  body TEXT NOT NULL,
  metadata JSONB,                       -- structured extras (voice, location, attachments refs)
  document_id UUID,                     -- FK added below
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cmsg_channel_time ON chat_message(channel_id, created_at DESC);
CREATE INDEX idx_cmsg_company ON chat_message(company_id);

CREATE TABLE chat_channel_member (
  channel_id UUID NOT NULL REFERENCES chat_channel(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

-- ============ PHASE C — ENGINEERING: ZONES & BOQ (spec §9, §65, §67) ============
CREATE TABLE project_zone (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  area_sqm NUMERIC(12,2),               -- canonical zone surface (Single Source of Truth, spec §7)
  status zone_status NOT NULL DEFAULT 'planned',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);
CREATE INDEX idx_pzone_project ON project_zone(project_id);

CREATE TABLE zone_boq_line (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  zone_id UUID NOT NULL REFERENCES project_zone(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('measurement','material','labor','equipment','transport','other')),
  description TEXT NOT NULL,
  quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
  unit TEXT,
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  waste_factor_percent NUMERIC(5,2) NOT NULL DEFAULT 0,   -- configurable per line (resin/epoxy waste, spec §65)
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  material_id UUID,
  measurement_id UUID,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_boq_zone ON zone_boq_line(zone_id);

ALTER TABLE zone_boq_line
  ADD CONSTRAINT fk_boq_material FOREIGN KEY (material_id) REFERENCES material(id),
  ADD CONSTRAINT fk_boq_measurement FOREIGN KEY (measurement_id) REFERENCES project_measurement(id);

ALTER TABLE chat_message
  ADD CONSTRAINT fk_cmsg_document FOREIGN KEY (document_id) REFERENCES document(id);

-- ============ PHASE D — UNIVERSAL CAPTURE (spec §13–§19): context metadata ============
ALTER TABLE document
  ADD COLUMN IF NOT EXISTS zone_id UUID REFERENCES project_zone(id),
  ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES project_task(id),
  ADD COLUMN IF NOT EXISTS incident_id UUID REFERENCES incident(id),
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS captured_via TEXT;   -- camera|upload|email|chat|voice|scan

ALTER TABLE incident
  ADD COLUMN IF NOT EXISTS zone_id UUID REFERENCES project_zone(id),
  ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES document(id),
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS resolution_notes TEXT;

ALTER TABLE daily_report
  ADD COLUMN IF NOT EXISTS zone_id UUID REFERENCES project_zone(id);

ALTER TABLE project
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6);
