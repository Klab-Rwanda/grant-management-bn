-- Up Migration
-- ============================================================================
-- MODULE A: STARTUP DOUBLE-ENTRY ACCOUNTING LEDGER
-- ============================================================================

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  account_type account_type_enum NOT NULL,
  account_subtype text,
  is_contra boolean NOT NULL DEFAULT false,
  parent_id uuid,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, parent_id) REFERENCES accounts(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS accounting_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status period_status_enum NOT NULL DEFAULT 'OPEN',
  closed_at timestamptz,
  closed_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_start <= period_end),
  UNIQUE (tenant_id, id),
  EXCLUDE USING gist (tenant_id WITH =, daterange(period_start, period_end, '[]') WITH &&)
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  entry_date date NOT NULL,
  period_id uuid NOT NULL,
  memo text NOT NULL,
  status journal_status_enum NOT NULL DEFAULT 'DRAFT',
  source journal_source_enum NOT NULL DEFAULT 'MANUAL',
  reverses_entry_id uuid,
  created_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, period_id) REFERENCES accounting_periods(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, reverses_entry_id) REFERENCES journal_entries(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_entries_reverses
  ON journal_entries (tenant_id, reverses_entry_id)
  WHERE reverses_entry_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  journal_entry_id uuid NOT NULL,
  line_order integer NOT NULL CHECK (line_order > 0),
  account_id uuid NOT NULL,
  debit numeric(19, 4) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(19, 4) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  fx_rate numeric(18, 8) NOT NULL DEFAULT 1 CHECK (fx_rate > 0),
  amount_functional numeric(19, 4) NOT NULL CHECK (amount_functional > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)),
  UNIQUE (tenant_id, id),
  UNIQUE (journal_entry_id, line_order),
  FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES journal_entries(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, account_id) REFERENCES accounts(tenant_id, id) ON DELETE RESTRICT
);

-- ============================================================================
-- TRIGGERS & CONSTRAINTS
-- ============================================================================

-- Lock account code/type/contra and prevent delete once posted lines exist
CREATE OR REPLACE FUNCTION fn_protect_used_accounts() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  has_lines boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM journal_lines
    WHERE tenant_id = OLD.tenant_id AND account_id = OLD.id
  ) INTO has_lines;

  IF has_lines THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Cannot delete account % with existing journal lines; archive instead', OLD.code;
    END IF;
    IF NEW.code IS DISTINCT FROM OLD.code
       OR NEW.account_type IS DISTINCT FROM OLD.account_type
       OR NEW.is_contra IS DISTINCT FROM OLD.is_contra THEN
      RAISE EXCEPTION 'Cannot modify code, account_type, or is_contra on account % with existing journal lines', OLD.code;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_accounts_protect_used ON accounts;
CREATE TRIGGER trg_accounts_protect_used
  BEFORE UPDATE OR DELETE ON accounts
  FOR EACH ROW EXECUTE FUNCTION fn_protect_used_accounts();

-- Protect posted journal entries & require open period on posting
CREATE OR REPLACE FUNCTION fn_protect_journal_entries() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_period_status period_status_enum;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('POSTED', 'REVERSED') THEN
      RAISE EXCEPTION 'Posted or reversed journal entry % cannot be deleted; create a reversal instead', OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IN ('POSTED', 'REVERSED') THEN
    IF OLD.status = 'POSTED'
       AND NEW.status = 'REVERSED'
       AND NEW.tenant_id = OLD.tenant_id
       AND NEW.entry_date = OLD.entry_date
       AND NEW.period_id = OLD.period_id
       AND NEW.memo = OLD.memo
       AND NEW.source = OLD.source
       AND NEW.reverses_entry_id IS NOT DISTINCT FROM OLD.reverses_entry_id THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Posted journal entry % is immutable; create a reversal entry instead', OLD.id;
  END IF;

  IF NEW.status = 'POSTED' AND (TG_OP = 'INSERT' OR OLD.status = 'DRAFT') THEN
    SELECT status INTO v_period_status
    FROM accounting_periods
    WHERE tenant_id = NEW.tenant_id
      AND id = NEW.period_id
      AND NEW.entry_date BETWEEN period_start AND period_end;

    IF v_period_status IS NULL THEN
      RAISE EXCEPTION 'Entry date % does not fall within assigned accounting period %', NEW.entry_date, NEW.period_id;
    END IF;
    IF v_period_status = 'CLOSED' THEN
      RAISE EXCEPTION 'Cannot post journal entry into CLOSED accounting period %', NEW.period_id;
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_journal_entries_protect ON journal_entries;
CREATE TRIGGER trg_journal_entries_protect
  BEFORE INSERT OR UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION fn_protect_journal_entries();

