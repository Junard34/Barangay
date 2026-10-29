-- One-time setup for live citizen notification updates.
-- Paste this into the Supabase SQL Editor (same place you ran
-- database/evidence_files_fix.sql) and run it once.
--
-- It adds the notifications table to the Realtime publication so the citizen
-- dashboard's bell/list updates the moment a notification is inserted,
-- without reloading the page. Skipping this is safe: the dashboard still
-- loads notifications on open; only the live updates stay disabled.

alter publication supabase_realtime add table public.notifications;
