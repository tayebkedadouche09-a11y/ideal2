-- 007_fleet_equipment.sql
CREATE TABLE vehicle (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  registration TEXT NOT NULL,
  model TEXT,
  type TEXT,                       -- truck, van, pickup, tanker...
  driver_employee_id UUID REFERENCES employee(id),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','assigned','maintenance','out_of_service')),
  current_mileage INT NOT NULL DEFAULT 0,
  insurance_expiry DATE,
  inspection_expiry DATE,
  qr_code TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, registration)
);

CREATE TABLE vehicle_assignment (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicle(id) ON DELETE CASCADE,
  project_id UUID REFERENCES project(id),
  driver_employee_id UUID REFERENCES employee(id),
  assigned_from DATE,
  assigned_to DATE,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE fuel_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  vehicle_id UUID NOT NULL REFERENCES vehicle(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  mileage INT NOT NULL,
  quantity_l NUMERIC(10,2) NOT NULL,
  price_per_l NUMERIC(10,2) NOT NULL,
  station TEXT,
  driver_employee_id UUID REFERENCES employee(id),
  project_id UUID REFERENCES project(id),   -- enables fuel → project cost allocation (spec §49)
  receipt_document_id UUID,
  created_by UUID REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fuel_vehicle ON fuel_log(vehicle_id, date);

CREATE TABLE maintenance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  vehicle_id UUID REFERENCES vehicle(id),
  equipment_id UUID,
  kind maintenance_kind NOT NULL,
  date DATE NOT NULL,
  mileage INT,
  hours NUMERIC(10,1),
  description TEXT,
  parts_cost NUMERIC(12,2) DEFAULT 0,
  labor_cost NUMERIC(12,2) DEFAULT 0,
  total_cost NUMERIC(12,2) DEFAULT 0,
  supplier_id UUID REFERENCES supplier(id),
  next_due_date DATE,
  next_due_mileage INT,
  document_id UUID,
  created_by UUID REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (vehicle_id IS NOT NULL OR equipment_id IS NOT NULL)
);

CREATE TABLE tire (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  vehicle_id UUID REFERENCES vehicle(id) ON DELETE SET NULL,
  reference TEXT NOT NULL,
  position TEXT,                    -- FL, FR, RL, RR, spare
  installed_at DATE,
  installed_mileage INT,
  condition TEXT CHECK (condition IN ('new','good','worn','replace')),
  cost NUMERIC(12,2),
  supplier_id UUID REFERENCES supplier(id)
);

CREATE TABLE equipment (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  name TEXT NOT NULL,
  serial_number TEXT,
  kind TEXT,                        -- blasting pot, mixer, sandblaster, generator...
  location TEXT,
  project_id UUID REFERENCES project(id),
  responsible_employee_id UUID REFERENCES employee(id),
  usage_hours NUMERIC(12,1) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','in_use','maintenance','out_of_service')),
  qr_code TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE equipment_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  project_id UUID REFERENCES project(id),
  date DATE NOT NULL,
  hours NUMERIC(8,1) NOT NULL,
  operator_employee_id UUID REFERENCES employee(id),
  notes TEXT
);
