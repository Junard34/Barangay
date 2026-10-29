import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import supabase, { getSupabaseAdmin } from '../../supabaseAdmin.js';
import { db } from '../../database.js';
import { triageComplaint, CHANNEL_ROLE_MAP } from '../../../src/lib/triageService.js';
import { attachEvidence } from '../../lib/evidence.js';
import { notifyCitizen } from '../../lib/notifyCitizen.js';
import { normalizePhPhone } from '../../lib/sms.js';
import {
  pickFixedHandlerSupabase as pickFixedSupabase,
  pickFixedHandlerSQLite as pickFixedSQLite,
} from '../../lib/assignment.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

function normalizeRole(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.toUpperCase();
  if (typeof value === 'object') {
    return String(value.name || value.role_name || '').toUpperCase() || null;
  }
  return String(value).toUpperCase() || null;
}

async function resolveUserRole({ authUserId, profileId, jwtRole, metadataRole }) {
  const candidates = [jwtRole, metadataRole];

  try {
    const supabaseAdmin = getSupabaseAdmin();

    if (authUserId) {
      const byAuthId = await supabaseAdmin
        .from('users')
        .select('id, role, role_id, full_name, email, status, auth_id, address, clearance_path, clearance_name, created_at')
        .eq('auth_id', authUserId)
        .maybeSingle();

      if (byAuthId.data) {
        const roleName =
          normalizeRole(byAuthId.data.role) ||
          (byAuthId.data.role_id
            ? normalizeRole(
                (await supabaseAdmin.from('roles').select('name').eq('id', byAuthId.data.role_id).maybeSingle()).data?.name
              )
            : null);

        return {
          ok: true,
          profile: { ...byAuthId.data, role: roleName },
          roleName,
        };
      }
    }

    if (profileId) {
      const byProfileId = await supabaseAdmin
        .from('users')
        .select('id, role, role_id, full_name, email, status, auth_id, address, clearance_path, clearance_name, created_at')
        .eq('id', profileId)
        .maybeSingle();

      if (byProfileId.data) {
        const roleName =
          normalizeRole(byProfileId.data.role) ||
          (byProfileId.data.role_id
            ? normalizeRole(
                (await supabaseAdmin.from('roles').select('name').eq('id', byProfileId.data.role_id).maybeSingle()).data?.name
              )
            : null);

        return {
          ok: true,
          profile: { ...byProfileId.data, role: roleName },
          roleName,
        };
      }
    }
  } catch (error) {
    console.warn('Supabase profile lookup failed:', error.message);
  }

  try {
    const sqliteUser = profileId
      ? await db.get(
          `SELECT users.*, roles.name AS role_name
           FROM users
           LEFT JOIN roles ON roles.id = users.role_id
           WHERE users.id = ?`,
          [profileId]
        )
      : null;

    if (sqliteUser) {
      return {
        ok: true,
        profile: {
          id: sqliteUser.id,
          role: sqliteUser.role_name || sqliteUser.role,
          full_name: sqliteUser.full_name,
          email: sqliteUser.email,
          status: sqliteUser.status,
          auth_id: sqliteUser.auth_id,
        },
        roleName: normalizeRole(sqliteUser.role_name || sqliteUser.role),
      };
    }
  } catch (error) {
    console.warn('SQLite profile lookup failed:', error.message);
  }

  const roleName = normalizeRole(candidates.find(Boolean));
  if (!roleName) {
    return { ok: false, roleName: null, profile: null };
  }

  return {
    ok: true,
    roleName,
    profile: profileId ? { id: profileId, role: roleName } : null,
  };
}

async function requireAdmin(req, res) {
  const authorization = req.headers.authorization || '';
  const accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';

  if (!accessToken) {
    return { ok: false, status: 401, message: 'Authentication required.' };
  }

  // Peek at the token header (no verification) to route correctly:
  // Supabase signs access tokens with ES256, local SQLite-fallback tokens
  // with HS256. Verifying an ES256 token against the HMAC secret always
  // fails with "invalid algorithm", so each kind gets only its own check.
  let alg = null;
  try {
    const parts = accessToken.split('.');
    if (parts.length === 3) {
      alg = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')).alg || null;
    }
  } catch {
    alg = null;
  }

  let authUserId = null;
  let profileId = null;
  let jwtRole = null;
  let metadataRole = null;

  if (alg && String(alg).toUpperCase().startsWith('ES')) {
    // Supabase-issued token: the ONLY valid check is getUser().
    try {
      const supabaseAdmin = getSupabaseAdmin();
      const { data: requester, error: requesterError } = await supabaseAdmin.auth.getUser(accessToken);

      if (!requesterError && requester?.user) {
        authUserId = requester.user.id;
        metadataRole = requester.user.user_metadata?.role;
      } else {
        console.warn('Supabase getUser failed:', requesterError?.message);
        return { ok: false, status: 401, message: 'Your session has expired. Please log in again.' };
      }
    } catch (error) {
      console.warn('Supabase token verification failed:', error.message);
      return { ok: false, status: 401, message: 'Your session has expired. Please log in again.' };
    }
  } else {
    // Local SQLite-fallback token (HS256, signed with JWT_SECRET).
    try {
      const decoded = jwt.verify(accessToken, JWT_SECRET);
      jwtRole = decoded.role;
      profileId = decoded.id;
      authUserId = decoded.authId || null;
    } catch (error) {
      console.warn('JWT verification failed:', error.message);
      return { ok: false, status: 401, message: 'Your session has expired. Please log in again.' };
    }
  }

  const resolved = await resolveUserRole({
    authUserId,
    profileId,
    jwtRole,
    metadataRole,
  });

  console.log('requireAdmin resolve:', {
    authUserId,
    profileId,
    jwtRole,
    metadataRole,
    resolvedRole: resolved.roleName,
    resolvedOk: resolved.ok,
    profileEmail: resolved.profile?.email || null,
  });

  if (!resolved.ok || resolved.roleName !== 'ADMIN') {
    return { ok: false, status: 403, message: 'Admin access required.' };
  }

  return {
    ok: true,
    adminProfile: resolved.profile,
    roleName: resolved.roleName,
    authUserId,
  };
}

function sendAuthError(res, authResult) {
  return res.status(authResult.status).json({ message: authResult.message });
}

async function listUsersFromSupabase(statusFilter) {
  const supabaseAdmin = getSupabaseAdmin();

  // Full column set first; on schema drift (missing column on older
  // projects) retry with a minimal set instead of failing over to stale
  // SQLite rows without anyone noticing.
  const fullSelect = 'id, full_name, email, address, phone, status, clearance_path, clearance_name, auth_id, created_at, role, role_id';
  const minimalSelect = 'id, full_name, email, status, auth_id, created_at, role, role_id';

  let users;
  try {
    let query = supabaseAdmin.from('users').select(fullSelect).order('created_at', { ascending: false });
    if (statusFilter) query = query.eq('status', statusFilter);
    const { data, error } = await query;
    if (error) throw error;
    users = data;
  } catch (fullError) {
    console.warn('Supabase user list (full columns) failed, retrying minimal:', fullError.message);
    let query = supabaseAdmin.from('users').select(minimalSelect).order('created_at', { ascending: false });
    if (statusFilter) query = query.eq('status', statusFilter);
    const { data, error } = await query;
    if (error) throw error;
    users = data;
  }

  if (!users || users.length === 0) {
    return [];
  }

  const roleIds = [...new Set((users || []).map((u) => u.role_id).filter(Boolean))];
  const roleNameMap = new Map();

  if (roleIds.length > 0) {
    const { data: roleRows } = await supabaseAdmin.from('roles').select('id, name').in('id', roleIds);
    for (const roleRow of roleRows || []) {
      roleNameMap.set(roleRow.id, roleRow.name);
    }
  }

  return (users || []).map((u) => ({
    ...u,
    role: normalizeRole(u.role) || normalizeRole(roleNameMap.get(u.role_id)) || 'CITIZEN',
  }));
}

