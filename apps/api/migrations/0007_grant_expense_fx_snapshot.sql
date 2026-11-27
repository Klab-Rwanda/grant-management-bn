-- Up Migration
ALTER TABLE line_item_allocations
  ADD COLUMN IF NOT EXISTS fx_rate_to_grant numeric(18, 8),
  ADD COLUMN IF NOT EXISTS converted_amount numeric(19, 4);

ALTER TABLE line_item_allocations
  ADD CONSTRAINT line_item_allocations_fx_rate_positive
    CHECK (fx_rate_to_grant IS NULL OR fx_rate_to_grant > 0),
  ADD CONSTRAINT line_item_allocations_converted_amount_positive
    CHECK (converted_amount IS NULL OR converted_amount > 0);

ALTER TABLE submission_items
  ADD COLUMN IF NOT EXISTS functional_amount numeric(19, 4),
  ADD COLUMN IF NOT EXISTS functional_currency char(3),
  ADD COLUMN IF NOT EXISTS fx_rate_to_grant numeric(18, 8);

ALTER TABLE submission_items
  ADD CONSTRAINT submission_items_fx_rate_positive
    CHECK (fx_rate_to_grant IS NULL OR fx_rate_to_grant > 0);

-- Down Migration
ALTER TABLE submission_items
  DROP CONSTRAINT IF EXISTS submission_items_fx_rate_positive,
  DROP COLUMN IF EXISTS fx_rate_to_grant,
  DROP COLUMN IF EXISTS functional_currency,
  DROP COLUMN IF EXISTS functional_amount;

ALTER TABLE line_item_allocations
  DROP CONSTRAINT IF EXISTS line_item_allocations_converted_amount_positive,
  DROP CONSTRAINT IF EXISTS line_item_allocations_fx_rate_positive,
  DROP COLUMN IF EXISTS converted_amount,
  DROP COLUMN IF EXISTS fx_rate_to_grant;
