-- 001_extensions.sql
-- Spec §47: core extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enumerated types used across the system
CREATE TYPE user_status AS ENUM ('active', 'disabled');
CREATE TYPE entity_kind AS ENUM (
  'client','supplier','contract','quote','project','invoice','payment','material',
  'vehicle','equipment','employee','expense','purchase_order','document','user','stock_movement'
);

CREATE TYPE quote_status AS ENUM ('draft','review','approved','sent','accepted','rejected','converted');
CREATE TYPE project_status AS ENUM ('planned','in_progress','suspended','completed','cancelled');
CREATE TYPE project_task_status AS ENUM ('todo','in_progress','blocked','done');
CREATE TYPE invoice_status AS ENUM ('draft','approved','issued','partially_paid','paid','overdue','cancelled');
CREATE TYPE payment_method AS ENUM ('cash','bank_transfer','cheque','other');
CREATE TYPE stock_movement_kind AS ENUM ('entry','exit','reservation','release','consumption','transfer','adjustment');
CREATE TYPE purchase_status AS ENUM ('draft','requested','approved','ordered','partially_received','received','cancelled');
CREATE TYPE maintenance_kind AS ENUM ('preventive','corrective','inspection');
CREATE TYPE communication_kind AS ENUM ('email','note','call','letter','portal_message');
CREATE TYPE communication_direction AS ENUM ('inbound','outbound');
CREATE TYPE document_status AS ENUM ('pending','ocr_processing','needs_confirmation','confirmed','rejected');
CREATE TYPE recommendation_status AS ENUM ('open','accepted','rejected','applied');
CREATE TYPE incident_severity AS ENUM ('low','medium','high','critical');
CREATE TYPE incident_status AS ENUM ('open','investigating','resolved','closed');
CREATE TYPE attendance_kind AS ENUM ('present','absent','leave','half_day','mission');
CREATE TYPE audit_action AS ENUM (
  'create','update','delete','login','logout','login_failed','permission_change',
  'approve','reject','payment','stock_adjustment','document_access','export',
  'ai_recommendation_decision','status_change','convert'
);
