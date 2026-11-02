import express from 'express';
import supabase from '../../supabaseAdmin.js';
import { attachEvidence } from '../../lib/evidence.js';
import { notifyCitizen } from '../../lib/notifyCitizen.js';

const router = express.Router();

const COMPLAINT_SELECT = '*, category:complaint_categories(name), channel:channels(name), citizen:users!complaints_citizen_id_fkey(full_name), assignee:users!complaints_assigned_to_fkey(full_name)';

function mapComplaint(c, staffId) {
  return {
    ...c,
    category_name: c.category?.name || null,
    channel_name: c.channel?.name || null,
    citizen_name: c.citizen?.full_name || null,
    assigned_name: c.assignee?.full_name || null,
    is_mine: staffId ? c.assigned_to === staffId : false,
  };
}

// Resolve the public.users id for a Supabase auth id (browser sessions only
// carry the auth UUID, and anon RLS hides the profile lookup client-side).
async function resolveStaffId(authId) {
  if (!authId) return null;
  const { data: user } = await supabase.from('users').select('id').eq('auth_id', authId).single();
  return user?.id || null;
}

// GET /lupon/me?authId= — public.users id for the logged-in staff member.
router.get('/me', async (req, res) => {
  const staffId = await resolveStaffId(req.query.authId);
  if (!staffId) {
    return res.status(404).json({ message: 'Staff profile not found for this login.' });
  }
  return res.json({ id: staffId });
});

