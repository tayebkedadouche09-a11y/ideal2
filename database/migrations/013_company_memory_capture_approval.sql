-- 013_company_memory_capture_approval.sql
-- IDEAIL V2: merge of the missing Company Memory + Universal Capture + Approval Center capabilities.
-- Additive only. No existing business table is dropped or renamed.

CREATE TABLE IF NOT EXISTS business_event (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  source TEXT NOT NULL DEFAULT 'application',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id UUID REFERENCES "user"(id),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_event_company_time
  ON business_event(company_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_event_entity
  ON business_event(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS approval_request (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  requested_by UUID REFERENCES "user"(id),
  decided_by UUID REFERENCES "user"(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  amount NUMERIC(14,2),
  risk TEXT NOT NULL DEFAULT 'medium' CHECK (risk IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  reason TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_approval_company_status
  ON approval_request(company_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_item (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'general'
    CHECK (kind IN ('lesson','procedure','supplier','material','project','incident','solution','general')),
  source_entity_type TEXT,
  source_entity_id UUID,
  project_id UUID REFERENCES project(id) ON DELETE SET NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  confidence NUMERIC(4,3),
  created_by UUID REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_company_time
  ON knowledge_item(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_project
  ON knowledge_item(project_id);

CREATE TABLE IF NOT EXISTS capture_item (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  capture_type TEXT NOT NULL CHECK (capture_type IN
    ('photo','video','document','voice','location','barcode','qr','note','work_log','material','incident','task','invoice')),
  project_id UUID REFERENCES project(id) ON DELETE SET NULL,
  entity_type TEXT,
  entity_id UUID,
  document_id UUID REFERENCES document(id) ON DELETE SET NULL,
  title TEXT,
  note TEXT,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  captured_via TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  processing_status TEXT NOT NULL DEFAULT 'captured'
    CHECK (processing_status IN ('captured','processing','processed','failed')),
  created_by UUID REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_capture_company_time
  ON capture_item(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_capture_project_time
  ON capture_item(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_capture_document
  ON capture_item(document_id);

-- Safety/traceability: all new operational objects emit a durable event.
CREATE OR REPLACE FUNCTION emit_company_event(
  p_company_id UUID,
  p_event_type TEXT,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_payload JSONB,
  p_actor_id UUID
) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO business_event(company_id,event_type,entity_type,entity_id,payload,actor_id)
  VALUES (p_company_id,p_event_type,p_entity_type,p_entity_id,COALESCE(p_payload,'{}'::jsonb),p_actor_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
