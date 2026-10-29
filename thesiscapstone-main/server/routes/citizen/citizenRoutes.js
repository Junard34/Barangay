import express from 'express';
import supabase from '../../supabaseAdmin.js';
import { triageComplaint } from '../../../src/lib/triageService.js';
import { attachEvidence } from '../../lib/evidence.js';
import { notifyCitizen } from '../../lib/notifyCitizen.js';

const router = express.Router();

router.get('/channels', async (_req, res) => {
  const { data: channels } = await supabase.from('channels').select('id, name, description').order('name');
  res.json({ channels: channels || [] });
});

router.get('/categories', async (_req, res) => {
  const { data: categories } = await supabase.from('complaint_categories').select('id, name, description').order('name');
  res.json({ categories: categories || [] });
});

router.get('/complaints', async (req, res) => {
  const { authId } = req.query;

  let query = supabase
    .from('complaints')
    .select('*, category:complaint_categories(name), channel:channels(name), citizen:users!complaints_citizen_id_fkey(full_name), assignee:users!complaints_assigned_to_fkey(full_name)')
    .order('created_at', { ascending: false });

  if (authId) {
    const { data: user } = await supabase.from('users').select('id').eq('auth_id', authId).single();
    if (user) {
      query = query.eq('citizen_id', user.id);
    }
  }

  const { data: complaints } = await query;

  await attachEvidence(supabase, complaints || []);

  const mapped = (complaints || []).map((c) => ({
    ...c,
    category_name: c.category?.name || null,
    channel_name: c.channel?.name || null,
    citizen_name: c.citizen?.full_name || null,
    assigned_name: c.assignee?.full_name || null,
  }));

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

router.get('/complaints/:id/ratings', async (req, res) => {
  const { data: ratings } = await supabase
    .from('service_ratings')
    .select('*, user:users(full_name)')
    .eq('complaint_id', req.params.id)
    .order('created_at', { ascending: false });

  const mapped = (ratings || []).map((r) => ({
    ...r,
    user_name: r.user?.full_name || null,
  }));

  res.json({ ratings: mapped });
});

router.post('/complaints/:id/rate', async (req, res) => {
  const { userId, rating, feedback } = req.body || {};

  if (!userId || !rating) {
    return res.status(400).json({ message: 'userId and rating are required.' });
  }

  if (rating < 1 || rating > 5) {
    return res.status(400).json({ message: 'Rating must be between 1 and 5.' });
  }

  const { data: complaint } = await supabase.from('complaints').select('id').eq('id', req.params.id).single();
  if (!complaint) {
    return res.status(404).json({ message: 'Complaint not found.' });
  }

  const { data: existing } = await supabase
    .from('service_ratings')
    .select('id')
    .eq('complaint_id', req.params.id)
    .eq('user_id', userId)
    .single();

  if (existing) {
    await supabase.from('service_ratings').update({ rating, feedback: feedback || '', created_at: new Date().toISOString() }).eq('id', existing.id);
    res.json({ message: 'Rating updated successfully.' });
  } else {
    await supabase.from('service_ratings').insert({ complaint_id: Number(req.params.id), user_id: userId, rating, feedback: feedback || '' });
    res.status(201).json({ message: 'Rating submitted successfully.' });
  }
});

router.post('/complaints', async (req, res) => {
  const { citizenId, authId, title, description, location, address, categoryName, priority } = req.body || {};

  if (!description) {
    return res.status(400).json({ message: 'Description is required.' });
  }

  let resolvedCitizenId = citizenId;

  if (authId && !citizenId) {
    const { data: user } = await supabase.from('users').select('id').eq('auth_id', authId).single();
    if (user) {
      resolvedCitizenId = user.id;
    }
  }

  if (!resolvedCitizenId) {
    return res.status(400).json({ message: 'Citizen is required.' });
  }

  const incidentLocation = (location || address || '').trim();

  // Citizen's pick is kept as the title/category label; AI is authoritative
  // for channel_id/priority routing so it cannot be tampered with.
  const triage = triageComplaint(description, incidentLocation);
  const { data: channelRow } = await supabase.from('channels').select('id').eq('name', triage.channel).single();
  const { data: categoryRow } = await supabase.from('complaint_categories').select('id').eq('name', categoryName || triage.category).single();

  const complaintId = `CMP-${Date.now()}`;

  const { data: complaintData, error } = await supabase
    .from('complaints')
    .insert({
      citizen_id: resolvedCitizenId,
      complaint_id: complaintId,
      title: title || triage.channel,
      description,
      location: incidentLocation || null,
      category_id: categoryRow?.id || null,
      priority: priority || triage.priority,
      status: 'SUBMITTED',
      channel_id: channelRow?.id || null,
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ message: 'Failed to create complaint.', error: error.message });
  }

  let complaint = complaintData;

  await supabase.from('triage_results').insert({
    complaint_id: complaint.id,
    category_id: categoryRow?.id || null,
    suggested_priority: triage.priority,
    confidence: triage.confidence,
    language: triage.language || null,
    model_type: 'Naive Bayes',
  });

  // Instant assignment: the AI channel's pre-assigned handler (fixed SQL lookup).
  // The Assigned Member column is therefore filled the moment the complaint lands.
  // Failures are recorded in system_logs (COMPLAINT_ASSIGNMENT_FAILED) so an
  // unassigned case is always explainable from View System Logs.
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
    try {
        await supabase.from('complaints').update({
          assigned_to: assigned.user_id,
          status: 'ASSIGNED',
          updated_at: new Date().toISOString(),
        }).eq('id', complaint.id);
        complaint = { ...complaint, assigned_to: assigned.user_id, status: 'ASSIGNED' };
        await supabase.from('system_logs').insert({
          user_id: null,
          action: 'COMPLAINT_ASSIGNED',
          target_record: `complaint_${complaint.id}`,
          details: {
            assigned_to: assigned.user_id,
            assigned_name: assigned.full_name,
            assigned_role: assigned.role,
            channel_id: channelRow.id,
            channel_name: triage.channel,
            auto: true,
            at_submit: true,
          },
        });
        try {
          await supabase.from('notifications').insert({
            user_id: assigned.user_id,
            title: 'New Complaint Assigned',
            message: `You have been assigned a "${triage.channel}" complaint: "${title || triage.channel}".`,
            is_read: false,
          });
          // Notify the rest of the channel team so every assigned member
          // sees the new case (handler owns it; teammates see it in team view).
          try {
            const { data: teammates } = await supabase
              .from('channel_members')
              .select('user_id')
              .eq('channel_id', channelRow.id)
              .neq('user_id', assigned.user_id);
            const teammateIds = [...new Set((teammates || []).map((t) => t.user_id))];
            if (teammateIds.length > 0) {
              await supabase.from('notifications').insert(
                teammateIds.map((uid) => ({
                  user_id: uid,
                  title: `New ${triage.channel} Case`,
                  message: `"${title || triage.channel}" arrived in your channel and was assigned to ${assigned.full_name || 'a teammate'}.`,
                  is_read: false,
                }))
              );
            }
          } catch {
            // team notification is best-effort
          }
        } catch {
          // notification is best-effort
        }
    } catch (assignError) {
      assignmentFailure = `Instant assignment threw (${assignError.message}); left SUBMITTED; assignment is automatic at submit, see failure log.`;
      assigned = null;
    }
  }

  if (!assigned && assignmentFailure) {
    console.warn(`Complaint ${complaint.id}: ${assignmentFailure}`);
    try {
      await supabase.from('system_logs').insert({
        user_id: null,
        action: 'COMPLAINT_ASSIGNMENT_FAILED',
        target_record: `complaint_${complaint.id}`,
        details: { reason: assignmentFailure, channel_name: triage.channel },
      });
    } catch {
      // logging is best-effort
    }
  }

  const { data: admins } = await supabase
    .from('users')
    .select('id, role, role_id')
    .eq('status', 'ACTIVE');

  const adminUsers = (admins || []).filter((u) => String(u.role || '').toUpperCase() === 'ADMIN');
  if ((admins || []).length > 0 && adminUsers.length === 0) {
    // Role stored only via role_id on some projects: resolve names for the candidates.
    const { data: roleRows } = await supabase.from('roles').select('id, name');
    const adminRoleIds = new Set(
      (roleRows || []).filter((r) => String(r.name).toUpperCase() === 'ADMIN').map((r) => r.id)
    );
    for (const u of admins) {
      if (u.role_id && adminRoleIds.has(u.role_id)) adminUsers.push(u);
    }
  }
  for (const admin of adminUsers) {
    await supabase.from('notifications').insert({
      user_id: admin.id,
      title: `New Complaint: ${title || triage.channel}`,
      message: `AI routed to ${triage.channel} (${triage.priority}).${triage.needsReview ? ' Low confidence — please review.' : ''}`,
      is_read: false,
    });
  }

  const citizenTitle = assigned ? 'Complaint Received & Assigned' : 'Complaint Received';
  const citizenMessage = assigned
    ? `Your complaint "${title || triage.channel}" was received and assigned to ${assigned.full_name || 'a staff member'} (${triage.channel}). Ref: ${complaintId}.`
    : `Your complaint "${title || triage.channel}" was received and routed to ${triage.channel}. It is pending assignment. Ref: ${complaintId}.`;
  await notifyCitizen(supabase, resolvedCitizenId, {
    title: citizenTitle,
    message: citizenMessage,
    sms: `Barangay Saray: ${citizenMessage}`,
  });

  res.status(201).json({
    message: assigned
      ? `Complaint submitted, routed to ${triage.channel} and assigned to ${assigned.full_name || 'a staff member'} (${assigned.role || ''}).`
      : `Complaint submitted and auto-routed to ${triage.channel}.`,
    complaint,
    triage,
    assignedTo: assigned?.user_id || null,
    assignedName: assigned?.full_name || null,
  });
});

