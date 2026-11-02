import { supabase } from '../lib/supabase';

export async function getAdminAccessToken() {
  // Prefer the live Supabase session token: supabase-js auto-refreshes it,
  // so it never goes stale. Fall back to the stored API token for
  // SQLite-fallback logins, which have no Supabase session.
  try {
    const { data, error } = await supabase.auth.getSession();
    if (!error && data?.session?.access_token) {
      return data.session.access_token;
    }
  } catch (error) {
    console.warn('Supabase session lookup failed:', error);
  }

  return window.localStorage.getItem('authToken') || '';
}

export function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function normalizeRole(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase();
    return normalized || null;
  }

  if (typeof value === 'object') {
    const candidate =
      value.name ||
      value.role_name ||
      value.role ||
      value.title ||
      '';
    const normalized = String(candidate).trim().toUpperCase();
    return normalized || null;
  }

  const normalized = String(value).trim().toUpperCase();
  return normalized || null;
}

export function getDashboardPath(role) {
  const roleMap = {
    CITIZEN: '/citizen/dashboard',
    TANOD: '/tanod/dashboard',
    OFFICIAL: '/official/dashboard',
    LUPON: '/lupon/dashboard',
    ADMIN: '/admin/dashboard',
  };

  return roleMap[normalizeRole(role)] || '/login';
}
