import express from 'express';
import jwt from 'jsonwebtoken';
import { getSupabaseAdmin } from '../supabaseAdmin.js';
import { classifyComplaintWithPython } from '../lib/mlClassifier.js';

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

async function resolveAuthenticatedUser(req) {
  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (accessToken) {
    // Supabase access token (used by the frontend).
    try {
      const supabaseAdmin = getSupabaseAdmin();
      const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
      if (!error && data?.user) {
        return data.user;
      }
    } catch {
      // Fall through to local JWT verification.
    }

    // Local SQLite JWT (demo accounts / server-issued tokens).
    try {
      const decoded = jwt.verify(accessToken, JWT_SECRET);
      return { id: decoded.id, role: decoded.role, email: decoded.email };
    } catch {
      // Not a valid local token either.
    }
  }

  // Fallback: authId supplied by the client (mirrors citizen routes).
  const authId = req.body?.authId;
  if (authId) {
    try {
      const supabaseAdmin = getSupabaseAdmin();
      const { data } = await supabaseAdmin
        .from('users')
        .select('id, role, auth_id')
        .eq('auth_id', authId)
        .maybeSingle();
      if (data) return data;
    } catch {
      // ignore
    }
  }

  return null;
}

router.post('/classify-complaint', async (req, res) => {
  const user = await resolveAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ message: 'Authentication required.' });
  }

  const complaintText = (req.body?.complaint_text ?? req.body?.complaintText ?? '').toString().trim();

  if (!complaintText) {
    return res.status(400).json({ message: 'complaint_text is required.' });
  }

  try {
    const triage = await classifyComplaintWithPython(complaintText);
    return res.json({ predicted_category: triage.category });
  } catch (error) {
    console.error('Python complaint classification failed:', error.message);
    return res.status(503).json({ message: error.message });
  }
});

export default router;
