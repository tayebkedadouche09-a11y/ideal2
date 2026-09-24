-- 008_finance_expenses.sql
CREATE TABLE expense (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  project_id UUID REFERENCES project(id),
  vehicle_id UUID REFERENCES vehicle(id),
  equipment_id UUID REFERENCES equipment(id),
  category TEXT NOT NULL,           -- fuel, toll, repair, subcontracting, supplies, other
  amount NUMERIC(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'DZD',
  date DATE NOT NULL,
  description TEXT,
  document_id UUID,
  created_by UUID REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_expense_project ON expense(project_id);

CREATE TABLE invoice (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  client_id UUID NOT NULL REFERENCES client(id),
  contract_id UUID REFERENCES contract(id),
  project_id UUID REFERENCES project(id),
  number TEXT NOT NULL,             -- numbering per configurable scheme (spec §71)
  status invoice_status NOT NULL DEFAULT 'draft',
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  currency TEXT NOT NULL DEFAULT 'DZD',
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);

CREATE TABLE invoice_line (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoice(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  quantity NUMERIC(14,3) NOT NULL DEFAULT 1,
  unit TEXT,
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  project_measurement_id UUID
);

-- Payments are append-only events; invoice totals derive from them (spec §60:
-- financial corrections never silently delete history).
CREATE TABLE payment (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  invoice_id UUID NOT NULL REFERENCES invoice(id),
  client_id UUID NOT NULL REFERENCES client(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'DZD',
  method payment_method NOT NULL,
  reference TEXT,
  paid_at DATE NOT NULL,
  proof_document_id UUID,
  created_by UUID REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payment_invoice ON payment(invoice_id);

CREATE TABLE payment_reversal (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id UUID NOT NULL REFERENCES payment(id),
  reason TEXT NOT NULL,
  reversed_by UUID REFERENCES "user"(id),
  reversed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE supplier_invoice (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  supplier_id UUID NOT NULL REFERENCES supplier(id),
  purchase_order_id UUID REFERENCES purchase_order(id),
  number TEXT,
  amount NUMERIC(14,2) NOT NULL,
  due_date DATE,
  paid BOOLEAN NOT NULL DEFAULT false,
  document_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
