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
  ('Safety Rules', 'Violations of barangay safety rules and ordinances'),
  ('Damaged Infrastructures', 'Damaged roads, drainage, lights, public facilities'),
  ('Medical Assistance', 'Medical / health emergency assistance requests'),
  ('Noise Complaints', 'Noise disturbances and public nuisance'),
  ('Drug Abuse', 'Drug-related concerns and reports'),
  ('Threats', 'Threats, intimidation and harassment'),
  ('Cyberbullying', 'Online bullying, libel, threatening messages'),
  ('Physical Assault', 'Physical harm, fights and assault incidents')
ON CONFLICT (name) DO NOTHING;

INSERT INTO complaint_categories (name, description) VALUES
  ('Safety Rules', 'Violations of barangay safety rules and ordinances'),
  ('Damaged Infrastructures', 'Damaged roads, drainage, lights, public facilities'),
  ('Medical Assistance', 'Medical / health emergency assistance requests'),
  ('Noise Complaints', 'Noise disturbances and public nuisance'),
  ('Drug Abuse', 'Drug-related concerns and reports'),
  ('Threats', 'Threats, intimidation and harassment'),
  ('Cyberbullying', 'Online bullying, libel, threatening messages'),
  ('Physical Assault', 'Physical harm, fights and assault incidents')
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
