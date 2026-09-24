-- 004_quotes_projects.sql
CREATE TABLE quote (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  client_id UUID NOT NULL REFERENCES client(id),
  contract_id UUID REFERENCES contract(id),
  number TEXT NOT NULL,
  title TEXT,
  description TEXT,
  status quote_status NOT NULL DEFAULT 'draft',
  currency TEXT NOT NULL DEFAULT 'DZD',
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,   -- configurable fiscal rule (spec §71), not hardcoded
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  margin_target_percent NUMERIC(5,2),
  terms TEXT,
  valid_until DATE,
  approved_by UUID REFERENCES "user"(id),
  approved_at TIMESTAMPTZ,
  created_by UUID REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);

CREATE TABLE quote_line (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_id UUID NOT NULL REFERENCES quote(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  kind TEXT NOT NULL CHECK (kind IN ('measurement','material','labor','equipment','transport','other')),
  description TEXT NOT NULL,
  quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
  unit TEXT,
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  material_id UUID,   -- FK added in 010
  measurement_id UUID -- FK added in 010
);

CREATE TABLE project (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  client_id UUID NOT NULL REFERENCES client(id),
  contract_id UUID REFERENCES contract(id),
  quote_id UUID REFERENCES quote(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  site_address TEXT,
  status project_status NOT NULL DEFAULT 'planned',
  planned_start DATE,
  planned_end DATE,
  actual_start DATE,
  actual_end DATE,
  budget_materials NUMERIC(14,2) DEFAULT 0,
  budget_labor NUMERIC(14,2) DEFAULT 0,
  budget_transport NUMERIC(14,2) DEFAULT 0,
  budget_vehicles NUMERIC(14,2) DEFAULT 0,
  budget_equipment NUMERIC(14,2) DEFAULT 0,
  budget_subcontracting NUMERIC(14,2) DEFAULT 0,
  budget_other NUMERIC(14,2) DEFAULT 0,
  contract_value NUMERIC(14,2) DEFAULT 0,
  delayed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE INDEX idx_project_company_status ON project(company_id, status);

CREATE TABLE project_member (
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL,
  user_id UUID REFERENCES "user"(id), -- optional login link; FK added in 010
  role_on_project TEXT NOT NULL, -- engineer, team_leader, worker, driver, storekeeper
  PRIMARY KEY (project_id, employee_id)
);

CREATE TABLE project_measurement (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  zone TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('area','rect','volume')),
  length_m NUMERIC(10,2),
  width_m NUMERIC(10,2),
  height_m NUMERIC(10,2),
  thickness_mm NUMERIC(8,2),
  area_sqm_input NUMERIC(12,2),
  area_sqm NUMERIC(12,2) GENERATED ALWAYS AS (
    CASE kind
      WHEN 'area' THEN area_sqm_input
      WHEN 'rect' THEN length_m * width_m
      WHEN 'volume' THEN area_sqm_input
      ELSE NULL
    END
  ) STORED,
  product_type TEXT,
  notes TEXT,
  recorded_by UUID REFERENCES "user"(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE project_task (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status project_task_status NOT NULL DEFAULT 'todo',
  planned_start DATE,
  planned_end DATE,
  assignee_employee_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE project_milestone (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_date DATE,
  completed_at DATE
);

CREATE TABLE daily_report (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  work_performed TEXT,
  manpower_count INT,
  problems TEXT,
  voice_note_document_id UUID,
  created_by UUID REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, report_date, created_by)
);

CREATE TABLE quality_check (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  check_type TEXT,
  result TEXT CHECK (result IN ('pass','fail','rework')),
  notes TEXT,
  document_id UUID
);

CREATE TABLE incident (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  project_id UUID REFERENCES project(id),
  vehicle_id UUID,
  equipment_id UUID,
  severity incident_severity NOT NULL DEFAULT 'medium',
  status incident_status NOT NULL DEFAULT 'open',
  title TEXT NOT NULL,
  description TEXT,
  reported_by UUID REFERENCES "user"(id),
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
