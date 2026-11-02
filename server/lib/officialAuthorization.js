import jwt from 'jsonwebtoken';
import { getSupabaseAdmin } from '../supabaseAdmin.js';
import { db } from '../database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

export async function authorizeOfficialRequest(req) {
  const authorization = req.headers.authorization || '';
  const accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!accessToken) {
    return { ok: false, status: 401, message: 'Authentication required.' };
  }

  let algorithm;
  try {
    const [header] = accessToken.split('.');
    algorithm = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')).alg;
  } catch {
    return { ok: false, status: 401, message: 'Invalid or expired token.' };
  }

  let profile;
  if (String(algorithm || '').toUpperCase().startsWith('ES')) {
    try {
      const supabaseAdmin = getSupabaseAdmin();
      const { data: authResult, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
      if (authError || !authResult?.user) {
        return { ok: false, status: 401, message: 'Your session has expired. Please log in again.' };
      }

      const { data, error } = await supabaseAdmin
        .from('users')
        .select('id, role, status')
        .eq('auth_id', authResult.user.id)
        .maybeSingle();
      if (error) {
        console.error('Failed to resolve Official profile:', error.message);
        return { ok: false, status: 500, message: 'Unable to verify your account role.' };
      }
      profile = data;
    } catch (error) {
      console.error('Failed to verify Official session:', error.message);
      return { ok: false, status: 500, message: 'Unable to verify your account role.' };
    }
  } else {
    let decoded;
    try {
      decoded = jwt.verify(accessToken, JWT_SECRET);
    } catch {
      return { ok: false, status: 401, message: 'Your session has expired. Please log in again.' };
    }
    profile = await db.get(
      `SELECT users.id, roles.name AS role, users.status
       FROM users LEFT JOIN roles ON roles.id = users.role_id
       WHERE users.id = ?`,
      [decoded.id]
    );
  }

  if (!profile || String(profile.status || '').toUpperCase() !== 'ACTIVE') {
    return { ok: false, status: 403, message: 'An active Official account is required.' };
  }
  if (String(profile.role || '').trim().toUpperCase() !== 'OFFICIAL') {
    return { ok: false, status: 403, message: 'Only Barangay Officials can assign complaints.' };
  }

  return { ok: true, profile };
}
