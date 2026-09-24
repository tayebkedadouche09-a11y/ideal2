-- 003_clients_suppliers_contracts.sql
CREATE TABLE client (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  code TEXT,
  name TEXT NOT NULL,
  legal_form TEXT,
  nif TEXT,
  nis TEXT,
  rc TEXT,
  address TEXT,
  city TEXT,
  phone TEXT,
  email TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_client_company ON client(company_id);
CREATE INDEX idx_client_name_trgm ON client USING gin (name gin_trgm_ops);

CREATE TABLE client_contact (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES client(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  position TEXT,
  phone TEXT,
  email TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE client_portal_user (
  user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES client(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, client_id)
);

CREATE TABLE supplier (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  code TEXT,
  name TEXT NOT NULL,
  nif TEXT,
  address TEXT,
  city TEXT,
  phone TEXT,
  email TEXT,
  lead_time_days INT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_supplier_company ON supplier(company_id);

CREATE TABLE contract (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  client_id UUID NOT NULL REFERENCES client(id),
  number TEXT NOT NULL,
  type TEXT,
  title TEXT,
  value NUMERIC(14,2),
  currency TEXT NOT NULL DEFAULT 'DZD',
  start_date DATE,
  end_date DATE,
  scope_description TEXT,
  terms TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  version INT NOT NULL DEFAULT 1,           -- amendments are versioned (spec §9)
  parent_contract_id UUID REFERENCES contract(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
CREATE INDEX idx_contract_client ON contract(client_id);