router.get('/members', async (req, res) => {
  try {
    const { data: role } = await supabase.from('roles').select('id').eq('name', 'LUPON').single();
    if (!role) return res.json({ members: [] });
    const { data: users, error } = await supabase
      .from('users')
      .select('id, full_name, email, status')
      .eq('role_id', role.id)
      .eq('status', 'ACTIVE');
    if (error) return res.status(500).json({ message: error.message });
    res.json({ members: users || [] });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/complaints', async (req, res) => {
  const { authId, assigned, team } = req.query;

  let query = supabase
    .from('complaints')
    .select(COMPLAINT_SELECT)
    .order('created_at', { ascending: false });

  let staffId = null;
  if (authId && (assigned === 'true' || team === 'true')) {
    staffId = await resolveStaffId(authId);
    if (!staffId) {
      // Authenticated login with no linked staff profile: nothing is theirs.
      return res.json({ complaints: [] });
    }
    if (assigned === 'true') {
      query = query.eq('assigned_to', staffId);
    } else if (team === 'true') {
      // All complaints in this lupon member's seeded channels.
      const { data: memberships } = await supabase
        .from('channel_members')
        .select('channel_id')
        .eq('user_id', staffId);
      const channelIds = [...new Set((memberships || []).map((m) => m.channel_id))];
      if (channelIds.length > 0) {
        query = query.or(`channel_id.in.(${channelIds.join(',')}),assigned_to.eq.${staffId}`);
      } else {
        // No seeded team: show complaints assigned directly to this staff member.
        query = query.eq('assigned_to', staffId);
      }
    }
  } else if (authId) {
    staffId = await resolveStaffId(authId);
  }

  const { data: complaints } = await query;

  await attachEvidence(supabase, complaints || []);

  const mapped = (complaints || []).map((c) => mapComplaint(c, staffId));

  res.json({ complaints: mapped });
});

router.get('/complaints/:id', async (req, res) => {
  const { data: complaint, error } = await supabase
    .from('complaints')
    .select('*, category:complaint_categories(name), channel:channels(name), citizen:users!complaints_citizen_id_fkey(full_name), assignee:users!complaints_assigned_to_fkey(full_name)')
    .eq('id', req.params.id)
    .single();

  if (error || !complaint) {
    return res.status(404).json({ message: 'Complaint not found.' });
  }

  await attachEvidence(supabase, [complaint]);

  const mapped = {
    ...complaint,
    category_name: complaint.category?.name || null,
    channel_name: complaint.channel?.name || null,
    citizen_name: complaint.citizen?.full_name || null,
    assigned_name: complaint.assignee?.full_name || null,
  };

  res.json({ complaint: mapped });
});

router.post('/complaints/:id/hearings', async (req, res) => {
  const { scheduledDate, scheduledTime, location, notes, userId, userRole, assignedMembers } = req.body || {};

  if (!scheduledDate || !scheduledTime) {
    return res.status(400).json({ message: 'Date and time are required.' });
  }

  const { data: complaint, error: complaintError } = await supabase
    .from('complaints')
    .select('id, title, citizen_id')
    .eq('id', req.params.id)
    .single();

  if (complaintError || !complaint) {
    return res.status(404).json({ message: 'Complaint not found.' });
  }

  const { data: hearing, error } = await supabase
    .from('hearings')
    .insert({
      complaint_id: Number(req.params.id),
      scheduled_date: scheduledDate,
      scheduled_time: scheduledTime,
      location: location || '',
      notes: notes || '',
      status: 'SCHEDULED',
      assigned_members: Array.isArray(assignedMembers) ? JSON.stringify(assignedMembers) : (assignedMembers || null),
    })
    .select('id')
    .single();

  if (error) {
    return res.status(500).json({ message: error.message });
  }

  const { data: updatedComplaint, error: statusError } = await supabase.from('complaints').update({
    status: 'FOR HEARING / MEDIATION',
    updated_at: new Date().toISOString(),
  }).eq('id', req.params.id).select('id, status, updated_at').single();

  if (statusError || !updatedComplaint) {
    console.error('Failed to update complaint hearing status:', statusError?.message || 'No complaint was updated.');
    return res.status(500).json({ message: 'Failed to update complaint status.' });
  }

  await supabase.from('system_logs').insert({
    user_id: userId,
    action: 'HEARING_CREATED',
    target_record: `complaint_${req.params.id}`,
    details: { date: scheduledDate, time: scheduledTime, location },
  });

  if (complaint?.citizen_id) {
    const hearingMessage = `A hearing has been scheduled for your complaint "${complaint.title || 'Complaint'}" on ${scheduledDate} at ${scheduledTime}.`;
    try {
      await notifyCitizen(supabase, complaint.citizen_id, {
        title: 'Hearing Scheduled',
        message: hearingMessage,
        sms: `Barangay Saray: ${hearingMessage}`,
      });
    } catch (notifyError) {
      console.warn('Failed to send hearing notification:', notifyError?.message);
    }
  }

  res.status(201).json({
    message: 'Hearing scheduled successfully.',
    hearingId: hearing.id,
    complaint: updatedComplaint,
  });
});

router.get('/complaints/:id/hearings', async (req, res) => {
  const { data: hearings } = await supabase
    .from('hearings')
    .select('*')
    .eq('complaint_id', req.params.id)
    .order('created_at', { ascending: false });

  res.json({ hearings: hearings || [] });
});

router.put('/complaints/:complaintId/hearings/:hearingId', async (req, res) => {
  const { status, notes, result, userId, userRole, scheduledDate, scheduledTime, location, assignedMembers } = req.body || {};

  const { data: hearing } = await supabase
    .from('hearings')
    .select('*')
    .eq('id', req.params.hearingId)
    .eq('complaint_id', req.params.complaintId)
    .single();

  if (!hearing) {
    return res.status(404).json({ message: 'Hearing not found.' });
  }

  const updatePayload = {
    updated_at: new Date().toISOString(),
  };
  if (status) updatePayload.status = status;
  if (notes !== undefined) updatePayload.notes = notes;
  if (scheduledDate) updatePayload.scheduled_date = scheduledDate;
  if (scheduledTime) updatePayload.scheduled_time = scheduledTime;
  if (location !== undefined) updatePayload.location = location;
  if (assignedMembers !== undefined) {
    updatePayload.assigned_members = Array.isArray(assignedMembers) ? JSON.stringify(assignedMembers) : assignedMembers;
  }
  if (result) updatePayload.result = result;

  const { error: hearingUpdateError } = await supabase.from('hearings').update(updatePayload).eq('id', req.params.hearingId);

  if (hearingUpdateError) {
    console.error('Failed to update hearing:', hearingUpdateError.message);
    return res.status(500).json({ message: 'Failed to update hearing.' });
  }

  const { data: complaint, error: complaintError } = await supabase
    .from('complaints')
    .select('id, title, citizen_id')
    .eq('id', req.params.complaintId)
    .single();

  if (complaintError || !complaint) {
    return res.status(404).json({ message: 'Complaint not found.' });
  }

  let updatedComplaint = null;
  if (result) {
    const { data, error: resolveError } = await supabase.from('complaints').update({
      resolution: result,
      status: 'RESOLVED',
      updated_at: new Date().toISOString(),
    }).eq('id', req.params.complaintId).select('id, status, resolution, updated_at').single();

    if (resolveError || !data) {
      console.error('Failed to resolve complaint:', resolveError?.message || 'No complaint was updated.');
      return res.status(500).json({ message: 'Failed to resolve complaint.' });
    }
    updatedComplaint = data;

    if (complaint.citizen_id) {
      const resolvedMessage = `Your complaint "${complaint.title || 'Complaint'}" has been resolved. ${result}`;
      try {
        await notifyCitizen(supabase, complaint.citizen_id, {
          title: 'Complaint Resolved',
          message: resolvedMessage,
          sms: `Barangay Saray: ${resolvedMessage}`,
        });
      } catch (notifyError) {
        console.warn('Failed to send resolution notification:', notifyError?.message);
      }
    }
  } else if (status && status !== 'COMPLETED') {
    // update complaint status mapping for cancelled/completed hearing? keep complaint as is
  }

  if (status === 'COMPLETED') {
    // mark complaint resolved only if result provided (already handled)
  }

  await supabase.from('system_logs').insert({
    user_id: userId,
    action: 'HEARING_UPDATED',
    target_record: `hearing_${req.params.hearingId}`,
    details: { status, result, scheduledDate, scheduledTime, location },
  });

  res.json({
    message: 'Hearing updated successfully.',
    ...(updatedComplaint ? { complaint: updatedComplaint } : {}),
  });
});

router.post('/complaints/:id/remarks', async (req, res) => {
  const { userId, userRole, remarkText, actionType } = req.body || {};

  if (!userId || !remarkText) {
    return res.status(400).json({ message: 'User and remark text are required.' });
  }

  await supabase.from('remarks').insert({
    complaint_id: Number(req.params.id),
    user_id: userId,
    user_role: userRole || 'LUPON',
    remark_text: remarkText,
    action_type: actionType || 'UPDATE',
  });

  res.status(201).json({ message: 'Remark added successfully.' });
});

router.get('/complaints/:id/remarks', async (req, res) => {
  const { data: remarks } = await supabase
    .from('remarks')
    .select('*, user:users(full_name)')
    .eq('complaint_id', req.params.id)
    .order('created_at', { ascending: false });

  const mapped = (remarks || []).map((r) => ({
    ...r,
    user_name: r.user?.full_name || null,
  }));

  res.json({ remarks: mapped });
});

router.get('/notifications/:userId', async (req, res) => {
  const { data: notifications } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', req.params.userId)
    .order('created_at', { ascending: false })
    .limit(50);

  res.json({ notifications: notifications || [] });
});

// GET /lupon/notifications/by-auth/:authId — resolves the integer staff id
// server-side (browser sessions only carry the auth UUID).
router.get('/notifications/by-auth/:authId', async (req, res) => {
  const staffId = await resolveStaffId(req.params.authId);
  if (!staffId) {
    return res.json({ notifications: [] });
  }
  const { data: notifications } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', staffId)
    .order('created_at', { ascending: false })
    .limit(50);

  res.json({ notifications: notifications || [] });
});

router.put('/notifications/:id/read', async (req, res) => {
  await supabase.from('notifications').update({ is_read: true }).eq('id', req.params.id);
  res.json({ message: 'Notification marked as read.' });
});

router.put('/notifications/read-all', async (req, res) => {
  const { userId } = req.body || {};
  if (!userId) {
    return res.status(400).json({ message: 'userId is required.' });
  }
  await supabase.from('notifications').update({ is_read: true }).eq('user_id', userId);
  res.json({ message: 'All notifications marked as read.' });
});

export default router;
