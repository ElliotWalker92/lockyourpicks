-- Add form layer columns to model_calibration.
-- Nullable: existing rows pre-date form tracking and will have NULL here.
ALTER TABLE model_calibration
  ADD COLUMN IF NOT EXISTS form_home numeric(7,5),
  ADD COLUMN IF NOT EXISTS form_draw numeric(7,5),
  ADD COLUMN IF NOT EXISTS form_away numeric(7,5);
