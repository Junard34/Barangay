// Seeds pre-assigned channel teams into channel_members (idempotent).
// Distribution (TANOD 12 / OFFICIAL 8 / LUPON 12 across 8 channels):
//   Safety Rules:          1 TANOD + 1 OFFICIAL + 2 LUPON
//   Damaged Infrastructures: 1 + 1 + 2
//   Medical Assistance:      2 + 1 + 1
//   Noise Complaints:        1 + 1 + 2
//   Drug Abuse:              2 + 1 + 1
//   Threats:                 2 + 1 + 1
//   Cyberbullying:           1 + 1 + 2
//   Physical Assault:        2 + 1 + 1
// Usage: node scripts/seed-channel-teams.js [--local]
//   default: seeds live Supabase (service role). --local: seeds local SQLite.
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const PLAN = {
  'Safety Rules': { TANOD: 1, OFFICIAL: 1, LUPON: 2 },
  'Damaged Infrastructures': { TANOD: 1, OFFICIAL: 1, LUPON: 2 },
  'Medical Assistance': { TANOD: 2, OFFICIAL: 1, LUPON: 1 },
  'Noise Complaints': { TANOD: 1, OFFICIAL: 1, LUPON: 2 },
  'Drug Abuse': { TANOD: 2, OFFICIAL: 1, LUPON: 1 },
  Threats: { TANOD: 2, OFFICIAL: 1, LUPON: 1 },
  Cyberbullying: { TANOD: 1, OFFICIAL: 1, LUPON: 2 },
  'Physical Assault': { TANOD: 2, OFFICIAL: 1, LUPON: 1 },
};
const CHANNEL_ORDER = Object.keys(PLAN);

function normalizeRole(value, roleMap) {
  if (!value) return null;
  if (typeof value === 'string') return value.toUpperCase();
  return null;
}

function deal(usersByRole) {
  // usersByRole: { TANOD: [ids...], OFFICIAL: [...], LUPON: [...] } ordered by id
  const cursors = { TANOD: 0, OFFICIAL: 0, LUPON: 0 };
  const assignments = []; // { channel, role, userId }
  const shortfalls = [];
  for (const channel of CHANNEL_ORDER) {
    for (const role of ['TANOD', 'OFFICIAL', 'LUPON']) {
      const need = PLAN[channel][role];
      for (let i = 0; i < need; i += 1) {
        const pool = usersByRole[role] || [];
        if (cursors[role] < pool.length) {
          assignments.push({ channel, role, userId: pool[cursors[role]] });
          cursors[role] += 1;
        } else if (pool.length > 0) {
          // Share round-robin when short (should not happen with 12/8/12 present)
          const shared = pool[(cursors[role]) % pool.length];
          assignments.push({ channel, role, userId: shared });
          cursors[role] += 1;
          shortfalls.push(`${channel} ${role}: shared user ${shared}`);
        } else {
          shortfalls.push(`${channel} ${role}: NO active users`);
        }
      }
    }
  }
  return { assignments, shortfalls };
}

async function seedSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required in .env');
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: channels, error: chError } = await supabase.from('channels').select('id, name');
  if (chError) throw chError;
  const channelId = new Map((channels || []).map((c) => [c.name, c.id]));
  for (const name of CHANNEL_ORDER) {
    if (!channelId.has(name)) throw new Error(`Channel missing in Supabase: ${name}`);
  }

  const { data: users, error: uError } = await supabase.from('users').select('id, role, role_id, status').eq('status', 'ACTIVE').order('id');
  if (uError) throw uError;
  const { data: roleRows } = await supabase.from('roles').select('id, name');
  const roleMap = new Map((roleRows || []).map((r) => [r.id, r.name]));
  const byRole = { TANOD: [], OFFICIAL: [], LUPON: [] };
  for (const u of users || []) {
    const role = normalizeRole(u.role) || normalizeRole(roleMap.get(u.role_id));
    if (byRole[role]) byRole[role].push(u.id);
  }
  console.log(`ACTIVE pools: TANOD ${byRole.TANOD.length}, OFFICIAL ${byRole.OFFICIAL.length}, LUPON ${byRole.LUPON.length}`);

  const { assignments, shortfalls } = deal(byRole);
  let inserted = 0;
  for (const a of assignments) {
    const { error } = await supabase.from('channel_members').upsert(
      { channel_id: channelId.get(a.channel), user_id: a.userId },
      { onConflict: 'channel_id,user_id' }
    );
    if (error) throw new Error(`Insert ${a.channel}/${a.role}/${a.userId}: ${error.message}`);
    inserted += 1;
  }
  for (const s of shortfalls) console.warn('SHORTFALL: ' + s);

  // Verify
  for (const name of CHANNEL_ORDER) {
    const { count } = await supabase.from('channel_members').select('*', { count: 'exact', head: true }).eq('channel_id', channelId.get(name));
    console.log(`${name}: ${count} members (expect 4)`);
  }
  console.log(`Done. ${inserted} assignments upserted.`);
}

async function seedLocal() {
  const { db, initDatabase } = await import('../server/database.js');
  await initDatabase();
  const channels = await db.all('SELECT id, name FROM channels');
  const channelId = new Map(channels.map((c) => [c.name, c.id]));
  for (const name of CHANNEL_ORDER) {
    if (!channelId.has(name)) throw new Error(`Channel missing locally: ${name}`);
  }
  const users = await db.all(
    `SELECT users.id, roles.name AS role FROM users LEFT JOIN roles ON roles.id = users.role_id
     WHERE users.status = 'ACTIVE' OR users.status IS NULL ORDER BY users.id`
  );
  const byRole = { TANOD: [], OFFICIAL: [], LUPON: [] };
  for (const u of users) {
    const r = (u.role || '').toUpperCase();
    if (byRole[r]) byRole[r].push(u.id);
  }
  console.log(`Local ACTIVE pools: TANOD ${byRole.TANOD.length}, OFFICIAL ${byRole.OFFICIAL.length}, LUPON ${byRole.LUPON.length}`);
  const { assignments, shortfalls } = deal(byRole);
  for (const a of assignments) {
    await db.run('INSERT OR IGNORE INTO channel_members (channel_id, user_id) VALUES (?, ?)', [channelId.get(a.channel), a.userId]);
  }
  for (const s of shortfalls) console.warn('SHORTFALL: ' + s);
  for (const name of CHANNEL_ORDER) {
    const row = await db.get('SELECT COUNT(*) AS n FROM channel_members WHERE channel_id = ?', [channelId.get(name)]);
    console.log(`${name}: ${row.n} members (expect 4)`);
  }
  console.log('Done (local).');
  process.exit(0);
}

const mode = process.argv.includes('--local') ? 'local' : 'supabase';
if (mode === 'local') {
  await seedLocal();
} else {
  await seedSupabase();
  process.exit(0);
}