async function listUsersFromSQLite(statusFilter) {
  const rows = await db.all(
    `SELECT users.id, users.full_name, users.email, users.status, users.auth_id, users.created_at, roles.name AS role_name
     FROM users
     LEFT JOIN roles ON roles.id = users.role_id
     ORDER BY users.created_at DESC`
  );

  const mapped = (rows || []).map((u) => ({
    ...u,
    role: normalizeRole(u.role_name) || 'CITIZEN',
    address: null,
    clearance_path: null,
    clearance_name: null,
  }));

  return statusFilter ? mapped.filter((u) => u.status === statusFilter) : mapped;
}

router.get('/dashboard', async (req, res) => {
  const authResult = await requireAdmin(req, res);
  if (!authResult.ok) {
    return sendAuthError(res, authResult);
  }

  let stats = {
    total_users: 0,
    pending_verifications: 0,
    total_complaints: 0,
    resolved_complaints: 0,
  };
  let byRole = [];

  try {
    const users = await listUsersFromSupabase();
    stats.total_users = users.length;
    stats.pending_verifications = users.filter((u) => u.status === 'PENDING_VERIFICATION').length;

    const byRoleMap = new Map();
    for (const u of users) {
      const roleName = normalizeRole(u.role) || 'CITIZEN';
      byRoleMap.set(roleName, (byRoleMap.get(roleName) || 0) + 1);
    }
    byRole = [...byRoleMap.entries()].map(([role, count]) => ({ role, count }));

    const { count: totalComplaints } = await supabase.from('complaints').select('*', { count: 'exact', head: true });
    const { count: resolvedComplaints } = await supabase
      .from('complaints')
      .select('*', { count: 'exact', head: true })
      .in('status', ['RESOLVED', 'CLOSED']);

    stats.total_complaints = totalComplaints || 0;
    stats.resolved_complaints = resolvedComplaints || 0;
  } catch (error) {
    console.warn('Supabase dashboard stats failed, trying SQLite:', error.message);
    const users = await listUsersFromSQLite();
    stats.total_users = users.length;
    stats.pending_verifications = users.filter((u) => u.status === 'PENDING_VERIFICATION').length;

    const byRoleMap = new Map();
    for (const u of users) {
      const roleName = normalizeRole(u.role) || 'CITIZEN';
      byRoleMap.set(roleName, (byRoleMap.get(roleName) || 0) + 1);
    }
    byRole = [...byRoleMap.entries()].map(([role, count]) => ({ role, count }));
  }

  res.json({ stats, byRole });
});

router.get('/users', async (req, res) => {
  const authResult = await requireAdmin(req, res);
  if (!authResult.ok) {
    return sendAuthError(res, authResult);
  }

  const { status } = req.query;

  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const users = await listUsersFromSupabase(status);
      return res.json({ users, source: 'supabase' });
    } catch (error) {
      console.error('Supabase user list failed, falling back to SQLite:', error.message);
    }
  } else {
    console.warn('SUPABASE_SERVICE_ROLE_KEY missing, serving user list from SQLite.');
  }

  const users = await listUsersFromSQLite(status);
  return res.json({ users, source: 'sqlite' });
});

router.put('/users/:id', async (req, res) => {
  const authResult = await requireAdmin(req, res);
  if (!authResult.ok) {
    return sendAuthError(res, authResult);
  }

  const { fullName, email, role, status, phone, modifiedBy } = req.body || {};

  const { data: user } = await supabase.from('users').select('*').eq('id', req.params.id).single();
  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  let normalizedPhone = user.phone || null;
  if (phone !== undefined) {
    if (phone && String(phone).trim()) {
      normalizedPhone = normalizePhPhone(phone);
      if (!normalizedPhone) {
        return res.status(400).json({ message: 'Please enter a valid Philippine mobile number (e.g. 09XXXXXXXXX).' });
      }
    } else {
      normalizedPhone = null;
    }
  }

  let roleId = user.role_id;
  let roleValue = user.role;
  if (role) {
    const { data: roleRow } = await supabase.from('roles').select('id').eq('name', role).single();
    if (roleRow) {
      roleId = roleRow.id;
      roleValue = roleRow.name;
    } else {
      roleValue = role;
    }
  }

  const nextStatus = status || user.status || 'ACTIVE';

  const updatePayload = {
    full_name: fullName || user.full_name,
    email: email || user.email,
    status: nextStatus,
    phone: normalizedPhone,
    updated_at: new Date().toISOString(),
  };

  if (roleId !== undefined && roleId !== null) {
    updatePayload.role_id = roleId;
  }
  if (roleValue) {
    updatePayload.role = roleValue;
  }

  await supabase.from('users').update(updatePayload).eq('id', req.params.id);

  await supabase.from('system_logs').insert({
    user_id: modifiedBy || authResult.adminProfile?.id || null,
    action: 'USER_UPDATED',
    target_record: `user_${req.params.id}`,
    details: { role: roleValue || role, status: nextStatus },
  });

  res.json({ message: 'User updated successfully.' });
});

router.put('/users/:id/verification', async (req, res) => {
  const authResult = await requireAdmin(req, res);
  if (!authResult.ok) {
    return sendAuthError(res, authResult);
  }

  const { status, modifiedBy } = req.body || {};

  if (!['ACTIVE', 'REJECTED'].includes(status)) {
    return res.status(400).json({ message: 'Verification status must be ACTIVE or REJECTED.' });
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: citizen, error: citizenError } = await supabaseAdmin
    .from('users')
    .select('id, role, role_id, full_name')
    .eq('id', req.params.id)
    .single();

  if (citizenError || !citizen) {
    return res.status(404).json({ message: 'User not found.' });
  }

  let citizenRole = normalizeRole(citizen.role);
  if (!citizenRole && citizen.role_id) {
    const { data: roleRow } = await supabaseAdmin.from('roles').select('name').eq('id', citizen.role_id).single();
    citizenRole = normalizeRole(roleRow?.name);
  }

  if (citizenRole && citizenRole !== 'CITIZEN') {
    return res.status(400).json({ message: 'Only citizen registrations can be verified.' });
  }

  const { error: updateError } = await supabaseAdmin
    .from('users')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', req.params.id);

  if (updateError) {
    return res.status(500).json({ message: updateError.message });
  }

  await supabaseAdmin.from('system_logs').insert({
    user_id: modifiedBy || authResult.adminProfile?.id || null,
    action: status === 'ACTIVE' ? 'CITIZEN_APPROVED' : 'CITIZEN_REJECTED',
    target_record: `user_${req.params.id}`,
    details: { status, citizen_name: citizen.full_name },
  });

  try {
    await supabaseAdmin.from('notifications').insert({
      user_id: citizen.id,
      title: status === 'ACTIVE' ? 'Account Approved' : 'Registration Rejected',
      message:
        status === 'ACTIVE'
          ? 'Your Barangay Saray account has been verified. You may now log in.'
          : 'Your registration was rejected. Please contact the Barangay Saray administrator or re-register with a valid Barangay Clearance.',
      is_read: false,
    });
  } catch (notifyError) {
    console.warn('Failed to notify citizen:', notifyError.message);
  }

  return res.json({ message: `Citizen ${status === 'ACTIVE' ? 'approved' : 'rejected'} successfully.` });
});

