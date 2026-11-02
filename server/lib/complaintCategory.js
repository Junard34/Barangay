export async function updateComplaintCategorySupabase(supabase, complaintId, newCategoryName, updaterAuthId = null) {
  const { data: complaint, error: compErr } = await supabase
    .from('complaints')
    .select('*, category:complaint_categories(name), channel:channels(name)')
    .eq('id', complaintId)
    .single();

  if (compErr || !complaint) {
    throw new Error('Complaint not found.');
  }

  const { data: categoryRow } = await supabase
    .from('complaint_categories')
    .select('id, name')
    .eq('name', newCategoryName)
    .maybeSingle();

  const { data: channelRow } = await supabase
    .from('channels')
    .select('id, name')
    .eq('name', newCategoryName)
    .maybeSingle();

  const oldCategory = complaint.category?.name || complaint.channel?.name || 'Uncategorized';

  const updates = {
    updated_at: new Date().toISOString(),
  };
  if (categoryRow) updates.category_id = categoryRow.id;
  if (channelRow) updates.channel_id = channelRow.id;
  if (complaint.title === oldCategory || !complaint.title) {
    updates.title = newCategoryName;
  }

  const { data: updatedComplaint, error: updateErr } = await supabase
    .from('complaints')
    .update(updates)
    .eq('id', complaintId)
    .select('*, category:complaint_categories(name), channel:channels(name)')
    .single();

  if (updateErr) {
    throw new Error(updateErr.message);
  }

  let updaterUser = null;
  if (updaterAuthId) {
    const { data: u } = await supabase
      .from('users')
      .select('id, full_name, role')
      .eq('auth_id', updaterAuthId)
      .maybeSingle();
    if (u) updaterUser = u;
  }

  const updaterLabel = updaterUser ? `${updaterUser.full_name} (${updaterUser.role})` : 'Barangay Staff';
  try {
    await supabase.from('remarks').insert({
      complaint_id: Number(complaintId),
      user_id: updaterUser?.id || complaint.citizen_id,
      remark_text: `Category changed from "${oldCategory}" to "${newCategoryName}" by ${updaterLabel}.`,
    });
  } catch (remarkErr) {
    console.warn('Failed to insert category change remark:', remarkErr.message);
  }

  return {
    ...updatedComplaint,
    category_name: updatedComplaint.category?.name || newCategoryName,
    channel_name: updatedComplaint.channel?.name || newCategoryName,
  };
}

export async function updateComplaintCategorySQLite(db, complaintId, newCategoryName) {
  const complaint = await db.get(
    `SELECT c.*, cat.name as category_name
     FROM complaints c
     LEFT JOIN complaint_categories cat ON cat.id = c.category_id
     WHERE c.id = ?`,
    [complaintId]
  );
  if (!complaint) throw new Error('Complaint not found.');

  const catRow = await db.get(`SELECT id, name FROM complaint_categories WHERE name = ?`, [newCategoryName]);
  const chRow = await db.get(`SELECT id, name FROM channels WHERE name = ?`, [newCategoryName]);

  const oldCategory = complaint.category_name || complaint.title || 'Uncategorized';
  const newCatId = catRow?.id || complaint.category_id;
  const newChId = chRow?.id || complaint.channel_id;
  const newTitle = complaint.title === oldCategory ? newCategoryName : complaint.title;

  await db.run(
    `UPDATE complaints
     SET category_id = ?, channel_id = ?, title = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [newCatId, newChId, newTitle, complaintId]
  );

  return db.get(`
    SELECT c.*, cat.name AS category_name, ch.name AS channel_name, u.full_name AS citizen_name
    FROM complaints c
    LEFT JOIN complaint_categories cat ON cat.id = c.category_id
    LEFT JOIN channels ch ON ch.id = c.channel_id
    LEFT JOIN users u ON u.id = c.citizen_id
    WHERE c.id = ?
  `, [complaintId]);
}
