-- Migration to add grant_budget_id column to journal_lines (Milestone 4 support)
CREATE OR REPLACE FUNCTION add_grant_budget_id_column() RETURNS void AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='journal_lines' AND column_name='grant_budget_id') THEN
    ALTER TABLE journal_lines
      ADD COLUMN grant_budget_id uuid NULL REFERENCES grant_budgets(id) ON DELETE RESTRICT;
  END IF;
END;
$$ LANGUAGE plpgsql;

SELECT add_grant_budget_id_column();

-- Add foreign key constraint after column creation (if not already present)
ALTER TABLE journal_lines
  ADD CONSTRAINT fk_journal_lines_grant_budget_id
    FOREIGN KEY (grant_budget_id) REFERENCES grant_budgets(id) ON DELETE RESTRICT;