-- Block edits to journal lines on posted/reversed entries
CREATE OR REPLACE FUNCTION fn_protect_journal_lines() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_entry_id uuid := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  v_tenant_id uuid := COALESCE(NEW.tenant_id, OLD.tenant_id);
  v_status journal_status_enum;
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_status
  FROM journal_entries
  WHERE tenant_id = v_tenant_id AND id = v_entry_id;

  IF v_status IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'Cannot modify journal lines of posted/reversed entry %', v_entry_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_journal_lines_protect ON journal_lines;
CREATE TRIGGER trg_journal_lines_protect
  BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION fn_protect_journal_lines();

-- Deferred constraint trigger: debits MUST equal credits in functional currency on commit
CREATE OR REPLACE FUNCTION fn_check_journal_entry_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_entry_id uuid;
  v_tenant_id uuid;
  v_status journal_status_enum;
  v_line_count integer;
  v_debit_sum numeric(19, 4);
  v_credit_sum numeric(19, 4);
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    v_entry_id := NEW.id;
    v_tenant_id := NEW.tenant_id;
  ELSE
    v_entry_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
    v_tenant_id := COALESCE(NEW.tenant_id, OLD.tenant_id);
  END IF;

  SELECT status INTO v_status
  FROM journal_entries
  WHERE tenant_id = v_tenant_id AND id = v_entry_id;

  IF v_status IS NULL OR v_status = 'DRAFT' THEN
    RETURN NULL;
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(CASE WHEN debit > 0 THEN amount_functional ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN credit > 0 THEN amount_functional ELSE 0 END), 0)
  INTO v_line_count, v_debit_sum, v_credit_sum
  FROM journal_lines
  WHERE tenant_id = v_tenant_id AND journal_entry_id = v_entry_id;

  IF v_line_count < 2 THEN
    RAISE EXCEPTION 'Posted journal entry % must have at least 2 lines', v_entry_id;
  END IF;

  IF v_debit_sum <= 0 OR v_debit_sum <> v_credit_sum THEN
    RAISE EXCEPTION 'Unbalanced journal entry %: debits (%) <> credits (%)', v_entry_id, v_debit_sum, v_credit_sum
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_journal_entries_balanced ON journal_entries;
CREATE CONSTRAINT TRIGGER trg_journal_entries_balanced
  AFTER INSERT OR UPDATE OF status ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_check_journal_entry_balanced();

DROP TRIGGER IF EXISTS trg_journal_lines_balanced ON journal_lines;
CREATE CONSTRAINT TRIGGER trg_journal_lines_balanced
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_check_journal_entry_balanced();

-- ============================================================================
-- ROW-LEVEL SECURITY
-- ============================================================================
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_accounts_tenant ON accounts;
CREATE POLICY p_accounts_tenant ON accounts FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_periods FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_accounting_periods_tenant ON accounting_periods;
CREATE POLICY p_accounting_periods_tenant ON accounting_periods FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_journal_entries_tenant ON journal_entries;
CREATE POLICY p_journal_entries_tenant ON journal_entries FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_journal_lines_tenant ON journal_lines;
CREATE POLICY p_journal_lines_tenant ON journal_lines FOR ALL
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

-- Grant privileges to application role
GRANT SELECT, INSERT, UPDATE, DELETE ON accounts, accounting_periods, journal_entries, journal_lines TO grant_ledger_app;

-- Down Migration
DROP TABLE IF EXISTS journal_lines;
DROP TABLE IF EXISTS journal_entries;
DROP TABLE IF EXISTS accounting_periods;
DROP TABLE IF EXISTS accounts;
