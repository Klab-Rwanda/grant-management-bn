-- Up Migration
-- ============================================================================
-- 1. EXTENSIONS & APPLICATION ROLE
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grant_ledger_app') THEN
    CREATE ROLE grant_ledger_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid;
$$;

-- ============================================================================
-- 2. ENUM TYPES
-- ============================================================================
DO $$ BEGIN CREATE TYPE org_type_enum AS ENUM ('STARTUP', 'INSTITUTION', 'PLATFORM'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE org_status_enum AS ENUM ('ACTIVE', 'SUSPENDED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE user_status_enum AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE role_enum AS ENUM ('FDR', 'FIN', 'OPS', 'PM', 'REV', 'APR', 'ADM'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE membership_status_enum AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE actor_type_enum AS ENUM ('USER', 'SYSTEM', 'API_KEY'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE account_type_enum AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE period_status_enum AS ENUM ('OPEN', 'CLOSED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE journal_status_enum AS ENUM ('DRAFT', 'POSTED', 'REVERSED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE journal_source_enum AS ENUM ('MANUAL', 'SIMPLE_EXPENSE', 'REVERSAL', 'DISBURSEMENT', 'BANK_IMPORT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE funding_model_enum AS ENUM ('ADVANCE', 'REIMBURSEMENT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE program_status_enum AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE grant_status_enum AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'COMPLETED', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE tranche_availability_enum AS ENUM ('LOCKED', 'ACTIVE', 'CLOSED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE tranche_review_status_enum AS ENUM (
  'NOT_STARTED',
  'DRAFT',
  'SUBMITTED_PENDING_REVIEW',
  'CHANGES_REQUESTED',
  'VERIFIED_PENDING_APPROVAL',
  'APPROVED_FOR_DISBURSEMENT',
  'DISBURSED_AWAITING_EXPENSES',
  'DISBURSED_AND_RECONCILED',
  'CANCELLED'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE milestone_status_enum AS ENUM ('PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE doc_type_enum AS ENUM ('INVOICE', 'RECEIPT', 'BANK_WIRE_SLIP', 'TAX_FILING', 'DELIVERABLE', 'OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE source_channel_enum AS ENUM ('WEB_UPLOAD', 'MOBILE_PWA', 'API'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE scan_status_enum AS ENUM ('PENDING_UPLOAD', 'PENDING_SCAN', 'CLEAN', 'INFECTED', 'REJECTED_INVALID_FILE', 'SCAN_FAILED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE duplicate_flag_enum AS ENUM ('CLEAR', 'POSSIBLE_DUPLICATE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE fingerprint_type_enum AS ENUM ('SHA256', 'METADATA_HMAC'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE allocation_status_enum AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE review_decision_enum AS ENUM ('APPROVED', 'REJECTED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE disbursement_status_enum AS ENUM (
  'AUTHORIZED',
  'RECORDED_BY_INSTITUTION',
  'CONFIRMED_BY_STARTUP',
  'PARTIAL',
  'PAYMENT_DISPUTED',
  'REVERSED',
  'RECONCILED'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE outbox_status_enum AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 3. SECURITY BASE: ORGANIZATIONS, USERS, MEMBERSHIPS, INVITATIONS & AUDIT
-- ============================================================================
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  tax_id text,
  org_type org_type_enum NOT NULL,
  country char(2) NOT NULL,
  functional_currency char(3) NOT NULL DEFAULT 'USD',
  books_closed_through date,
  fiscal_year_start_month smallint NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  status org_status_enum NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  full_name text NOT NULL,
  password_hash text,
  mfa_enabled boolean NOT NULL DEFAULT false,
  mfa_secret_ref text,
  sso_provider text,
  sso_subject text,
  status user_status_enum NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sso_provider, sso_subject)
);

CREATE TABLE IF NOT EXISTS memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role role_enum NOT NULL,
  scope_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status membership_status_enum NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role role_enum NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,
  invited_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  seq_no bigint NOT NULL CHECK (seq_no > 0),
  actor_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  actor_type actor_type_enum NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  ip inet,
  user_agent text,
  prev_hash char(64) NOT NULL,
  hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, seq_no)
);

-- Append-only trigger for audit_logs
CREATE OR REPLACE FUNCTION fn_block_audit_log_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only; UPDATE and DELETE are prohibited';
END $$;

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION fn_block_audit_log_mutation();

-- RLS for Security Base tables
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_memberships_tenant ON memberships;
CREATE POLICY p_memberships_tenant ON memberships FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_invitations_tenant ON invitations;
CREATE POLICY p_invitations_tenant ON invitations FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_audit_logs_tenant ON audit_logs;
CREATE POLICY p_audit_logs_tenant ON audit_logs FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

-- Non-owner privileges
GRANT USAGE ON SCHEMA public TO grant_ledger_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON organizations, users, memberships, invitations, audit_logs TO grant_ledger_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM grant_ledger_app, PUBLIC;

-- Down Migration
DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON audit_logs;
DROP FUNCTION IF EXISTS fn_block_audit_log_mutation();
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS invitations;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS organizations;