router.post('/users', async (req, res) => {
  const authResult = await requireAdmin(req, res);
  if (!authResult.ok) {
    return sendAuthError(res, authResult);
  }

  const { fullName, email, password, role, createdBy } = req.body || {};

  if (!fullName || !email || !password) {
    return res.status(400).json({ message: 'Full name, email, and password are required.' });
  }

  const { data: existingUser } = await supabase.from('users').select('id').eq('email', email).single();
  if (existingUser) {
    return res.status(409).json({ message: 'User already exists.' });
  }

  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: {
        full_name: fullName.trim(),
        name: fullName.trim(),
        role: (role || 'CITIZEN').toUpperCase(),
      },
    },
  });

  if (error) {
    return res.status(400).json({ message: error.message });
  }

  await supabase.from('system_logs').insert({
    user_id: createdBy || authResult.adminProfile?.id || null,
    action: 'USER_CREATED',
    target_record: `user_${data.user.id}`,
    details: { role },
  });

  return res.status(201).json({ message: 'User created successfully.', userId: data.user.id });
});

router.post('/supabase-users', async (req, res) => {
  const authResult = await requireAdmin(req, res);
  if (!authResult.ok) {
    return sendAuthError(res, authResult);
  }

  const { fullName, email, password, role } = req.body || {};

  if (!fullName || !email || !password || !role) {
    return res.status(400).json({ message: 'Full name, email, password, and role are required.' });
  }

  if (!['TANOD', 'OFFICIAL', 'LUPON'].includes(String(role).toUpperCase())) {
    return res.status(400).json({ message: 'Invalid barangay staff role.' });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName.trim(),
        name: fullName.trim(),
        role: String(role).toUpperCase(),
      },
    });

    if (createError) {
      return res.status(400).json({ message: createError.message });
    }

    const { data: roleRow } = await supabaseAdmin.from('roles').select('id').eq('name', String(role).toUpperCase()).maybeSingle();

    const { error: profileUpsertError } = await supabaseAdmin
      .from('users')
      .upsert({
        auth_id: created.user.id,
        full_name: fullName.trim(),
        email: email.trim(),
        role: String(role).toUpperCase(),
        role_id: roleRow?.id || null,
        status: 'ACTIVE',
      }, { onConflict: 'email' });

    if (profileUpsertError) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      return res.status(500).json({
        message: `Auth user was created but the profile could not be saved: ${profileUpsertError.message}`,
      });
    }

    return res.status(201).json({ message: 'Supabase user created successfully.', userId: created.user.id });
  } catch (error) {
    console.error('Supabase user creation error:', error);
    return res.status(500).json({ message: error.message || 'Failed to create Supabase user.' });
  }
});

router.get('/logs', async (req, res) => {
  const authResult = await requireAdmin(req, res);
  if (!authResult.ok) {
    return sendAuthError(res, authResult);
  }

  try {
    const { data: logs } = await supabase
      .from('system_logs')
      .select('*, user:users(full_name)')
      .order('created_at', { ascending: false })
      .limit(100);

    const mapped = (logs || []).map((l) => ({
      ...l,
      user_name: l.user?.full_name || null,
    }));

    return res.json({ logs: mapped });
  } catch (error) {
    console.warn('Supabase logs failed, trying SQLite:', error.message);
    const logs = await db.all(
      `SELECT system_logs.*, users.full_name AS user_name
       FROM system_logs
       LEFT JOIN users ON users.id = system_logs.user_id
       ORDER BY system_logs.created_at DESC
       LIMIT 100`
    );
    return res.json({ logs: logs || [] });
  }
});

router.post('/sync-user', async (req, res) => {
  const { authId, email, fullName, role, status } = req.body || {};

  if (!authId || !email) {
    return res.status(400).json({ message: 'authId and email are required.' });
  }

  try {
    const { data: existing } = await supabase.from('users').select('id, status, role').eq('auth_id', authId).single();

    if (existing) {
      const updatePayload = {
        email,
        full_name: fullName || email,
        role: role || existing.role || 'CITIZEN',
        updated_at: new Date().toISOString(),
      };

      if (status && !(String(role || '').toUpperCase() === 'CITIZEN' && existing.status === 'PENDING_VERIFICATION')) {
        updatePayload.status = status;
      }

      await supabase.from('users').update(updatePayload).eq('auth_id', authId);
      res.json({ message: 'User synced.', userId: existing.id });
    } else {
      const { data: newUser, error } = await supabase
        .from('users')
        .insert({
          full_name: fullName || email,
          email,
          role: role || 'CITIZEN',
          auth_id: authId,
          status: status || 'ACTIVE',
        })
        .select('id')
        .single();

      if (error) {
        return res.status(500).json({ message: error.message });
      }

      res.status(201).json({ message: 'User created.', userId: newUser.id });
    }
  } catch (error) {
    console.error('Sync user error:', error);
    res.status(500).json({ message: 'Failed to sync user.' });
  }
});

router.get('/complaints', async (req, res) => {
  const authResult = await requireAdmin(req, res);
  if (!authResult.ok) {
    return sendAuthError(res, authResult);
  }

  try {
    const { data: complaints } = await supabase
      .from('complaints')
      .select('*, category:complaint_categories(name), channel:channels(name), citizen:users!complaints_citizen_id_fkey(full_name), assignee:users!complaints_assigned_to_fkey(full_name)')
      .order('created_at', { ascending: false });

    await attachEvidence(supabase, complaints || []);

    let triageMap = new Map();
    try {
      const ids = (complaints || []).map((c) => c.id);
      if (ids.length > 0) {
        const { data: triageRows } = await supabase
          .from('triage_results')
          .select('complaint_id, confidence, suggested_priority, language')
          .in('complaint_id', ids);
        triageMap = new Map((triageRows || []).map((t) => [t.complaint_id, t]));
      }
    } catch {
      triageMap = new Map();
    }

    const mapped = (complaints || []).map((c) => ({
      ...c,
      category_name: c.category?.name || null,
      channel_name: c.channel?.name || null,
      citizen_name: c.citizen?.full_name || null,
      assigned_name: c.assignee?.full_name || null,
      ai_confidence: triageMap.get(c.id)?.confidence ?? null,
      ai_priority: triageMap.get(c.id)?.suggested_priority ?? null,
      ai_language: triageMap.get(c.id)?.language ?? null,
    }));

    return res.json({ complaints: mapped });
  } catch (error) {
    console.warn('Supabase complaints failed, trying SQLite:', error.message);
    const complaints = await db.all(`
      SELECT c.*, cat.name AS category_name, ch.name AS channel_name, u.full_name AS citizen_name,
             t.confidence AS ai_confidence, t.suggested_priority AS ai_priority, t.language AS ai_language
      FROM complaints c
      LEFT JOIN complaint_categories cat ON cat.id = c.category_id
      LEFT JOIN channels ch ON ch.id = c.channel_id
      LEFT JOIN users u ON u.id = c.citizen_id
      LEFT JOIN triage_results t ON t.complaint_id = c.id
      ORDER BY c.created_at DESC
    `);
    return res.json({ complaints: complaints || [] });
  }
});

