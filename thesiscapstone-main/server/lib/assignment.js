// Shared fixed SQL-driven assignment (no load computation, no runtime choice).
// Each channel owns its team in channel_members (seeded 12 TANOD / 8 OFFICIAL / 12 LUPON).
// Handler rule: first user_id of the channel's mapped role (CHANNEL_ROLE_MAP)
// within the team. Same answer every run for the same channel.
import { CHANNEL_ROLE_MAP } from '../../src/lib/triageService.js';

const ASSIGNABLE_ROLES = ['TANOD', 'OFFICIAL', 'LUPON'];

function normalizeRoleValue(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.toUpperCase();
  if (typeof value === 'object') {
    return String(value.name || value.role_name || '').toUpperCase() || null;
  }
  return String(value).toUpperCase() || null;
}

async function teamWithRolesSupabase(client, channelId) {
  const { data: pool, error } = await client
    .from('channel_members')
    .select('user_id, user:users(id, full_name, role, role_id, status)')
    .eq('channel_id', channelId);
  if (error) throw error;
  const { data: roleRows } = await client.from('roles').select('id, name');
  const roleMap = new Map((roleRows || []).map((r) => [r.id, r.name]));
  return (pool || [])
    .map((p) => ({
      user_id: p.user_id,
      full_name: p.user?.full_name || null,
      role: normalizeRoleValue(p.user?.role) || normalizeRoleValue(roleMap.get(p.user?.role_id)),
      status: p.user?.status || 'ACTIVE',
    }))
    .filter((t) => t.status === 'ACTIVE')
    .sort((a, b) => a.user_id - b.user_id);
}

async function roleFallbackSupabase(client, role) {
  // Deterministic fallback for unseeded channels: first ACTIVE of mapped role by id.
  const { data: users } = await client
    .from('users')
    .select('id, full_name, role, role_id, status')
    .eq('status', 'ACTIVE')
    .order('id');
  const { data: roleRows } = await client.from('roles').select('id, name');
  const roleMap = new Map((roleRows || []).map((r) => [r.id, r.name]));
  return (users || [])
    .map((u) => ({
      user_id: u.id,
      full_name: u.full_name,
      role: normalizeRoleValue(u.role) || normalizeRoleValue(roleMap.get(u.role_id)),
    }))
    .filter((u) => (role ? u.role === role : ASSIGNABLE_ROLES.includes(u.role)))
    .sort((a, b) => a.user_id - b.user_id);
}

// Fixed handler. Returns null when the team is empty.
export async function pickFixedHandlerSupabase(client, channelId, channelName) {
  const team = await teamWithRolesSupabase(client, channelId);
  if (team.length > 0) {
    const mapped = CHANNEL_ROLE_MAP[channelName] || null;
    const handler = (mapped && team.find((t) => t.role === mapped)) || team[0];
    return { user_id: handler.user_id, full_name: handler.full_name, role: handler.role };
  }
  const pool = await roleFallbackSupabase(client, CHANNEL_ROLE_MAP[channelName] || null);
  if (pool.length === 0) return null;
  return { user_id: pool[0].user_id, full_name: pool[0].full_name, role: pool[0].role };
}

export async function pickFixedHandlerSQLite(db, channelId, channelName) {
  let team = [];
  try {
    team = await db.all(
      `SELECT cm.user_id, u.full_name, r.name AS role FROM channel_members cm
       LEFT JOIN users u ON u.id = cm.user_id
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE cm.channel_id = ? AND (u.status = 'ACTIVE' OR u.status IS NULL)
       ORDER BY cm.user_id`,
      [channelId]
    );
  } catch {
    team = [];
  }
  if (team && team.length > 0) {
    const mapped = CHANNEL_ROLE_MAP[channelName] || null;
    const handler =
      (mapped && team.find((t) => String(t.role).toUpperCase() === mapped)) || team[0];
    return { user_id: handler.user_id, full_name: handler.full_name || null, role: handler.role || null };
  }
  const role = CHANNEL_ROLE_MAP[channelName] || null;
  const users = role
    ? await db.all(
        `SELECT users.id AS user_id, users.full_name, roles.name AS role FROM users
         LEFT JOIN roles ON roles.id = users.role_id
         WHERE roles.name = ? AND (users.status = 'ACTIVE' OR users.status IS NULL)
         ORDER BY users.id`,
        [role]
      )
    : await db.all(
        `SELECT users.id AS user_id, users.full_name, roles.name AS role FROM users
         LEFT JOIN roles ON roles.id = users.role_id
         WHERE roles.name IN ('TANOD','OFFICIAL','LUPON') AND (users.status = 'ACTIVE' OR users.status IS NULL)
         ORDER BY users.id`
      );
  if (!users || users.length === 0) return null;
  return { user_id: users[0].user_id, full_name: users[0].full_name || null, role: users[0].role || null };
}
