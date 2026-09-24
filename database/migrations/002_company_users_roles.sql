-- 002_company_users_roles.sql
-- Multi-tenant core: every company-owned record carries company_id (spec §48).
CREATE TABLE company (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  legal_name TEXT,
  nif TEXT,                 -- Numéro d'Identification Fiscale (Algeria)
  nis TEXT,                 -- Numéro d'Identification Statistique
  rc TEXT,                  -- Registre de Commerce
  address TEXT,
  phone TEXT,
  email TEXT,
  logo_document_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "user" (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES company(id), -- NULL allowed for portal customers pre-link; enforced at app layer
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  locale TEXT NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr','ar','en')),
  status user_status NOT NULL DEFAULT 'active',
  mfa_secret TEXT,
  mfa_enabled BOOLEAN NOT NULL DEFAULT false,
  failed_login_count INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_company ON "user"(company_id);

CREATE TABLE role (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES company(id),
  key TEXT NOT NULL,       -- one of domain ROLES keys; validated at app layer
  name TEXT NOT NULL,
  UNIQUE (company_id, key)
);

CREATE TABLE permission (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_id UUID NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('read','write','approve','none')),
  UNIQUE (role_id, module)
);

CREATE TABLE user_role (
  user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE refresh_token (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_user ON refresh_token(user_id);

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID,
  user_id UUID,
  user_role TEXT,
  action audit_action NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  previous_state JSONB,
  new_state JSONB,
  request_id TEXT,
  ip INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_company_time ON audit_log(company_id, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