router.get('/channels', async (req, res) => {
  const authResult = await requireAdmin(req, res);
  if (!authResult.ok) {
    return sendAuthError(res, authResult);
  }

  try {
    const { data: channels } = await supabase
      .from('channels')
      .select('*')
      .order('created_at', { ascending: false });

    const mapped = [];
    for (const ch of channels || []) {
      const { count } = await supabase.from('complaints').select('*', { count: 'exact', head: true }).eq('channel_id', ch.id);
      let members = [];
      try {
        const { data: memberRows } = await supabase
          .from('channel_members')
          .select('user_id, user:users(id, full_name, email, role, role_id)')
          .eq('channel_id', ch.id);
        members = (memberRows || []).map((m) => ({
          id: m.user?.id ?? m.user_id,
          user_id: m.user_id,
          full_name: m.user?.full_name || null,
          email: m.user?.email || null,
          role: normalizeRole(m.user?.role) || null,
          role_id: m.user?.role_id ?? null,
        }));
        // Resolve roles stored only via role_id
        const missingRole = members.filter((m) => !m.role && m.role_id);
        if (missingRole.length > 0) {
          const { data: roleRows } = await supabase.from('roles').select('id, name');
          const roleMap = new Map((roleRows || []).map((r) => [r.id, r.name]));
          for (const m of members) {
            if (!m.role && m.role_id) m.role = normalizeRole(roleMap.get(m.role_id));
          }
        }
      } catch {
        members = [];
      }
      mapped.push({ ...ch, complaint_count: count || 0, member_count: members.length, members });
    }

    return res.json({ channels: mapped });
  } catch (error) {
    console.warn('Supabase channels failed, trying SQLite:', error.message);
    const channels = await db.all('SELECT * FROM channels ORDER BY created_at DESC');
    const mapped = [];
    for (const ch of channels || []) {
      const countRow = await db.get('SELECT COUNT(*) AS count FROM complaints WHERE channel_id = ?', [ch.id]);
      let members = [];
      try {
        members = await db.all(
          `SELECT cm.user_id, u.id AS id, u.full_name, u.email, r.name AS role
           FROM channel_members cm
           LEFT JOIN users u ON u.id = cm.user_id
           LEFT JOIN roles r ON r.id = u.role_id
           WHERE cm.channel_id = ? ORDER BY u.full_name`,
          [ch.id]
        );
      } catch {
        members = [];
      }
      mapped.push({ ...ch, complaint_count: countRow?.count || 0, member_count: members.length, members });
    }
    return res.json({ channels: mapped });
  }
});

router.post('/channels', async (req, res) => {
  const authResult = await requireAdmin(req, res);
  if (!authResult.ok) {
    return sendAuthError(res, authResult);
  }

  const { name, description, createdBy } = req.body || {};

  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Channel name is required.' });
  }

  const { data: existing } = await supabase.from('channels').select('id').eq('name', name.trim()).single();
  if (existing) {
    return res.status(409).json({ message: 'Channel already exists.' });
  }

  const { data: newChannel, error } = await supabase
    .from('channels')
    .insert({ name: name.trim(), description: description || '' })
    .select('id')
    .single();

  if (error) {
    return res.status(500).json({ message: error.message });
  }

  await supabase.from('system_logs').insert({
    user_id: createdBy || authResult.adminProfile?.id || null,
    action: 'CHANNEL_CREATED',
    target_record: `channel_${newChannel.id}`,
    details: { name: name.trim() },
  });

  res.status(201).json({ message: 'Channel created.', channelId: newChannel.id });
});

router.put('/channels/:id', async (req, res) => {
  const authResult = await requireAdmin(req, res);
  if (!authResult.ok) {
    return sendAuthError(res, authResult);
  }

  const { name, description, modifiedBy } = req.body || {};

  const { data: channel } = await supabase.from('channels').select('id').eq('id', req.params.id).single();
  if (!channel) {
    return res.status(404).json({ message: 'Channel not found.' });
  }

  if (name && name.trim()) {
    const { data: duplicate } = await supabase.from('channels').select('id').eq('name', name.trim()).neq('id', req.params.id).single();
    if (duplicate) {
      return res.status(409).json({ message: 'Channel name already exists.' });
    }
  }

  await supabase.from('channels').update({
    name: name?.trim() || '',
    description: description || '',
    updated_at: new Date().toISOString(),
  }).eq('id', req.params.id);

  await supabase.from('system_logs').insert({
    user_id: modifiedBy || authResult.adminProfile?.id || null,
    action: 'CHANNEL_UPDATED',
    target_record: `channel_${req.params.id}`,
    details: { name, description },
  });

  res.json({ message: 'Channel updated.' });
});

router.delete('/channels/:id', async (req, res) => {
  const authResult = await requireAdmin(req, res);
  if (!authResult.ok) {
    return sendAuthError(res, authResult);
  }

  const { data: channel } = await supabase.from('channels').select('id').eq('id', req.params.id).single();
  if (!channel) {
    return res.status(404).json({ message: 'Channel not found.' });
  }

  const { count: complaintsUsing } = await supabase.from('complaints').select('*', { count: 'exact', head: true }).eq('channel_id', req.params.id);

  if ((complaintsUsing || 0) > 0) {
    return res.status(400).json({ message: `Cannot delete: ${complaintsUsing} complaint(s) use this channel.` });
  }

  await supabase.from('channels').delete().eq('id', req.params.id);

  await supabase.from('system_logs').insert({
    user_id: authResult.adminProfile?.id || null,
    action: 'CHANNEL_DELETED',
    target_record: `channel_${req.params.id}`,
    details: {},
  });

  res.json({ message: 'Channel deleted.' });
});

