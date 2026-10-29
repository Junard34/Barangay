import express from 'express';
import { db } from '../database.js';
import { triageComplaint } from '../../src/lib/triageService.js';

const router = express.Router();

router.get('/', async (_req, res) => {
  const complaints = await db.all(`
    SELECT c.*, cat.name AS category_name, ch.name AS channel_name, u.full_name AS citizen_name
    FROM complaints c
    LEFT JOIN complaint_categories cat ON cat.id = c.category_id
    LEFT JOIN channels ch ON ch.id = c.channel_id
    LEFT JOIN users u ON u.id = c.citizen_id
    ORDER BY c.created_at DESC
  `);

  res.json({ complaints });
});

router.get('/:id', async (req, res) => {
  const complaint = await db.get(`
    SELECT c.*, cat.name AS category_name, ch.name AS channel_name, u.full_name AS citizen_name
    FROM complaints c
    LEFT JOIN complaint_categories cat ON cat.id = c.category_id
    LEFT JOIN channels ch ON ch.id = c.channel_id
    LEFT JOIN users u ON u.id = c.citizen_id
    WHERE c.id = ?
  `, [req.params.id]);

  if (!complaint) {
    return res.status(404).json({ message: 'Complaint not found.' });
  }

  return res.json({ complaint });
});

router.post('/', async (req, res) => {
  const { citizenId, title, description, location, address, categoryName, priority } = req.body || {};

  if (!citizenId || !description) {
    return res.status(400).json({ message: 'Citizen and description are required.' });
  }

  const incidentLocation = (location || address || '').trim() || null;
  const triage = triageComplaint(description, incidentLocation || '');
  const channelRow = await db.get(`SELECT id FROM channels WHERE name = ?`, [triage.channel]);
  const categoryRow = await db.get(`SELECT id FROM complaint_categories WHERE name = ?`, [categoryName || triage.category]);

  const complaintId = `CMP-${Date.now()}`;

  const result = await db.run(
    `INSERT INTO complaints (citizen_id, complaint_id, title, description, location, category_id, priority, status, channel_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, datetime('now'), datetime('now'))`,
    [citizenId, complaintId, title || triage.channel, description, incidentLocation, categoryRow?.id || null, priority || triage.priority, channelRow?.id || null]
  );

  const complaint = await db.get(`SELECT * FROM complaints WHERE id = ?`, [result.lastID]);

  await db.run(
    `INSERT INTO triage_results (complaint_id, category_id, suggested_priority, confidence, language, model_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'Naive Bayes', datetime('now'), datetime('now'))`,
    [complaint.id, categoryRow?.id || null, triage.priority, triage.confidence, triage.language || null]
  );

  // Instant assignment: the AI channel's pre-assigned handler (fixed SQL lookup).
  // Failures are recorded in system_logs so an unassigned case is explainable.
  let assigned = null;
  let assignmentFailure = null;
  if (!channelRow?.id) {
    assignmentFailure = `AI channel "${triage.channel}" did not match a channels row; left SUBMITTED; assignment is automatic at submit, see failure log.`;
  } else {
    try {
      const { pickFixedHandlerSQLite } = await import('../lib/assignment.js');
      assigned = await pickFixedHandlerSQLite(db, channelRow.id, triage.channel);
      if (!assigned) {
        assignmentFailure = `No handler found in "${triage.channel}" team (empty team and empty fallback); left SUBMITTED; assignment is automatic at submit, see failure log.`;
      }
    } catch (assignError) {
      assignmentFailure = `Instant assignment threw (${assignError.message}); left SUBMITTED; assignment is automatic at submit, see failure log.`;
    }
  }

  if (assigned) {
    try {
      await db.run(
        `UPDATE complaints SET assigned_to = ?, status = 'ASSIGNED', updated_at = datetime('now') WHERE id = ?`,
        [assigned.user_id, complaint.id]
      );
      complaint.assigned_to = assigned.user_id;
      complaint.status = 'ASSIGNED';
      try {
        await db.run(
          `INSERT INTO notifications (user_id, title, message, is_read, created_at)
           VALUES (?, ?, ?, 0, datetime('now'))`,
          [assigned.user_id, 'New Complaint Assigned', `You have been assigned a "${triage.channel}" complaint: "${title || triage.channel}".`]
        );
        const teammates = await db.all(
          `SELECT DISTINCT user_id FROM channel_members WHERE channel_id = ? AND user_id != ?`,
          [channelRow.id, assigned.user_id]
        );
        for (const t of teammates || []) {
          await db.run(
            `INSERT INTO notifications (user_id, title, message, is_read, created_at)
             VALUES (?, ?, ?, 0, datetime('now'))`,
            [t.user_id, `New ${triage.channel} Case`, `"${title || triage.channel}" arrived in your channel and was assigned to ${assigned.full_name || 'a teammate'}.`]
          );
        }
      } catch {
        // notifications are best-effort
      }
    } catch (assignError) {
      assignmentFailure = `Instant assignment threw (${assignError.message}); left SUBMITTED; assignment is automatic at submit, see failure log.`;
      assigned = null;
    }
  }

  if (!assigned && assignmentFailure) {
    console.warn(`Complaint ${complaint.id}: ${assignmentFailure}`);
    try {
      await db.run(
        `INSERT INTO system_logs (user_id, action, target_record, details, created_at)
         VALUES (NULL, 'COMPLAINT_ASSIGNMENT_FAILED', ?, ?, datetime('now'))`,
        [`complaint_${complaint.id}`, JSON.stringify({ reason: assignmentFailure, channel_name: triage.channel })]
      );
    } catch {
      // logging is best-effort
    }
  }

  res.status(201).json({
    message: assigned
      ? `Complaint submitted, routed to ${triage.channel} and assigned to ${assigned.full_name || 'a staff member'}.`
      : `Complaint submitted and auto-routed to ${triage.channel}.`,
    complaint,
    triage,
    assignedTo: assigned?.user_id || null,
  });
});

