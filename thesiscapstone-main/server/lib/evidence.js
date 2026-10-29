// Loads evidence_files rows for one or more complaints without relying on a
// PostgREST embed (the live evidence_files schema may not carry a foreign key
// to complaints yet — see database/evidence_files_fix.sql). Any failure leaves
// the complaints untouched, so a missing/mismatched evidence table can never
// break the complaint lists themselves.
export async function attachEvidence(supabase, complaints) {
  if (!Array.isArray(complaints) || complaints.length === 0) {
    return complaints || [];
  }

  const ids = complaints
    .map((c) => c?.id)
    .filter((id) => id !== null && id !== undefined);

  if (ids.length === 0) {
    return complaints;
  }

  try {
    const { data, error } = await supabase.from('evidence_files').select('*').in('complaint_id', ids);
    if (error || !Array.isArray(data)) {
      return complaints;
    }

    const byComplaint = new Map();
    for (const row of data) {
      const list = byComplaint.get(row.complaint_id) || [];
      list.push(row);
      byComplaint.set(row.complaint_id, list);
    }
    for (const complaint of complaints) {
      complaint.evidence = byComplaint.get(complaint.id) || [];
    }
  } catch {
    // evidence table unavailable — attachments simply stay hidden
  }

  return complaints;
}
