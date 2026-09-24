-- 010_ai_scenarios_workflow.sql + cross-FK additions
CREATE TABLE ai_document_chunk (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  source_type TEXT NOT NULL,        -- project, invoice, contract, daily_report, email...
  source_id UUID NOT NULL,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  permission_tags TEXT[] NOT NULL,  -- role filter at retrieval (spec §44)
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chunk_tsv ON ai_document_chunk USING gin (tsv);
CREATE INDEX idx_chunk_permission ON ai_document_chunk USING gin (permission_tags);

CREATE TABLE ai_embedding (
  chunk_id UUID NOT NULL REFERENCES ai_document_chunk(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  embedding VECTOR(1536),           -- requires pgvector; adjust dims per model
  PRIMARY KEY (chunk_id, provider, model)
);

CREATE TABLE ai_interaction (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  user_id UUID REFERENCES "user"(id),
  question TEXT NOT NULL,
  answer TEXT,
  evidence JSONB,
  assumptions JSONB,
  uncertainty TEXT,
  tool_calls JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ai_recommendation (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  kind TEXT NOT NULL,               -- risk, restock, maintenance, delay, cash
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  analysis TEXT NOT NULL,
  evidence JSONB,
  assumptions JSONB,
  confidence NUMERIC(4,3),
  status recommendation_status NOT NULL DEFAULT 'open',
  decided_by UUID REFERENCES "user"(id),
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE scenario (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  name TEXT NOT NULL,
  definition JSONB NOT NULL,        -- add_team, remove_team, price_change...
  created_by UUID REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE scenario_run (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scenario_id UUID NOT NULL REFERENCES scenario(id) ON DELETE CASCADE,
  result JSONB NOT NULL,
  assumptions JSONB,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workflow_execution (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID,
  workflow TEXT NOT NULL,
  trigger_event TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  input JSONB,
  output JSONB,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

-- Cross-module foreign keys deferred to avoid circular creation order
ALTER TABLE quote_line
  ADD CONSTRAINT fk_ql_material FOREIGN KEY (material_id) REFERENCES material(id),
  ADD CONSTRAINT fk_ql_measurement FOREIGN KEY (measurement_id) REFERENCES project_measurement(id);
ALTER TABLE material
  ADD CONSTRAINT fk_material_supplier FOREIGN KEY (default_supplier_id) REFERENCES supplier(id);
ALTER TABLE company
  ADD CONSTRAINT fk_company_logo FOREIGN KEY (logo_document_id) REFERENCES document(id);
ALTER TABLE daily_report
  ADD CONSTRAINT fk_dr_voice FOREIGN KEY (voice_note_document_id) REFERENCES document(id);
ALTER TABLE quality_check
  ADD CONSTRAINT fk_qc_doc FOREIGN KEY (document_id) REFERENCES document(id);
ALTER TABLE incident
  ADD CONSTRAINT fk_inc_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicle(id),
  ADD CONSTRAINT fk_inc_equipment FOREIGN KEY (equipment_id) REFERENCES equipment(id);
ALTER TABLE expense
  ADD CONSTRAINT fk_exp_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicle(id),
  ADD CONSTRAINT fk_exp_equipment FOREIGN KEY (equipment_id) REFERENCES equipment(id);
ALTER TABLE work_log
  ADD CONSTRAINT fk_wl_voice FOREIGN KEY (voice_note_document_id) REFERENCES document(id);
ALTER TABLE supplier_invoice
  ADD CONSTRAINT fk_si_po FOREIGN KEY (purchase_order_id) REFERENCES purchase_order(id);
ALTER TABLE fuel_log
  ADD CONSTRAINT fk_fl_receipt FOREIGN KEY (receipt_document_id) REFERENCES document(id);
ALTER TABLE maintenance
  ADD CONSTRAINT fk_maint_doc FOREIGN KEY (document_id) REFERENCES document(id);
ALTER TABLE expense
  ADD CONSTRAINT fk_exp_doc FOREIGN KEY (document_id) REFERENCES document(id);
ALTER TABLE invoice
  ADD CONSTRAINT fk_inv_po FOREIGN KEY (project_id) REFERENCES project(id),
  ADD CONSTRAINT fk_inv_contract FOREIGN KEY (contract_id) REFERENCES contract(id),
  ADD CONSTRAINT fk_inv_client FOREIGN KEY (client_id) REFERENCES client(id);
ALTER TABLE payment
  ADD CONSTRAINT fk_pay_proof FOREIGN KEY (proof_document_id) REFERENCES document(id);
ALTER TABLE communication
  ADD CONSTRAINT fk_comm_doc_client FOREIGN KEY (client_id) REFERENCES client(id),
  ADD CONSTRAINT fk_comm_project FOREIGN KEY (project_id) REFERENCES project(id);
ALTER TABLE attendance
  ADD CONSTRAINT fk_att_project FOREIGN KEY (project_id) REFERENCES project(id);
ALTER TABLE team_assignment
  ADD CONSTRAINT fk_ta_team FOREIGN KEY (team_id) REFERENCES team(id);
ALTER TABLE vehicle_assignment
  ADD CONSTRAINT fk_va_project FOREIGN KEY (project_id) REFERENCES project(id);
ALTER TABLE project_member
  ADD CONSTRAINT fk_pm_employee FOREIGN KEY (employee_id) REFERENCES employee(id),
  ADD CONSTRAINT fk_pm_user FOREIGN KEY (user_id) REFERENCES "user"(id);
ALTER TABLE project_task
  ADD CONSTRAINT fk_pt_assignee FOREIGN KEY (assignee_employee_id) REFERENCES employee(id);
ALTER TABLE team
  ADD CONSTRAINT fk_team_leader FOREIGN KEY (leader_employee_id) REFERENCES employee(id);
ALTER TABLE supplier_invoice
  ADD CONSTRAINT fk_si_supplier FOREIGN KEY (supplier_id) REFERENCES supplier(id);
ALTER TABLE purchase_order
  ADD CONSTRAINT fk_po_project FOREIGN KEY (project_id) REFERENCES project(id);
ALTER TABLE fuel_log
  ADD CONSTRAINT fk_fl_project FOREIGN KEY (project_id) REFERENCES project(id);
ALTER TABLE scenario
  ADD CONSTRAINT fk_scn_created FOREIGN KEY (created_by) REFERENCES "user"(id);
ALTER TABLE ai_recommendation
  ADD CONSTRAINT fk_rec_decider FOREIGN KEY (decided_by) REFERENCES "user"(id);
ALTER TABLE project_material_consumption
  ADD CONSTRAINT fk_pmc_measurement FOREIGN KEY (measurement_id) REFERENCES project_measurement(id);
