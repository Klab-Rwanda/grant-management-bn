-- -------------------------------------------------
-- 1. Core ledger tables (already existing in Milestones 1‑3)
-- -------------------------------------------------
-- (these are already present, kept for reference)

-- -------------------------------------------------
-- 2. Grant‑module tables (Milestone 4)
-- -------------------------------------------------
CREATE TABLE IF NOT EXISTS grants (
    id               UUID PRIMARY KEY,
    tenant_id        UUID NOT NULL REFERENCES tenants(id),
    name             TEXT NOT NULL,
    description      TEXT,
    total_budget     NUMERIC(19,4) NOT NULL,   -- DecimalString in API
    status           TEXT CHECK (status IN ('DRAFT','ACTIVE','CLOSED')) NOT NULL,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE grants FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS grant_milestones (
    id               UUID PRIMARY KEY,
    grant_id         UUID NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
    tenant_id        UUID NOT NULL REFERENCES tenants(id),
    name             TEXT NOT NULL,
    start_date       DATE NOT NULL,
    end_date         DATE NOT NULL,
    status           TEXT CHECK (status IN ('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED')) NOT NULL,
    created_at       TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE grant_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE grant_milestones FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS grant_budgets (
    id               UUID PRIMARY KEY,
    grant_id         UUID NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
    tenant_id        UUID NOT NULL REFERENCES tenants(id),
    period_id        UUID NOT NULL REFERENCES accounting_periods(id),
    amount           NUMERIC(19,4) NOT NULL,   -- DecimalString – allocated budget
    spent_amount     NUMERIC(19,4) DEFAULT 0,
    created_at       TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE grant_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE grant_budgets FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS grant_applications (
    id               UUID PRIMARY KEY,
    grant_id         UUID NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
    tenant_id        UUID NOT NULL REFERENCES tenants(id),
    applicant_user_id UUID NOT NULL,
    status           TEXT CHECK (status IN ('SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED')) NOT NULL,
    submitted_at     TIMESTAMPTZ DEFAULT now(),
    evaluated_at     TIMESTAMPTZ,
    decision         TEXT,
    created_at       TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE grant_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE grant_applications FORCE ROW LEVEL SECURITY;

-- -------------------------------------------------
-- 3. Append‑only + RLS policies (simplified examples)
-- -------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_modifications()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Table % is append‑only; modifications are not allowed', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN ARRAY['grants','grant_milestones','grant_budgets','grant_applications'] LOOP
        EXECUTE format('CREATE TRIGGER trg_%I_no_mod BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION prevent_modifications();', tbl, tbl);
    END LOOP;
END $$;

-- Row‑level security: every tenant sees only its rows
ALTER TABLE grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE grant_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE grant_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE grant_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_grants ON grants USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_milestones ON grant_milestones USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_budgets ON grant_budgets USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_applications ON grant_applications USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- -------------------------------------------------
-- 4. Budget‑spend check trigger (ensures expenses don’t exceed budget)
-- -------------------------------------------------
CREATE OR REPLACE FUNCTION check_budget_spend()
RETURNS trigger AS $$
DECLARE
    budget_rec RECORD;
BEGIN
    IF TG_OP = 'INSERT' AND NEW.grant_budget_id IS NOT NULL THEN
        SELECT * INTO budget_rec FROM grant_budgets WHERE id = NEW.grant_budget_id FOR UPDATE;
        IF budget_rec IS NULL THEN
            RAISE EXCEPTION 'Budget % not found', NEW.grant_budget_id;
        END IF;
        IF budget_rec.spent_amount + NEW.amount > budget_rec.amount THEN
            RAISE EXCEPTION 'Budget % would be exceeded (remaining %.4f)', NEW.grant_budget_id,
                (budget_rec.amount - budget_rec.spent_amount);
        END IF;
        UPDATE grant_budgets SET spent_amount = spent_amount + NEW.amount WHERE id = NEW.grant_budget_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_line_budget_check
    BEFORE INSERT ON journal_lines
    FOR EACH ROW EXECUTE FUNCTION check_budget_spend();
