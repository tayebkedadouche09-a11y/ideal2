-- 009_documents_communications_notifications.sql
CREATE TABLE document (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  uploaded_by UUID REFERENCES "user"(id),
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  storage_key TEXT NOT NULL,        -- S3-compatible object key
  sha256 TEXT,
  status document_status NOT NULL DEFAULT 'pending',
  ocr_text TEXT,
  classification TEXT,              -- invoice, contract, delivery_note, photo, other
  extracted JSONB,                  -- AI extraction: number/date/amount + confidence
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE document_link (
  document_id UUID NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  PRIMARY KEY (document_id, entity_type, entity_id)
);
CREATE INDEX idx_doclink_entity ON document_link(entity_type, entity_id);

CREATE TABLE document_version (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  version INT NOT NULL,
  storage_key TEXT NOT NULL,
  uploaded_by UUID REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);

CREATE TABLE communication (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  kind communication_kind NOT NULL,
  direction communication_direction,
  subject TEXT,
  body TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_id UUID REFERENCES client(id),
  project_id UUID REFERENCES project(id),
  contract_id UUID REFERENCES contract(id),
  invoice_id UUID REFERENCES invoice(id),
  created_by UUID REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_comm_client ON communication(client_id);

CREATE TABLE email_message (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  message_id_header TEXT UNIQUE,
  thread_id UUID,
  from_address TEXT,
  to_address TEXT[],
  subject TEXT,
  body_text TEXT,
  received_at TIMESTAMPTZ,
  document_ids UUID[],
  linked_client_id UUID REFERENCES client(id),
  linked_project_id UUID REFERENCES project(id),
  linked_contract_id UUID REFERENCES contract(id),
  linked_invoice_id UUID REFERENCES invoice(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  user_id UUID REFERENCES "user"(id),
  kind TEXT NOT NULL,               -- overdue_invoice, low_stock, maintenance, delay, assignment, approval, incident, ai
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  body TEXT,
  entity_type TEXT,
  entity_id UUID,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notification_user ON notification(user_id, created_at DESC);