const EVIDENCE_ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
];
const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;

router.post('/complaints/:id/evidence', async (req, res) => {
  const { authId, file } = req.body || {};
  const complaintKey = req.params.id;

  if (!authId) {
    return res.status(400).json({ message: 'Citizen is required.' });
  }
  if (!file?.name || !file?.type || !file?.content) {
    return res.status(400).json({ message: 'File name, type, and content are required.' });
  }
  if (typeof file.name !== 'string' || typeof file.type !== 'string' || typeof file.content !== 'string') {
    return res.status(400).json({ message: 'Invalid attachment.' });
  }
  if (!EVIDENCE_ALLOWED_TYPES.includes(file.type)) {
    return res.status(400).json({ message: 'Attachments must be JPG, PNG, WebP, MP4, WebM, or MOV files.' });
  }

  let fileBuffer;
  try {
    fileBuffer = Buffer.from(file.content, 'base64');
  } catch {
    return res.status(400).json({ message: 'Invalid attachment content.' });
  }
  if (!fileBuffer.length || fileBuffer.length > EVIDENCE_MAX_BYTES) {
    return res.status(400).json({ message: 'Attachments must be 10 MB or smaller.' });
  }

  const { data: user } = await supabase.from('users').select('id').eq('auth_id', authId).single();
  if (!user) {
    return res.status(404).json({ message: 'Citizen not found.' });
  }

  const { data: complaint } = await supabase
    .from('complaints')
    .select('id, citizen_id')
    .eq('id', complaintKey)
    .single();
  if (!complaint) {
    return res.status(404).json({ message: 'Complaint not found.' });
  }
  if (complaint.citizen_id !== user.id) {
    return res.status(403).json({ message: 'You can only attach files to your own complaint.' });
  }

  const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = `${complaint.id}/${Date.now()}-${safeFileName}`;

  const { error: uploadError } = await supabase.storage
    .from('citizen-documents')
    .upload(filePath, fileBuffer, { contentType: file.type, upsert: false });

  if (uploadError) {
    return res.status(500).json({ message: `Could not store attachment: ${uploadError.message}` });
  }

  const { data: urlData } = supabase.storage.from('citizen-documents').getPublicUrl(filePath);

  const { data: evidenceRow, error: insertError } = await supabase
    .from('evidence_files')
    .insert({
      complaint_id: complaint.id,
      uploaded_by: user.id,
      file_name: file.name,
      file_url: urlData?.publicUrl || '',
      file_type: file.type,
      file_size: fileBuffer.length,
    })
    .select()
    .single();

  if (insertError) {
    await supabase.storage.from('citizen-documents').remove([filePath]);
    return res.status(500).json({ message: 'Failed to save attachment.', error: insertError.message });
  }

  res.status(201).json({ message: 'Attachment uploaded.', evidence: evidenceRow });
});

router.delete('/complaints/:id', async (req, res) => {
  const { data: complaint } = await supabase.from('complaints').select('id').eq('id', req.params.id).single();
  if (!complaint) {
    return res.status(404).json({ message: 'Complaint not found.' });
  }

  await supabase.from('triage_results').delete().eq('complaint_id', req.params.id);
  await supabase.from('service_ratings').delete().eq('complaint_id', req.params.id);
  await supabase.from('remarks').delete().eq('complaint_id', req.params.id);
  await supabase.from('hearings').delete().eq('complaint_id', req.params.id);
  await supabase.from('system_logs').delete().eq('target_record', `complaint_${req.params.id}`);
  await supabase.from('complaints').delete().eq('id', req.params.id);

  return res.json({ message: 'Complaint deleted successfully.' });
});

router.get('/hearings/:complaintId', async (req, res) => {
  const { data: hearings } = await supabase
    .from('hearings')
    .select('*')
    .eq('complaint_id', req.params.complaintId)
    .order('created_at', { ascending: false });

  res.json({ hearings: hearings || [] });
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

