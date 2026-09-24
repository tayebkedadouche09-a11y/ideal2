-- 006_employees_teams_work.sql
CREATE TABLE employee (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  user_id UUID REFERENCES "user"(id),
  code TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  national_id TEXT,
  phone TEXT,
  role TEXT NOT NULL,             -- engineer, team_leader, worker, driver, storekeeper, other
  skills TEXT[],
  daily_cost NUMERIC(12,2),
  hourly_cost NUMERIC(12,2),
  active BOOLEAN NOT NULL DEFAULT true,
  hired_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_employee_company ON employee(company_id);

CREATE TABLE team (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  name TEXT NOT NULL,
  leader_employee_id UUID REFERENCES employee(id)
);

CREATE TABLE team_member (
  team_id UUID NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employee(id),
  PRIMARY KEY (team_id, employee_id)
);

CREATE TABLE team_assignment (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  team_id UUID NOT NULL REFERENCES team(id),
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  start_date DATE,
  end_date DATE,
  mission TEXT
);

CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  employee_id UUID NOT NULL REFERENCES employee(id),
  date DATE NOT NULL,
  kind attendance_kind NOT NULL DEFAULT 'present',
  check_in TIMESTAMPTZ,
  check_out TIMESTAMPTZ,
  project_id UUID REFERENCES project(id),
  recorded_by UUID REFERENCES "user"(id),
  UNIQUE (employee_id, date)
);

CREATE TABLE work_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  project_id UUID NOT NULL REFERENCES project(id),
  employee_id UUID NOT NULL REFERENCES employee(id),
  work_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  task TEXT,
  work_performed TEXT,
  quantity_done NUMERIC(14,3),
  quantity_unit TEXT,
  materials_note TEXT,
  problems TEXT,
  voice_note_document_id UUID,
  created_offline BOOLEAN NOT NULL DEFAULT false,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_worklog_project ON work_log(project_id, work_date);