router.delete('/:id', async (req, res) => {
  const complaint = await db.get(`SELECT id FROM complaints WHERE id = ?`, [req.params.id]);

  if (!complaint) {
    return res.status(404).json({ message: 'Complaint not found.' });
  }

  await db.run(`DELETE FROM triage_results WHERE complaint_id = ?`, [req.params.id]);
  await db.run(`DELETE FROM remarks WHERE complaint_id = ?`, [req.params.id]);
  await db.run(`DELETE FROM hearings WHERE complaint_id = ?`, [req.params.id]);
  await db.run(`DELETE FROM system_logs WHERE target_record = ?`, [`complaint_${req.params.id}`]);
  await db.run(`DELETE FROM complaints WHERE id = ?`, [req.params.id]);

  return res.json({ message: 'Complaint deleted successfully.' });
});

router.put('/:id/status', async (req, res) => {
  const { status } = req.body || {};
  const complaint = await db.get(`SELECT id FROM complaints WHERE id = ?`, [req.params.id]);

  if (!complaint) {
    return res.status(404).json({ message: 'Complaint not found.' });
  }

  await db.run(`UPDATE complaints SET status = ?, updated_at = datetime('now') WHERE id = ?`, [status, req.params.id]);
  return res.json({ message: 'Complaint status updated.' });
});

