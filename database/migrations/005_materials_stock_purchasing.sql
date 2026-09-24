-- 005_materials_stock_purchasing.sql
-- Material calculation rules are DATA (spec §19: formulas configurable, not hardcoded).
CREATE TABLE material (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'resin','hardener','primer','quartz','pigment','solvent','ppe','consumable','other'
  )),
  unit TEXT NOT NULL, -- kg, L, unit, m2...
  default_supplier_id UUID REFERENCES supplier(id),
  purchase_price NUMERIC(14,2),
  min_stock NUMERIC(14,3) DEFAULT 0,
  max_stock NUMERIC(14,3) DEFAULT 0,
  shelf_life_days INT,          -- expiry where applicable
  requires_batch BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, sku)
);

CREATE TABLE material_rule (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  material_id UUID NOT NULL REFERENCES material(id) ON DELETE CASCADE,
  product_type TEXT NOT NULL,        -- e.g. epoxy_self_leveling, quartz_broadcast, primer
  coverage_rate NUMERIC(10,4) NOT NULL, -- per layer: kg/m² or L/m²
  coverage_unit TEXT NOT NULL CHECK (coverage_unit IN ('kg_per_m2','l_per_m2')),
  number_of_layers INT NOT NULL DEFAULT 1,
  loss_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  reference_thickness_mm NUMERIC(6,2) NOT NULL DEFAULT 0,
  valid_from DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE stock_location (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'warehouse' CHECK (kind IN ('warehouse','container','vehicle','site'))
);

CREATE TABLE stock_movement (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  material_id UUID NOT NULL REFERENCES material(id),
  location_id UUID REFERENCES stock_location(id),
  kind stock_movement_kind NOT NULL,
  quantity NUMERIC(14,3) NOT NULL, -- positive; kind gives sign
  batch_number TEXT,
  expiry_date DATE,
  project_id UUID,
  purchase_line_id UUID,
  reason TEXT,
  unit_cost NUMERIC(14,2),
  created_by UUID REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_material ON stock_movement(company_id, material_id);

-- Maintained by triggers/application: per material+location physical/reserved
CREATE TABLE stock_level (
  material_id UUID NOT NULL REFERENCES material(id),
  location_id UUID REFERENCES stock_location(id),
  company_id UUID NOT NULL REFERENCES company(id),
  physical NUMERIC(14,3) NOT NULL DEFAULT 0,
  reserved NUMERIC(14,3) NOT NULL DEFAULT 0,
  PRIMARY KEY (material_id, location_id)
);

CREATE TABLE project_material_reservation (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES material(id),
  quantity NUMERIC(14,3) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','consumed')),
  created_by UUID REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE project_material_consumption (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES material(id),
  measurement_id UUID,
  planned_quantity NUMERIC(14,3),
  actual_quantity NUMERIC(14,3) NOT NULL,
  variance NUMERIC(14,3) GENERATED ALWAYS AS (actual_quantity - planned_quantity) STORED,
  reason_code TEXT,    -- rework, surface_condition, loss, measurement_error, thickness, other
  reason_note TEXT,
  recorded_by UUID REFERENCES "user"(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_consumption_project ON project_material_consumption(project_id);

CREATE TABLE purchase_order (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  supplier_id UUID NOT NULL REFERENCES supplier(id),
  number TEXT NOT NULL,
  status purchase_status NOT NULL DEFAULT 'draft',
  project_id UUID REFERENCES project(id),
  expected_delivery DATE,
  created_by UUID REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);

CREATE TABLE purchase_line (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES material(id),
  quantity NUMERIC(14,3) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL,
  received_quantity NUMERIC(14,3) NOT NULL DEFAULT 0
);

CREATE TABLE goods_receipt (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  purchase_order_id UUID NOT NULL REFERENCES purchase_order(id),
  received_by UUID REFERENCES "user"(id),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT
);
