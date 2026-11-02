-- ============================================
-- BARANGAY SARAY COMPLAINT SYSTEM - SUPABASE MIGRATION
-- Run this SQL in: Supabase Dashboard → SQL Editor
-- ============================================

-- 1. ROLES
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. USERS
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  auth_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  address TEXT,
  clearance_path TEXT,
  clearance_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check
  CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION', 'REJECTED'));
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON users(auth_id);
-- Forward migration for existing projects (safe to re-run):
ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT;

-- 3. CHANNELS (problem-type channels used for auto-assign)
CREATE TABLE IF NOT EXISTS channels (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3b. CHANNEL MEMBERS (which staff handle each channel/problem)
CREATE TABLE IF NOT EXISTS channel_members (
  id SERIAL PRIMARY KEY,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_members_channel ON channel_members(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_members_user ON channel_members(user_id);

-- 3c. STAFF AVAILABILITY (sick/leave flag; orthogonal to users.status).
-- A sick member keeps an ACTIVE account but is skipped by assignment.
CREATE TABLE IF NOT EXISTS staff_availability (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  is_available BOOLEAN NOT NULL DEFAULT true,
  reason TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. COMPLAINT CATEGORIES
CREATE TABLE IF NOT EXISTS complaint_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. COMPLAINTS
CREATE TABLE IF NOT EXISTS complaints (
  id SERIAL PRIMARY KEY,
  citizen_id INTEGER NOT NULL REFERENCES users(id),
  complaint_id TEXT NOT NULL UNIQUE,
  title TEXT,
  description TEXT NOT NULL,
  location TEXT,
  category_id INTEGER REFERENCES complaint_categories(id),
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  status TEXT NOT NULL DEFAULT 'SUBMITTED',
  channel_id INTEGER REFERENCES channels(id),
  assigned_to INTEGER REFERENCES users(id),
  source TEXT NOT NULL DEFAULT 'online',
  submitted_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  resolution TEXT,
  hearing_info TEXT
);
-- Forward migration for existing projects (safe to re-run):
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'online';

-- 6. TRIAGE RESULTS
CREATE TABLE IF NOT EXISTS triage_results (
  id SERIAL PRIMARY KEY,
  complaint_id INTEGER NOT NULL UNIQUE REFERENCES complaints(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES complaint_categories(id),
  suggested_priority TEXT,
  confidence DOUBLE PRECISION,
  language TEXT,
  model_type TEXT DEFAULT 'Naive Bayes',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE triage_results ADD COLUMN IF NOT EXISTS language TEXT;

-- 7. REMARKS
CREATE TABLE IF NOT EXISTS remarks (
  id SERIAL PRIMARY KEY,
  complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  user_role TEXT NOT NULL,
  remark_text TEXT NOT NULL,
  action_type TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 8. HEARINGS
CREATE TABLE IF NOT EXISTS hearings (
  id SERIAL PRIMARY KEY,
  complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  scheduled_date TEXT,
  scheduled_time TEXT,
  location TEXT,
  status TEXT DEFAULT 'SCHEDULED',
  notes TEXT,
  assigned_members TEXT,
  result TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 9. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 10. SYSTEM LOGS
CREATE TABLE IF NOT EXISTS system_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  target_record TEXT,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 11. SERVICE RATINGS
CREATE TABLE IF NOT EXISTS service_ratings (
  id SERIAL PRIMARY KEY,
  complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  feedback TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- SEED DATA
-- ============================================

INSERT INTO roles (name) VALUES ('CITIZEN'), ('TANOD'), ('OFFICIAL'), ('LUPON'), ('ADMIN')
ON CONFLICT (name) DO NOTHING;

INSERT INTO channels (name, description) VALUES
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
ON CONFLICT (name) DO NOTHING;

UPDATE channels
SET description = CASE name
  WHEN 'Safety Rules' THEN 'Reports of barangay rule or ordinance violations, such as curfew violations, speeding, blocked emergency routes, unsafe fireworks, or prohibited activities.'
  WHEN 'Damaged Infrastructures' THEN 'Reports of damaged public roads, bridges, sidewalks, drainage, streetlights, water pipes, or other community facilities that may need repair.'
  WHEN 'Medical Assistance' THEN 'Requests for medical help, first aid, ambulance transport, or health-center support for illness, injury, or other urgent health concerns.'
  WHEN 'Noise Complaints' THEN 'Reports of excessive or repeated noise that disturbs residents, including loud music, karaoke, construction, shouting, or late-night disturbances.'
  WHEN 'Drug Abuse' THEN 'Reports of suspected illegal drug use, possession, selling, or distribution in the community. Include the location and relevant details if known.'
  WHEN 'Threats' THEN 'Reports of threats, intimidation, or harassment toward a person or group, whether made in person, by phone, or through messages.'
  WHEN 'Cyberbullying' THEN 'Reports of online harassment or bullying, including abusive messages, humiliating posts, repeated insults, or harmful content shared on social media.'
  WHEN 'Physical Assault' THEN 'Reports of physical violence or attacks, such as hitting, punching, kicking, or fighting, including any injuries that may require medical attention.'
  WHEN 'Theft & Robbery' THEN 'Reports of stolen or taken property, including snatching, burglary, robbery, missing belongings, or thieves operating in the community.'
  WHEN 'Scams & Fraud' THEN 'Reports of swindling or dishonesty for money or property, such as estafa, fake sellers, fake products, fake fees, or money schemes.'
  WHEN 'Dispute/Conflict' THEN 'Reports of verbal quarrels, family or neighbor disputes, land, boundary, or money disagreements, and other conflicts that need mediation instead of violence.'
  WHEN 'Animal Concerns' THEN 'Reports about stray, loose, or aggressive animals, such as dog bites or animals roaming the road, when urgent medical care is not the main request.'
END
WHERE name IN (
  'Safety Rules', 'Damaged Infrastructures', 'Medical Assistance', 'Noise Complaints',
  'Drug Abuse', 'Threats', 'Cyberbullying', 'Physical Assault',
  'Theft & Robbery', 'Scams & Fraud', 'Dispute/Conflict', 'Animal Concerns'
)
AND (
  description IS NULL
  OR btrim(description) = ''
  OR (name = 'Safety Rules' AND description = 'Violations of barangay safety rules and ordinances')
  OR (name = 'Damaged Infrastructures' AND description = 'Damaged roads, drainage, lights, public facilities')
  OR (name = 'Medical Assistance' AND description = 'Medical / health emergency assistance requests')
  OR (name = 'Noise Complaints' AND description = 'Noise disturbances and public nuisance')
  OR (name = 'Drug Abuse' AND description = 'Drug-related concerns and reports')
  OR (name = 'Threats' AND description = 'Threats, intimidation and harassment')
  OR (name = 'Cyberbullying' AND description = 'Online bullying, libel, threatening messages')
  OR (name = 'Physical Assault' AND description = 'Physical harm, fights and assault incidents')
  OR (name = 'Dispute/Conflict' AND description = 'Interpersonal or community disputes requiring mediation')
);

INSERT INTO complaint_categories (name, description) VALUES
  ('Safety Rules', 'Violations of barangay safety rules and ordinances'),
  ('Damaged Infrastructures', 'Damaged roads, drainage, lights, public facilities'),
  ('Medical Assistance', 'Medical / health emergency assistance requests'),
  ('Noise Complaints', 'Noise disturbances and public nuisance'),
  ('Drug Abuse', 'Drug-related concerns and reports'),
  ('Threats', 'Threats, intimidation and harassment'),
  ('Cyberbullying', 'Online bullying, libel, threatening messages'),
  ('Physical Assault', 'Physical harm, fights and assault incidents'),
  ('Theft & Robbery', 'Stolen or taken property, snatching, burglary, and robbery reports'),
  ('Scams & Fraud', 'Estafa, fake sellers, fake products, and money-scheme reports'),
  ('Dispute/Conflict', 'Interpersonal or community disputes requiring mediation'),
  ('Animal Concerns', 'Stray, loose, or aggressive animals and animal bites')
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- ENABLE ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaint_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE triage_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE remarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE hearings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_ratings ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES (allow service_role full access)
-- ============================================

CREATE POLICY "Service role full access" ON roles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON channels FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON channel_members FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON staff_availability FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON complaint_categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON complaints FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON triage_results FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON remarks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON hearings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON notifications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON system_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON service_ratings FOR ALL USING (true) WITH CHECK (true);
