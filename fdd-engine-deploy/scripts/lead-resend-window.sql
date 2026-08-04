-- scripts/lead-resend-window.sql — P0 fix, 2026-08-04. RUN BEFORE DEPLOYING.
--
-- THE BUG. claimEmailSend() flips email_sent false->true and reports whether
-- this caller won. That is the right shape for the defect it was built for: the
-- multi-surface double-submit, where two capture surfaces on one page fire
-- within the same second and the reader gets two identical emails.
--
-- But leads upsert on (email, brand_slug), so the claim is not scoped to that
-- second. It is scoped to FOREVER. The first time an address submits on a slug,
-- email_sent goes true and stays true, and every submit from that address on
-- that slug for the rest of time loses the claim, sends nothing, and returns
-- HTTP 200 { ok: true }. The client's success branch is `if (res.ok &&
-- data.ok)`, so the page says "Sent — check your inbox" and no email exists.
--
-- Measured 2026-08-04 (lib/captureButtons.test.ts): ten consecutive playbook
-- submits from one address produce exactly one email, all ten reporting ok.
-- This is why Resend shows three sends in fifteen days: the playbook row for
-- jason.wright09@gmail.com has been claimed since 2026-07-28.
--
-- THE FIX. Keep the compare-and-set — it is still the only thing that holds
-- against a truly simultaneous submit — but time-box it. A claim younger than
-- the resend window blocks; an older one is re-winnable.
--
-- WINDOW = 2 minutes, and the number is a judgement call worth stating. Race
-- protection needs seconds. Two minutes additionally covers a double-click, a
-- page reload, a back-button, and the multi-surface collapse. Past that, a
-- second submit is a person who did not get the email deciding to ask again —
-- which is exactly the case that must work, because the Playbook IS the
-- fulfillment for 82 of 83 brands. Longer, and "check your spam, then retry"
-- silently fails. Shorter, and a fat-fingered double-click double-sends.
--
-- Idempotent: safe to run more than once.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS email_sent_at timestamptz;

-- BACKFILL — this is the half that unlocks the people already stuck.
--
-- Every existing email_sent=true row has email_sent_at NULL, and NULL fails the
-- `email_sent_at < cutoff` test, so without this line the migration LOCKS IN the
-- bug for exactly the cohort that has it. Backdated a year rather than to
-- created_at so it needs no assumption about which timestamp columns this table
-- carries: every one of these sends is days old, so any past value is correct
-- and a year is unambiguously outside every window we would ever pick.
UPDATE public.leads
  SET email_sent_at = now() - interval '1 year'
  WHERE email_sent IS TRUE AND email_sent_at IS NULL;

-- Reporting: "who has been waiting on a fulfillment that never dispatched."
CREATE INDEX IF NOT EXISTS leads_email_sent_at_idx ON public.leads (email_sent_at);
