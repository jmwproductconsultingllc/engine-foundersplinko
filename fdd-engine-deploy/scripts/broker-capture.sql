-- scripts/broker-capture.sql — Risk-Reframe build, Change 2 (broker capture).
-- Run this in the FoundersPlinko Supabase SQL editor BEFORE deploying the code
-- that writes broker_name (app/api/lead/enrich + lib/supabaseLeads). Migration-
-- before-code: the enrich write degrades gracefully if the column is missing
-- (enrichLead catches the error and returns false), but run this first so the
-- warm-handoff signal actually lands.
--
-- Idempotent: safe to run more than once.

-- Optional, free-form broker/consultant name captured at S4 (progressive
-- profile). Nullable — most leads won't have one. Inherits the table's existing
-- service_role grant + RLS (service-role writes bypass RLS; anon reads nothing).
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS broker_name text;

-- Derived qualification signal: has-broker = a real buying process (not a
-- dreamer), feeds persona / capital-fit. GENERATED so it can never drift from
-- broker_name and application code never sets it.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS has_broker boolean
  GENERATED ALWAYS AS (broker_name IS NOT NULL) STORED;

-- Reporting convenience: find warm-handoff leads fast.
CREATE INDEX IF NOT EXISTS leads_has_broker_idx ON public.leads (has_broker)
  WHERE has_broker;
