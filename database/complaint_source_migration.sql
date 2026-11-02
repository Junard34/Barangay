-- Add and normalize the intake source for complaints on existing Supabase databases.
ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'online';

UPDATE public.complaints
SET source = 'online'
WHERE source IS NULL OR trim(source) = '';