// Shared fixed SQL-driven assignment (no load computation, no runtime choice).
// Each channel owns its team in channel_members. Only OFFICIAL users can own
// complaint assignments; channel teammates are still notified.
const ASSIGNEE_ROLE = 'OFFICIAL';

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
    .select('user_id, user:users(id, full_name, role, status)')
    .eq('channel_id', channelId);
  if (error) throw error;
  return (pool || [])
    .map((p) => ({
      user_id: p.user_id,
      full_name: p.user?.full_name || null,
      role: normalizeRoleValue(p.user?.role),
      status: p.user?.status || 'ACTIVE',
    }))
    .filter((t) => t.status === 'ACTIVE')
    .sort((a, b) => a.user_id - b.user_id);
}

async function roleFallbackSupabase(client) {
  // Use the first active Official when a channel has no Official member.
  const { data: users } = await client
    .from('users')
    .select('id, full_name, role, status')
    .eq('status', 'ACTIVE')
    .order('id');
  return (users || [])
    .map((u) => ({
      user_id: u.id,
      full_name: u.full_name,
      role: normalizeRoleValue(u.role),
    }))
    .filter((u) => u.role === ASSIGNEE_ROLE)
    .sort((a, b) => a.user_id - b.user_id);
}

// Returns null when no active Official is available.
export async function pickFixedHandlerSupabase(client, channelId) {
  const team = await teamWithRolesSupabase(client, channelId);
  const officials = team.filter((member) => member.role === ASSIGNEE_ROLE);
  if (officials.length > 0) {
    const handler = officials[0];
    return { user_id: handler.user_id, full_name: handler.full_name, role: handler.role };
  }
  const pool = await roleFallbackSupabase(client);
  if (pool.length === 0) return null;
  return { user_id: pool[0].user_id, full_name: pool[0].full_name, role: pool[0].role };
}

export async function pickFixedHandlerSQLite(db, channelId) {
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
  const officials = (team || []).filter((member) => normalizeRoleValue(member.role) === ASSIGNEE_ROLE);
  if (officials.length > 0) {
    const handler = officials[0];
    return { user_id: handler.user_id, full_name: handler.full_name || null, role: handler.role || null };
  }
  const users = await db.all(
    `SELECT users.id AS user_id, users.full_name, roles.name AS role FROM users
     LEFT JOIN roles ON roles.id = users.role_id
     WHERE roles.name = ? AND (users.status = 'ACTIVE' OR users.status IS NULL)
     ORDER BY users.id`,
    [ASSIGNEE_ROLE]
  );
  if (!users || users.length === 0) return null;
  return { user_id: users[0].user_id, full_name: users[0].full_name || null, role: users[0].role || null };
}

export async function getUserRoleSupabase(client, userId) {
  const { data: user, error } = await client
    .from('users')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return normalizeRoleValue(user?.role);
}

export async function getUserRoleSQLite(db, userId) {
  const user = await db.get(
    `SELECT roles.name AS role
     FROM users LEFT JOIN roles ON roles.id = users.role_id
     WHERE users.id = ?`,
    [userId]
  );
  return normalizeRoleValue(user?.role);
}