router.post('/:id/remarks', async (req, res) => {
  const { userId, userRole, remarkText, actionType } = req.body || {};

  if (!userId || !remarkText) {
    return res.status(400).json({ message: 'User and remark text are required.' });
  }

  await db.run(
    `INSERT INTO remarks (complaint_id, user_id, user_role, remark_text, action_type, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [req.params.id, userId, userRole || 'OFFICIAL', remarkText, actionType || 'UPDATE']
  );

  res.status(201).json({ message: 'Remark added successfully.' });
});

router.get('/:id/remarks', async (req, res) => {
  const remarks = await db.all(
    `SELECT r.*, u.full_name AS user_name FROM remarks r
     LEFT JOIN users u ON u.id = r.user_id
     WHERE r.complaint_id = ?
     ORDER BY r.created_at DESC`,
    [req.params.id]
  );

  res.json({ remarks });
});

router.put('/:id/assign', async (req, res) => {
  const { assignedTo, userId, userRole } = req.body || {};
  const complaint = await db.get(`SELECT id FROM complaints WHERE id = ?`, [req.params.id]);

  if (!complaint) {
    return res.status(404).json({ message: 'Complaint not found.' });
  }

  await db.run(
    `UPDATE complaints SET assigned_to = ?, status = 'ASSIGNED', updated_at = datetime('now') WHERE id = ?`,
    [assignedTo, req.params.id]
  );

  await db.run(
    `INSERT INTO system_logs (user_id, action, target_record, details, created_at)
     VALUES (?, 'COMPLAINT_ASSIGNED', ?, ?, datetime('now'))`,
    [userId, `complaint_${req.params.id}`, JSON.stringify({ assigned_to: assignedTo, role: userRole })]
  );

  res.json({ message: 'Complaint assigned successfully.' });
});

router.put('/:id/priority', async (req, res) => {
  const { priority, userId, userRole, reason } = req.body || {};
  const complaint = await db.get(`SELECT priority FROM complaints WHERE id = ?`, [req.params.id]);

  if (!complaint) {
    return res.status(404).json({ message: 'Complaint not found.' });
  }

  await db.run(
    `UPDATE complaints SET priority = ?, updated_at = datetime('now') WHERE id = ?`,
    [priority, req.params.id]
  );

  await db.run(
    `INSERT INTO system_logs (user_id, action, target_record, details, created_at)
     VALUES (?, 'PRIORITY_CHANGED', ?, ?, datetime('now'))`,
    [userId, `complaint_${req.params.id}`, JSON.stringify({ old_priority: complaint.priority, new_priority: priority, reason })]
  );

  res.json({ message: 'Priority updated successfully.' });
});

router.post('/:id/hearings', async (req, res) => {
  const { scheduledDate, scheduledTime, location, notes, userId, userRole } = req.body || {};

  if (!scheduledDate || !scheduledTime) {
    return res.status(400).json({ message: 'Date and time are required.' });
  }

  const result = await db.run(
    `INSERT INTO hearings (complaint_id, scheduled_date, scheduled_time, location, notes, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'SCHEDULED', datetime('now'), datetime('now'))`,
    [req.params.id, scheduledDate, scheduledTime, location || '', notes || '']
  );

  await db.run(
    `UPDATE complaints SET status = 'FOR HEARING / MEDIATION', updated_at = datetime('now') WHERE id = ?`,
    [req.params.id]
  );

  await db.run(
    `INSERT INTO system_logs (user_id, action, target_record, details, created_at)
     VALUES (?, 'HEARING_CREATED', ?, ?, datetime('now'))`,
    [userId, `complaint_${req.params.id}`, JSON.stringify({ date: scheduledDate, time: scheduledTime, location })]
  );

  res.status(201).json({ message: 'Hearing scheduled successfully.', hearingId: result.lastID });
});

router.get('/:id/hearings', async (req, res) => {
  const hearings = await db.all(
    `SELECT * FROM hearings WHERE complaint_id = ? ORDER BY created_at DESC`,
    [req.params.id]
  );

  res.json({ hearings });
});

router.put('/:complaintId/hearings/:hearingId', async (req, res) => {
  const { status, notes, result, userId, userRole } = req.body || {};

  const hearing = await db.get(`SELECT * FROM hearings WHERE id = ? AND complaint_id = ?`, [req.params.hearingId, req.params.complaintId]);
  if (!hearing) {
    return res.status(404).json({ message: 'Hearing not found.' });
  }

  await db.run(
    `UPDATE hearings SET status = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
    [status, notes || hearing.notes, req.params.hearingId]
  );

  if (result) {
    await db.run(
      `UPDATE complaints SET resolution = ?, status = 'RESOLVED', updated_at = datetime('now') WHERE id = ?`,
      [result, req.params.complaintId]
    );
  }

  await db.run(
    `INSERT INTO system_logs (user_id, action, target_record, details, created_at)
     VALUES (?, 'HEARING_UPDATED', ?, ?, datetime('now'))`,
    [userId, `hearing_${req.params.hearingId}`, JSON.stringify({ status, result })]
  );

  res.json({ message: 'Hearing updated successfully.' });
});

export default router;