router.get('/assignable-users', async (req, res) => {
  const authResult = await requireAdmin(req, res);
  if (!authResult.ok) {
    return sendAuthError(res, authResult);
  }

  try {
    const { data: users } = await supabase
      .from('users')
      .select('id, full_name, email, auth_id, role, role_id')
      .order('full_name');

    const roleIds = [...new Set((users || []).map((u) => u.role_id).filter(Boolean))];
    const roleNameMap = new Map();
    if (roleIds.length > 0) {
      const { data: roleRows } = await supabase.from('roles').select('id, name').in('id', roleIds);
      for (const roleRow of roleRows || []) {
        roleNameMap.set(roleRow.id, roleRow.name);
      }
    }

    const mapped = (users || [])
      .map((u) => ({
        ...u,
        role: normalizeRole(u.role) || normalizeRole(roleNameMap.get(u.role_id)),
      }))
      .filter((u) => ['TANOD', 'OFFICIAL', 'LUPON'].includes(u.role));

    return res.json({ users: mapped });
  } catch (error) {
    console.warn('Supabase assignable users failed, trying SQLite:', error.message);
    const users = await db.all(
      `SELECT users.id, users.full_name, users.email, users.auth_id, roles.name AS role
       FROM users
       JOIN roles ON roles.id = users.role_id
       WHERE roles.name IN ('TANOD', 'OFFICIAL', 'LUPON')
       ORDER BY users.full_name`
    );
    return res.json({ users: users || [] });
  }
});

// =========================
// CHANNEL MEMBERS (pool per problem/channel)
// =========================
router.get('/channels/:id/members', async (req, res) => {
  const authResult = await requireAdmin(req, res);
  if (!authResult.ok) {
    return sendAuthError(res, authResult);
  }

  try {
    const { data: memberRows, error } = await supabase
      .from('channel_members')
      .select('user_id, user:users(id, full_name, email, role, role_id)')
      .eq('channel_id', req.params.id);
    if (error) throw error;
    const { data: roleRows } = await supabase.from('roles').select('id, name');
    const roleMap = new Map((roleRows || []).map((r) => [r.id, r.name]));
    const members = (memberRows || []).map((m) => ({
      id: m.user?.id ?? m.user_id,
      user_id: m.user_id,
      full_name: m.user?.full_name || null,
      email: m.user?.email || null,
      role: normalizeRole(m.user?.role) || normalizeRole(roleMap.get(m.user?.role_id)),
    }));
    return res.json({ members });
  } catch (error) {
    console.warn('Supabase channel members failed, trying SQLite:', error.message);
    try {
      const members = await db.all(
        `SELECT cm.user_id, u.id AS id, u.full_name, u.email, r.name AS role
         FROM channel_members cm
         LEFT JOIN users u ON u.id = cm.user_id
         LEFT JOIN roles r ON r.id = u.role_id
         WHERE cm.channel_id = ? ORDER BY u.full_name`,
        [req.params.id]
      );
      return res.json({ members: members || [] });
    } catch (sqliteError) {
      return res.json({ members: [] });
    }
  }
});

router.put('/channels/:id/members', async (req, res) => {
  const authResult = await requireAdmin(req, res);
  if (!authResult.ok) {
    return sendAuthError(res, authResult);
  }

  const { userIds, modifiedBy } = req.body || {};
  if (!Array.isArray(userIds)) {
    return res.status(400).json({ message: 'userIds must be an array of user IDs.' });
  }

  // Validate: only TANOD / OFFICIAL / LUPON may be assigned to a channel pool
  const validRoles = ['TANOD', 'OFFICIAL', 'LUPON'];
  try {
    if (userIds.length > 0) {
      const { data: candidateUsers } = await supabase.from('users').select('id, role, role_id').in('id', userIds);
      const { data: roleRows } = await supabase.from('roles').select('id, name');
      const roleMap = new Map((roleRows || []).map((r) => [r.id, r.name]));
      const invalid = (candidateUsers || []).filter((u) => {
        const role = normalizeRole(u.role) || normalizeRole(roleMap.get(u.role_id));
        return !validRoles.includes(role);
      });
      if (invalid.length > 0 || (candidateUsers || []).length !== userIds.length) {
        return res.status(400).json({ message: 'Only TANOD, OFFICIAL or LUPON members can be assigned to a channel.' });
      }
    }

    await supabase.from('channel_members').delete().eq('channel_id', req.params.id);
    if (userIds.length > 0) {
      const rows = [...new Set(userIds.map(Number))].map((user_id) => ({
        channel_id: Number(req.params.id),
        user_id,
      }));
      const { error: insertError } = await supabase.from('channel_members').insert(rows);
      if (insertError) throw insertError;
    }

    await supabase.from('system_logs').insert({
      user_id: modifiedBy || authResult.adminProfile?.id || null,
      action: 'CHANNEL_UPDATED',
      target_record: `channel_${req.params.id}`,
      details: { member_count: [...new Set(userIds)].length, members: userIds },
    });

    return res.json({ message: 'Channel members updated.', memberCount: [...new Set(userIds)].length });
  } catch (error) {
    console.warn('Supabase channel members update failed, trying SQLite:', error.message);
    try {
      await db.run('DELETE FROM channel_members WHERE channel_id = ?', [req.params.id]);
      for (const uid of [...new Set(userIds.map(Number))]) {
        await db.run('INSERT OR IGNORE INTO channel_members (channel_id, user_id) VALUES (?, ?)', [req.params.id, uid]);
      }
      return res.json({ message: 'Channel members updated.', memberCount: [...new Set(userIds)].length });
    } catch (sqliteError) {
      return res.status(500).json({ message: sqliteError.message || 'Failed to update channel members.' });
    }
  }
});

// Fixed SQL-driven assignment lives in server/lib/assignment.js (shared with
// citizen submit so new complaints arrive already assigned).
// Handler rule: first user_id of the channel's mapped role within the team.
async function pickAutoAssigneeSupabase(channelId, channelName) {
  return pickFixedSupabase(supabase, channelId, channelName);
}

async function pickAutoAssigneeSQLite(channelId, channelName) {
  return pickFixedSQLite(db, channelId, channelName);
}

