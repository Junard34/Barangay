-- ============================================================================
-- CATEGORY ALIGNMENT MIGRATION (idempotent — safe to run more than once)
-- ============================================================================
-- Aligns an EXISTING database with the twelve approved complaint categories
-- used by the app (see CHANNELS in src/lib/triageService.js):
--
--   Safety Rules | Damaged Infrastructures | Medical Assistance | Noise Complaints
--   Drug Abuse | Threats | Cyberbullying | Physical Assault
--   Theft & Robbery | Scams & Fraud | Dispute/Conflict | Animal Concerns
--
-- What it does, in order:
--   1. Inserts any missing approved categories into complaint_categories.
--   2. Inserts any missing approved categories into channels, but ONLY for
--      deployments where channels holds category names (the current schema).
--      Databases created from database/supabase_migration.sql use channels for
--      intake methods ('Online form', 'SMS/Text', 'Walk-in'); those rows are
--      never touched anywhere in this file.
--   3. Remaps complaints.category_id and triage_results.category_id from the
--      legacy category names to their approved replacement.
--   4. Remaps complaints.channel_id for legacy category names (same guard as 2).
--   5. Deletes legacy category rows (and legacy category channel rows) that are
--      no longer referenced. 'Dispute/Conflict' is already an approved name, so
--      it is kept as-is.
--
-- Legacy name -> approved replacement:
--   Public Safety        -> Safety Rules
--   Infrastructure       -> Damaged Infrastructures
--   Health               -> Medical Assistance
--   Noise                -> Noise Complaints
--   Threat               -> Threats
--   Bullying/Harassment  -> Threats
--   Drug-related concern -> Drug Abuse
--
-- Run this in the Supabase SQL Editor. For the local SQLite database the same
-- alignment runs automatically from server/database.js on startup.
-- ============================================================

-- ---------------------------------------------------------------------------
-- STEP 1. Insert the approved categories that are still missing.
-- ---------------------------------------------------------------------------
INSERT INTO public.complaint_categories (name, description)
SELECT v.name, v.description
FROM (VALUES
  ('Safety Rules', 'Violations of barangay safety rules and ordinances'),
  ('Damaged Infrastructures', 'Damaged roads, drainage, lights, and other public facilities that need repair'),
  ('Medical Assistance', 'Requests for medical help, first aid, ambulance, or health-center support'),
  ('Noise Complaints', 'Noise complaints and disturbances'),
  ('Drug Abuse', 'Reports involving illegal drugs or substance abuse'),
  ('Threats', 'Reports of threats, intimidation, stalking, or harassment toward a person'),
  ('Cyberbullying', 'Reports of online harassment, bullying, or humiliating posts on social media'),
  ('Physical Assault', 'Reports of physical violence, fights, or attacks'),
  ('Theft & Robbery', 'Reports of stolen property, snatching, burglary, and robbery'),
  ('Scams & Fraud', 'Reports of estafa, fake sellers, fake products, and money schemes'),
  ('Dispute/Conflict', 'Interpersonal or community disputes requiring mediation'),
  ('Animal Concerns', 'Reports about stray, loose, or aggressive animals and animal bites')
) AS v(name, description)
WHERE NOT EXISTS (
  SELECT 1 FROM public.complaint_categories c WHERE c.name = v.name
);

-- ---------------------------------------------------------------------------
-- STEP 2. Insert the approved categories into channels, only when channels
--         stores category names rather than intake methods.
-- ---------------------------------------------------------------------------
INSERT INTO public.channels (name, description)
SELECT v.name, v.description
FROM (VALUES
  ('Safety Rules', 'Reports of barangay rule or ordinance violations, such as curfew violations, speeding, blocked emergency routes, unsafe fireworks, or prohibited activities.'),
  ('Damaged Infrastructures', 'Reports of damaged public roads, bridges, sidewalks, drainage, streetlights, water pipes, or other community facilities that may need repair.'),
  ('Medical Assistance', 'Requests for medical help, first aid, ambulance transport, or health-center support for illness, injury, or other urgent health concerns.'),
  ('Noise Complaints', 'Reports of excessive or repeated noise that disturbs residents, including loud music, karaoke, construction, shouting, or late-night disturbances.'),
  ('Drug Abuse', 'Reports of suspected illegal drug use, possession, selling, or distribution in the community. Include the location and relevant details if known.'),
  ('Threats', 'Reports of threats, intimidation, or harassment toward a person or group, whether made in person, by phone, or through messages.'),
  ('Cyberbullying', 'Reports of online harassment or bullying, including abusive messages, humiliating posts, repeated insults, or harmful content shared on social media.'),
  ('Physical Assault', 'Reports of physical violence or attacks, such as hitting, punching, kicking, or fighting, including any injuries that may require medical attention.'),
  ('Theft & Robbery', 'Reports of stolen or taken property, including snatching, burglary, robbery, missing belongings, or thieves operating in the community.'),
  ('Scams & Fraud', 'Reports of swindling or dishonesty for money or property, such as estafa, fake sellers, fake products, fake fees, or money schemes.'),
  ('Dispute/Conflict', 'Reports of verbal quarrels, family or neighbor disputes, land, boundary, or money disagreements, and other conflicts that need mediation instead of violence.'),
  ('Animal Concerns', 'Reports about stray, loose, or aggressive animals, such as dog bites or animals roaming the road, when urgent medical care is not the main request.')
) AS v(name, description)
WHERE NOT EXISTS (
  SELECT 1 FROM public.channels c WHERE c.name = v.name
)
AND NOT EXISTS (
  -- Legacy databases use channels for intake methods; leave those alone.
  SELECT 1 FROM public.channels ch WHERE ch.name IN ('Online form', 'SMS/Text', 'Walk-in')
);

