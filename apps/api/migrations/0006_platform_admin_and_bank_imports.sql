CREATE TABLE bank_statement_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  source_filename text NOT NULL CHECK (length(source_filename) BETWEEN 1 AND 255),
  statement_format text NOT NULL CHECK (statement_format = 'CAMT.053'),
  sha256_hash char(64) NOT NULL,
  status text NOT NULL DEFAULT 'REVIEW_REQUIRED' CHECK (status = 'REVIEW_REQUIRED'),
  imported_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  transaction_count integer NOT NULL CHECK (transaction_count > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sha256_hash),
  UNIQUE (tenant_id, id)
);

CREATE TABLE bank_statement_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  import_id uuid NOT NULL,
  booking_date date NOT NULL,
  amount numeric(19, 4) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL,
  direction text NOT NULL CHECK (direction IN ('CREDIT', 'DEBIT')),
  bank_reference text,
  remittance text,
  review_status text NOT NULL DEFAULT 'PENDING' CHECK (review_status = 'PENDING'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, import_id)
    REFERENCES bank_statement_imports(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX bank_statement_transactions_import_idx
  ON bank_statement_transactions(tenant_id, import_id, booking_date, id);

CREATE OR REPLACE FUNCTION app_is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.platform_admin', true) = 'true'
$$;

GRANT EXECUTE ON FUNCTION app_is_platform_admin() TO grant_ledger_app;

DROP POLICY IF EXISTS p_memberships_tenant ON memberships;
CREATE POLICY p_memberships_tenant ON memberships FOR ALL
  USING (tenant_id = app_current_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_current_tenant_id() OR app_is_platform_admin());

DROP POLICY IF EXISTS p_invitations_tenant ON invitations;
CREATE POLICY p_invitations_tenant ON invitations FOR ALL
  USING (tenant_id = app_current_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_current_tenant_id() OR app_is_platform_admin());

DROP POLICY IF EXISTS p_audit_logs_tenant ON audit_logs;
CREATE POLICY p_audit_logs_tenant ON audit_logs FOR ALL
  USING (tenant_id = app_current_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_current_tenant_id() OR app_is_platform_admin());

ALTER TABLE bank_statement_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_statement_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY p_bank_statement_imports_tenant ON bank_statement_imports FOR ALL
  USING (tenant_id = app_current_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_current_tenant_id() OR app_is_platform_admin());

ALTER TABLE bank_statement_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_statement_transactions FORCE ROW LEVEL SECURITY;
CREATE POLICY p_bank_statement_transactions_tenant ON bank_statement_transactions FOR ALL
  USING (tenant_id = app_current_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_current_tenant_id() OR app_is_platform_admin());

GRANT SELECT, INSERT ON bank_statement_imports, bank_statement_transactions TO grant_ledger_app;
DROP POLICY IF EXISTS p_grants_platform_admin_read ON grants;
CREATE POLICY p_grants_platform_admin_read ON grants FOR SELECT
  USING (app_is_platform_admin());
GRANT SELECT ON grants TO grant_ledger_app;

-- Down Migration
REVOKE SELECT ON grants FROM grant_ledger_app;
DROP POLICY IF EXISTS p_grants_platform_admin_read ON grants;
DROP POLICY IF EXISTS p_bank_statement_transactions_tenant ON bank_statement_transactions;
DROP POLICY IF EXISTS p_bank_statement_imports_tenant ON bank_statement_imports;
DROP POLICY IF EXISTS p_audit_logs_tenant ON audit_logs;
CREATE POLICY p_audit_logs_tenant ON audit_logs FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
DROP POLICY IF EXISTS p_invitations_tenant ON invitations;
CREATE POLICY p_invitations_tenant ON invitations FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
DROP POLICY IF EXISTS p_memberships_tenant ON memberships;
CREATE POLICY p_memberships_tenant ON memberships FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
DROP FUNCTION IF EXISTS app_is_platform_admin();
DROP TABLE bank_statement_transactions;
DROP TABLE bank_statement_imports;