// Pre-assigned "will handle" preview per channel (read-only: same picker, no writes).
router.post('/complaints/:id/auto-assign', async (req, res) => {
  const authResult = await requireAdmin(req, res);
  if (!authResult.ok) {
    return sendAuthError(res, authResult);
  }

  const { assignedBy, channelId: bodyChannelId } = req.body || {};

  // Resolve complaint + AI channel (body channelId is legacy/optional override).
  const { data: complaint } = await supabase
    .from('complaints')
    .select('id, title, description, location, channel_id, citizen_id')
    .eq('id', req.params.id)
    .single();
  if (!complaint) {
    return res.status(404).json({ message: 'Complaint not found.' });
  }

  let channelId = bodyChannelId || complaint.channel_id || null;
  let channel = null;
  if (channelId) {
    const { data } = await supabase.from('channels').select('id, name').eq('id', channelId).single();
    channel = data || null;
  }
  if (!channel) {
    // AI is the authority: description (+ auxiliary location signal).
    const ai = triageComplaint(complaint.description || '', complaint.location || '');
    const { data } = await supabase.from('channels').select('id, name').eq('name', ai.channel).single();
    channel = data || null;
    if (channel) {
      channelId = channel.id;
      await supabase.from('complaints').update({
        channel_id: channel.id,
        priority: ai.priority,
        updated_at: new Date().toISOString(),
      }).eq('id', req.params.id);
      try {
        await supabase.from('triage_results').upsert({
          complaint_id: Number(req.params.id),
          suggested_priority: ai.priority,
          confidence: ai.confidence,
          language: ai.language || null,
          model_type: 'Naive Bayes',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'complaint_id' });
      } catch {
        // triage write is best-effort
      }
    }
  }
  if (!channel) {
    return res.status(400).json({ message: 'Could not determine the complaint channel. Re-run AI triage first.' });
  }

  try {
    const pick = await pickAutoAssigneeSupabase(channelId, channel.name);
    if (!pick) {
      return res.status(400).json({ message: `No members assigned to channel "${channel.name}". Seed the channel team first.` });
    }

    await supabase.from('complaints').update({
      assigned_to: pick.user_id,
      channel_id: channelId,
      status: 'ASSIGNED',
      updated_at: new Date().toISOString(),
    }).eq('id', req.params.id);

    await supabase.from('system_logs').insert({
      user_id: assignedBy || authResult.adminProfile?.id || null,
      action: 'COMPLAINT_ASSIGNED',
      target_record: `complaint_${req.params.id}`,
      details: { assigned_to: pick.user_id, assigned_name: pick.full_name, assigned_role: pick.role, channel_id: channelId, channel_name: channel.name, auto: true },
    });

    try {
      await supabase.from('notifications').insert({
        user_id: pick.user_id,
        title: 'New Complaint Auto-Assigned',
        message: `You have been assigned a "${channel.name}" complaint: "${complaint?.title || 'Untitled'}".`,
        is_read: false,
      });
      if (complaint.citizen_id) {
        const assignedMessage = `Your complaint "${complaint?.title || 'Untitled'}" has been assigned to ${pick.full_name || 'a staff member'} (${channel.name}).`;
        await notifyCitizen(supabase, complaint.citizen_id, {
          title: 'Complaint Assigned',
          message: assignedMessage,
          sms: `Barangay Saray: ${assignedMessage}`,
        });
      }
    } catch (notifyError) {
      console.warn('Failed to send auto-assign notifications:', notifyError.message);
    }

    return res.json({ message: `Complaint assigned to ${pick.full_name || 'member'} (${pick.role || channel.name}).`, assignedTo: pick.user_id, assignedName: pick.full_name, assignedRole: pick.role, channelName: channel.name });
  } catch (error) {
    console.warn('Supabase auto-assign failed, trying SQLite:', error.message);
    try {
      const chRow = await db.get('SELECT id, name FROM channels WHERE id = ?', [channelId]);
      const pick = await pickAutoAssigneeSQLite(channelId, chRow?.name || channel.name);
      if (!pick) {
        return res.status(400).json({ message: 'No members assigned to this channel.' });
      }
      await db.run(`UPDATE complaints SET assigned_to = ?, channel_id = ?, status = 'ASSIGNED', updated_at = datetime('now') WHERE id = ?`, [pick.user_id, channelId, req.params.id]);
      return res.json({ message: `Complaint assigned to ${pick.full_name || 'member'}.`, assignedTo: pick.user_id, assignedName: pick.full_name });
    } catch (sqliteError) {
      return res.status(500).json({ message: sqliteError.message || 'Auto-assign failed.' });
    }
  }
});

router.put('/complaints/:id/assign', async (req, res) => {
  const authResult = await requireAdmin(req, res);
  if (!authResult.ok) {
    return sendAuthError(res, authResult);
  }

  const { assignedTo, assignedBy, channelId } = req.body || {};

  const { data: complaint } = await supabase.from('complaints').select('id, title, citizen_id').eq('id', req.params.id).single();
  if (!complaint) {
    return res.status(404).json({ message: 'Complaint not found.' });
  }

  const { data: assignee } = await supabase.from('users').select('id, full_name').eq('id', assignedTo).single();
  if (!assignee) {
    return res.status(404).json({ message: 'Assignee not found.' });
  }

  const updatePayload = {
    assigned_to: assignedTo,
    status: 'ASSIGNED',
    updated_at: new Date().toISOString(),
  };
  if (channelId) updatePayload.channel_id = channelId;

  await supabase.from('complaints').update(updatePayload).eq('id', req.params.id);

  await supabase.from('system_logs').insert({
    user_id: assignedBy || authResult.adminProfile?.id || null,
    action: 'COMPLAINT_ASSIGNED',
    target_record: `complaint_${req.params.id}`,
    details: { assigned_to: assignedTo, assigned_name: assignee.full_name, channel_id: channelId || null },
  });

  try {
    await supabase.from('notifications').insert({
      user_id: assignedTo,
      title: 'New Complaint Assigned',
      message: `You have been assigned a complaint: "${complaint?.title || 'Untitled'}".`,
      is_read: false,
    });

    if (complaint.citizen_id) {
      const assignedMessage = `Your complaint "${complaint?.title || 'Untitled'}" has been assigned to ${assignee.full_name}.`;
      await notifyCitizen(supabase, complaint.citizen_id, {
        title: 'Complaint Assigned',
        message: assignedMessage,
        sms: `Barangay Saray: ${assignedMessage}`,
      });
    }
  } catch (notifyError) {
    console.warn('Failed to send assignment notifications:', notifyError.message);
  }

  res.json({ message: `Complaint assigned to ${assignee.full_name}.` });
});

// =========================
// WALK-IN COMPLAINT (admin-assisted manual intake)
// Body: {
//   reporter: { mode: 'existing' | 'new', citizenId?, fullName?, address?, email?, forceCreate? },
//   complaint: { description }
// }
// - 'existing': citizenId must be an ACTIVE CITIZEN row.
// - 'new': fullName + address required; duplicate check (name ILIKE / email exact)
//   returns 409 { matches } unless forceCreate is true; creates a lightweight
//   profile (CITIZEN, ACTIVE, synthetic email when none given, unusable login).
// The complaint then runs the identical pipeline as citizen submit:
// AI triage -> channel -> instant fixed-handler assign -> notifications.
// =========================
function walkinSyntheticEmail() {
  const rand = `${Date.now().toString(36)}${Math.floor(Math.random() * 0xffffff).toString(36)}`;
  return `walkin-${rand}@walkin.local`;
}

function isCitizenRow(u) {
  if (!u) return false;
  const role = normalizeRole(u.role);
  if (role) return role === 'CITIZEN';
  return true;
}

router.post('/walkin-complaints', async (req, res) => {
  const authResult = await requireAdmin(req, res);
  if (!authResult.ok) {
    return sendAuthError(res, authResult);
  }
  const createdBy = authResult.adminProfile?.id || null;

  const { reporter = {}, complaint = {} } = req.body || {};
  const description = (complaint.description || '').trim();
  if (!description) {
    return res.status(400).json({ message: 'Complaint description is required.' });
  }

  const useSupabase = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    if (useSupabase) {
      return await createWalkinComplaintSupabase(req, res, { reporter, description, createdBy });
    }
    return await createWalkinComplaintSQLite(req, res, { reporter, description, createdBy });
  } catch (error) {
    console.error('Walk-in complaint failed:', error);
    return res.status(500).json({ message: error.message || 'Failed to file walk-in complaint.' });
  }
});

