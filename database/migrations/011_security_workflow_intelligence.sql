-- 011_security_workflow_intelligence.sql
-- Quote versioning (spec §9: amendments versioned and audited)
CREATE TABLE quote_version (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_id UUID NOT NULL REFERENCES quote(id) ON DELETE CASCADE,
  version INT NOT NULL,
  snapshot JSONB NOT NULL,
  created_by UUID REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (quote_id, version)
);
CREATE INDEX idx_quote_version_quote ON quote_version(quote_id, version DESC);

-- Lessons learned after project completion (spec §52)
CREATE TABLE lesson_learned (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'what_went_well','what_went_wrong','material_variance','time_variance',
    'supplier','equipment','quality','unexpected_cost','corrective_action'
  )),
  note TEXT NOT NULL,
  created_by UUID REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lesson_project ON lesson_learned(project_id);

-- Customer-visible documents (spec §24: portal sees only shared docs)
ALTER TABLE document ADD COLUMN customer_visible BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE document ADD COLUMN batch_number TEXT;

-- Per-line discount used by the configurable totals engine
ALTER TABLE quote_line ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0;

-- Fuel logs and purchase orders get audit correlation via created_by (existing).
-- Record-level scoping indexes used by permission filters:
CREATE INDEX IF NOT EXISTS idx_project_member_user ON project_member(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_user ON employee(user_id);
CREATE INDEX IF NOT EXISTS idx_portal_user ON client_portal_user(user_id);
CREATE INDEX IF NOT EXISTS idx_stock_level_company ON stock_level(company_id);
CREATE INDEX IF NOT EXISTS idx_material_company ON material(company_id);
CREATE INDEX IF NOT EXISTS idx_invoice_company_status ON invoice(company_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_company ON payment(company_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_quote_company_status ON quote(company_id, status);
CREATE INDEX IF NOT EXISTS idx_project_company_client ON project(company_id, client_id);
