-- ============================================
-- FIX: public.triage_results.language column
-- Run in: Supabase Dashboard -> SQL Editor
-- ============================================
-- The live database is missing the `language` column on public.triage_results,
-- so AI triage results (language, and indirectly confidence/priority) are
-- never persisted for citizen or walk-in complaints. This migration is
-- idempotent and safe to re-run.

ALTER TABLE public.triage_results
  ADD COLUMN IF NOT EXISTS language TEXT;

-- Optional: backfill is not possible (original language was never stored),
-- but future submissions will persist it. The application also degrades
-- gracefully if the column is still absent.

CREATE INDEX IF NOT EXISTS idx_triage_results_complaint_id
  ON public.triage_results (complaint_id);