async function resolveWalkinReporterSupabase(reporter) {
  const mode = reporter.mode === 'existing' ? 'existing' : 'new';

  if (mode === 'existing') {
    const citizenId = Number(reporter.citizenId);
    if (!citizenId) {
      const err = new Error('Select an existing citizen to file under.');
      err.status = 400;
      throw err;
    }
    const { data: row, error } = await supabase
      .from('users')
      .select('id, full_name, email, role, role_id, status, address')
      .eq('id', citizenId)
      .maybeSingle();
    if (error) throw error;
    if (!row || !isCitizenRow(row)) {
      const err = new Error('Selected reporter is not a citizen account.');
      err.status = 400;
      throw err;
    }
    if (row.status !== 'ACTIVE') {
      const err = new Error(`Selected citizen is ${row.status || 'not active'}. Pick an ACTIVE citizen or file as a new walk-in person.`);
      err.status = 400;
      throw err;
    }
    return { reporterRow: row, created: false };
  }

  // mode: 'new'
  const fullName = (reporter.fullName || '').trim();
  const address = (reporter.address || '').trim();
  if (!fullName || !address) {
    const err = new Error('Walk-in reporter full name and address are required.');
    err.status = 400;
    throw err;
  }
  const email = (reporter.email || '').trim().toLowerCase() || null;

  if (!reporter.forceCreate) {
    let q = supabase.from('users').select('id, full_name, email, address, status').eq('role', 'CITIZEN').ilike('full_name', `%${fullName}%`).limit(5);
    // PostgREST OR would be nicer, but keep it simple: name match first...
    const { data: nameMatches } = await q;
    let matches = nameMatches || [];
    if (email) {
      const { data: emailMatch } = await supabase.from('users').select('id, full_name, email, address, status').eq('email', email).maybeSingle();
      if (emailMatch && !matches.some((m) => m.id === emailMatch.id)) matches = [emailMatch, ...matches];
    }
    if (matches.length > 0) {
      return { duplicateMatches: matches.slice(0, 5) };
    }
  }

  const { data: citizenRole } = await supabase.from('roles').select('id').eq('name', 'CITIZEN').maybeSingle();
  const payload = {
    full_name: fullName,
    email: email || walkinSyntheticEmail(),
    role: 'CITIZEN',
    role_id: citizenRole?.id || null,
    status: 'ACTIVE',
    address,
  };
  let { data: created, error: createError } = await supabase.from('users').insert(payload).select('id, full_name, email, role, status, address').single();
  if (createError && /address/i.test(createError.message || '')) {
    // Older project without users.address: retry without it.
    const { address: _drop, ...noAddress } = payload;
    const retry = await supabase.from('users').insert(noAddress).select('id, full_name, email, role, status, address').single();
    created = retry.data;
    createError = retry.error;
  }
  if (createError) throw createError;
  return { reporterRow: created, created: true };
}

async function fileWalkinComplaintSupabase({ reporterRow, description, createdBy }) {
  const triage = triageComplaint(description, '');
  const { data: channelRow } = await supabase.from('channels').select('id').eq('name', triage.channel).single();
  const { data: categoryRow } = await supabase.from('complaint_categories').select('id').eq('name', triage.category).single();

  const complaintId = `CMP-${Date.now()}`;
  const { data: filed, error } = await supabase.from('complaints').insert({
    citizen_id: reporterRow.id,
    complaint_id: complaintId,
    title: triage.channel,
    description,
    location: null,
    category_id: categoryRow?.id || null,
    priority: triage.priority,
    status: 'SUBMITTED',
    channel_id: channelRow?.id || null,
    source: 'walk-in',
  }).select().single();
  if (error) throw error;

  let record = filed;
  await supabase.from('triage_results').insert({
    complaint_id: record.id,
    category_id: categoryRow?.id || null,
    suggested_priority: triage.priority,
    confidence: triage.confidence,
    language: triage.language || null,
    model_type: 'Naive Bayes',
  });

  let assigned = null;
  let assignmentFailure = null;
  if (!channelRow?.id) {
    assignmentFailure = `AI channel "${triage.channel}" did not match a channels row; left SUBMITTED; assignment is automatic at submit, see failure log.`;
  } else {
    try {
      const { pickFixedHandlerSupabase } = await import('../../lib/assignment.js');
      assigned = await pickFixedHandlerSupabase(supabase, channelRow.id, triage.channel);
      if (!assigned) {
        assignmentFailure = `No handler found in "${triage.channel}" team (empty team and empty fallback); left SUBMITTED; assignment is automatic at submit, see failure log.`;
      }
    } catch (assignError) {
      assignmentFailure = `Instant assignment threw (${assignError.message}); left SUBMITTED; assignment is automatic at submit, see failure log.`;
    }
  }

  if (assigned) {
    await supabase.from('complaints').update({
      assigned_to: assigned.user_id,
      status: 'ASSIGNED',
      updated_at: new Date().toISOString(),
    }).eq('id', record.id);
    record = { ...record, assigned_to: assigned.user_id, status: 'ASSIGNED' };
    await supabase.from('system_logs').insert({
      user_id: createdBy,
      action: 'COMPLAINT_ASSIGNED',
      target_record: `complaint_${record.id}`,
      details: { assigned_to: assigned.user_id, assigned_name: assigned.full_name, assigned_role: assigned.role, channel_id: channelRow.id, channel_name: triage.channel, auto: true, at_submit: true, source: 'walk-in' },
    });
    try {
      await supabase.from('notifications').insert({
        user_id: assigned.user_id,
        title: 'New Complaint Assigned',
        message: `You have been assigned a walk-in "${triage.channel}" complaint from ${reporterRow.full_name}.`,
        is_read: false,
      });
      const { data: teammates } = await supabase.from('channel_members').select('user_id').eq('channel_id', channelRow.id).neq('user_id', assigned.user_id);
      const teammateIds = [...new Set((teammates || []).map((t) => t.user_id))];
      if (teammateIds.length > 0) {
        await supabase.from('notifications').insert(teammateIds.map((uid) => ({
          user_id: uid,
          title: `New ${triage.channel} Case`,
          message: `A walk-in complaint from ${reporterRow.full_name} arrived in your channel and was assigned to ${assigned.full_name || 'a teammate'}.`,
          is_read: false,
        })));
      }
      const walkinMessage = `Your walk-in complaint was recorded and routed to ${triage.channel}.`;
      await notifyCitizen(supabase, reporterRow.id, {
        title: 'Complaint Received',
        message: walkinMessage,
        sms: `Barangay Saray: ${walkinMessage}`,
      });
    } catch {
      // notifications best-effort
    }
  }

  if (!assigned && assignmentFailure) {
    console.warn(`Walk-in complaint ${record.id}: ${assignmentFailure}`);
    try {
      await supabase.from('system_logs').insert({
        user_id: createdBy,
        action: 'COMPLAINT_ASSIGNMENT_FAILED',
        target_record: `complaint_${record.id}`,
        details: { reason: assignmentFailure, channel_name: triage.channel, source: 'walk-in' },
      });
    } catch {
      // logging best-effort
    }
  }

  await supabase.from('system_logs').insert({
    user_id: createdBy,
    action: 'COMPLAINT_CREATED',
    target_record: `complaint_${record.id}`,
    details: { source: 'walk-in', channel_name: triage.channel, citizen_id: reporterRow.id },
  });

  return { record, triage, assigned };
}