-- ---------------------------------------------------------------------------
-- STEP 3. Remap stored complaints and triage results off the legacy names.
-- ---------------------------------------------------------------------------
UPDATE public.complaints c
SET category_id = (
  SELECT a.id FROM public.complaint_categories a WHERE a.name = target.aligned
)
FROM (VALUES
  ('Public Safety', 'Safety Rules'),
  ('Infrastructure', 'Damaged Infrastructures'),
  ('Health', 'Medical Assistance'),
  ('Noise', 'Noise Complaints'),
  ('Threat', 'Threats'),
  ('Bullying/Harassment', 'Threats'),
  ('Drug-related concern', 'Drug Abuse')
) AS target(legacy, aligned)
WHERE c.category_id = (
  SELECT l.id FROM public.complaint_categories l WHERE l.name = target.legacy
);

UPDATE public.triage_results t
SET category_id = (
  SELECT a.id FROM public.complaint_categories a WHERE a.name = target.aligned
)
FROM (VALUES
  ('Public Safety', 'Safety Rules'),
  ('Infrastructure', 'Damaged Infrastructures'),
  ('Health', 'Medical Assistance'),
  ('Noise', 'Noise Complaints'),
  ('Threat', 'Threats'),
  ('Bullying/Harassment', 'Threats'),
  ('Drug-related concern', 'Drug Abuse')
) AS target(legacy, aligned)
WHERE t.category_id = (
  SELECT l.id FROM public.complaint_categories l WHERE l.name = target.legacy
);

-- ---------------------------------------------------------------------------
-- STEP 4. Remap legacy category names in complaints.channel_id. Intake-method
--         channels are protected by the same guard as step 2.
-- ---------------------------------------------------------------------------
UPDATE public.complaints c
SET channel_id = (
  SELECT a.id FROM public.channels a WHERE a.name = target.aligned
)
FROM (VALUES
  ('Public Safety', 'Safety Rules'),
  ('Infrastructure', 'Damaged Infrastructures'),
  ('Health', 'Medical Assistance'),
  ('Noise', 'Noise Complaints'),
  ('Threat', 'Threats'),
  ('Bullying/Harassment', 'Threats'),
  ('Drug-related concern', 'Drug Abuse')
) AS target(legacy, aligned)
WHERE c.channel_id = (
  SELECT l.id FROM public.channels l WHERE l.name = target.legacy
)
AND NOT EXISTS (
  SELECT 1 FROM public.channels ch WHERE ch.name IN ('Online form', 'SMS/Text', 'Walk-in')
);

-- ---------------------------------------------------------------------------
-- STEP 5. Delete legacy category rows from channels when nothing references
--         them (guarded like step 4, so intake-method channels are untouched).
-- ---------------------------------------------------------------------------
DELETE FROM public.channels ch
WHERE ch.name IN (
  'Public Safety', 'Infrastructure', 'Health', 'Noise', 'Threat',
  'Bullying/Harassment', 'Drug-related concern'
)
AND NOT EXISTS (
  SELECT 1 FROM public.channels intake
  WHERE intake.name IN ('Online form', 'SMS/Text', 'Walk-in')
)
AND NOT EXISTS (
  SELECT 1 FROM public.complaints c WHERE c.channel_id = ch.id
)
AND NOT EXISTS (
  SELECT 1 FROM public.channel_members m WHERE m.channel_id = ch.id
);

-- ---------------------------------------------------------------------------
-- STEP 6. Remove legacy category rows that nothing references anymore.
--         Rows still referenced are kept so no complaint loses its category.
-- ---------------------------------------------------------------------------
DELETE FROM public.complaint_categories cat
WHERE cat.name IN (
  'Public Safety', 'Infrastructure', 'Health', 'Noise', 'Threat',
  'Bullying/Harassment', 'Drug-related concern'
)
AND NOT EXISTS (
  SELECT 1 FROM public.complaints c WHERE c.category_id = cat.id
)
AND NOT EXISTS (
  SELECT 1 FROM public.triage_results t WHERE t.category_id = cat.id
);