async function createWalkinComplaintSupabase(req, res, { reporter, description, createdBy }) {
  let resolution;
  try {
    resolution = await resolveWalkinReporterSupabase(reporter);
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || 'Failed to resolve reporter.' });
  }
  if (resolution.duplicateMatches) {
    return res.status(409).json({
      message: 'A citizen with a similar name already exists. File under the existing profile or confirm creating a new one.',
      matches: resolution.duplicateMatches,
    });
  }
  try {
    const { record, triage, assigned } = await fileWalkinComplaintSupabase({
      reporterRow: resolution.reporterRow, description, createdBy,
    });
    return res.status(201).json({
      message: assigned
        ? `Walk-in complaint recorded, routed to ${triage.channel} and assigned to ${assigned.full_name || 'a staff member'} (${assigned.role || ''}).`
        : `Walk-in complaint recorded and routed to ${triage.channel}.`,
      complaint: record,
      triage,
      assignedTo: assigned?.user_id || null,
      assignedName: assigned?.full_name || null,
      reporter: { id: resolution.reporterRow.id, fullName: resolution.reporterRow.full_name, created: resolution.created },
    });
  } catch (error) {
    // Roll back a profile created moments ago by this same call so failed
    // filings never strand orphan citizen rows.
    if (resolution.created) {
      try {
        await supabase.from('users').delete().eq('id', resolution.reporterRow.id);
      } catch {
        // rollback best-effort; orphan can be removed from Manage Accounts
      }
    }
    console.error('Walk-in complaint filing failed:', error);
    return res.status(500).json({ message: error.message || 'Failed to file walk-in complaint.' });
  }
}

async function createWalkinComplaintSQLite(req, res, { reporter, description, createdBy }) {
  const mode = reporter.mode === 'existing' ? 'existing' : 'new';
  let reporterRow = null;
  let created = false;

  if (mode === 'existing') {
    const citizenId = Number(reporter.citizenId);
    if (!citizenId) return res.status(400).json({ message: 'Select an existing citizen to file under.' });
    reporterRow = await db.get(
      `SELECT users.id, users.full_name, users.email, users.status, roles.name AS role_name
       FROM users LEFT JOIN roles ON roles.id = users.role_id WHERE users.id = ?`,
      [citizenId]
    );
    const role = String(reporterRow?.role_name || '').toUpperCase();
    if (!reporterRow || (reporterRow.role_name && role !== 'CITIZEN')) {
      return res.status(400).json({ message: 'Selected reporter is not a citizen account.' });
    }
    if (reporterRow.status !== 'ACTIVE') {
      return res.status(400).json({ message: `Selected citizen is ${reporterRow.status || 'not active'}. Pick an ACTIVE citizen or file as a new walk-in person.` });
    }
  } else {
    const fullName = (reporter.fullName || '').trim();
    const address = (reporter.address || '').trim();
    if (!fullName || !address) {
      return res.status(400).json({ message: 'Walk-in reporter full name and address are required.' });
    }
    const email = (reporter.email || '').trim().toLowerCase() || null;
    if (!reporter.forceCreate) {
      const like = await db.all(
        `SELECT users.id, users.full_name, users.email, users.status FROM users
         LEFT JOIN roles ON roles.id = users.role_id
         WHERE roles.name = 'CITIZEN' AND users.full_name LIKE ? LIMIT 5`,
        [`%${fullName}%`]
      );
      let matches = like || [];
      if (email) {
        const emailMatch = await db.get(`SELECT id, full_name, email, status FROM users WHERE email = ?`, [email]);
        if (emailMatch && !matches.some((m) => m.id === emailMatch.id)) matches = [emailMatch, ...matches];
      }
      if (matches.length > 0) {
        return res.status(409).json({
          message: 'A citizen with a similar name already exists. File under the existing profile or confirm creating a new one.',
          matches: matches.slice(0, 5),
        });
      }
    }
    const citizenRole = await db.get(`SELECT id FROM roles WHERE name = 'CITIZEN'`);
    const placeholderHash = await bcrypt.hash(`walkin-${Date.now()}-${Math.random().toString(36).slice(2)}`, 10);
    const result = await db.run(
      `INSERT INTO users (full_name, email, password_hash, role_id, status, address)
       VALUES (?, ?, ?, ?, 'ACTIVE', ?)`,
      [fullName, email || walkinSyntheticEmail(), placeholderHash, citizenRole?.id || null, address]
    );
    reporterRow = await db.get(`SELECT id, full_name, email, status FROM users WHERE id = ?`, [result.lastID]);
    created = true;
  }

  try {
    const triage = triageComplaint(description, '');
    const channelRow = await db.get(`SELECT id FROM channels WHERE name = ?`, [triage.channel]);
    const categoryRow = await db.get(`SELECT id FROM complaint_categories WHERE name = ?`, [triage.category]);
    const complaintId = `CMP-${Date.now()}`;
    const insert = await db.run(
      `INSERT INTO complaints (citizen_id, complaint_id, title, description, location, category_id, priority, status, channel_id, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, 'SUBMITTED', ?, 'walk-in', datetime('now'), datetime('now'))`,
      [reporterRow.id, complaintId, triage.channel, description, categoryRow?.id || null, triage.priority, channelRow?.id || null]
    );
    const record = await db.get(`SELECT * FROM complaints WHERE id = ?`, [insert.lastID]);
    await db.run(
      `INSERT INTO triage_results (complaint_id, category_id, suggested_priority, confidence, language, model_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'Naive Bayes', datetime('now'), datetime('now'))`,
      [record.id, categoryRow?.id || null, triage.priority, triage.confidence, triage.language || null]
    );

    const { pickFixedHandlerSQLite } = await import('../../lib/assignment.js');
    let assigned = null;
    if (channelRow?.id) {
      try {
        assigned = await pickFixedHandlerSQLite(db, channelRow.id, triage.channel);
      } catch (e) {
        console.warn(`Walk-in complaint ${record.id}: instant assignment threw (${e.message})`);
      }
    }
    if (assigned) {
      await db.run(`UPDATE complaints SET assigned_to = ?, status = 'ASSIGNED', updated_at = datetime('now') WHERE id = ?`, [assigned.user_id, record.id]);
      record.assigned_to = assigned.user_id;
      record.status = 'ASSIGNED';
    }

    return res.status(201).json({
      message: assigned
        ? `Walk-in complaint recorded, routed to ${triage.channel} and assigned to ${assigned.full_name || 'a staff member'} (${assigned.role || ''}).`
        : `Walk-in complaint recorded and routed to ${triage.channel}.`,
      complaint: record,
      triage,
      assignedTo: assigned?.user_id || null,
      assignedName: assigned?.full_name || null,
      reporter: { id: reporterRow.id, fullName: reporterRow.full_name, created },
    });
  } catch (error) {
    // Roll back a profile created moments ago by this same call.
    if (created && reporterRow?.id) {
      try {
        await db.run(`DELETE FROM users WHERE id = ?`, [reporterRow.id]);
      } catch {
        // rollback best-effort
      }
    }
    console.error('Walk-in complaint filing failed (SQLite):', error);
    return res.status(500).json({ message: error.message || 'Failed to file walk-in complaint.' });
  }
}

export default router;
