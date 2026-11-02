const PENDING_STATUSES = new Set(['PENDING', 'SUBMITTED', 'UNDER REVIEW', 'TRIAGED', 'ASSIGNED']);

export function normalizeComplaintStatus(status) {
  return String(status || 'SUBMITTED').trim().toUpperCase();
}

export function getComplaintStatusLabel(status) {
  const normalized = normalizeComplaintStatus(status);
  if (PENDING_STATUSES.has(normalized)) return 'Pending';
  return normalized
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function isPendingComplaintStatus(status) {
  return PENDING_STATUSES.has(normalizeComplaintStatus(status));
}

export function isResolvedComplaintStatus(status) {
  return ['RESOLVED', 'CLOSED'].includes(normalizeComplaintStatus(status));
}

export function getComplaintStatusBadgeClass(status) {
  const normalized = normalizeComplaintStatus(status);
  if (isResolvedComplaintStatus(normalized)) return 'bg-green-100 text-green-800';
  if (normalized === 'IN PROGRESS') return 'bg-orange-100 text-orange-800';
  if (normalized === 'FOR HEARING / MEDIATION') return 'bg-indigo-100 text-indigo-800';
  if (isPendingComplaintStatus(normalized)) return 'bg-yellow-100 text-yellow-800';
  return 'bg-slate-100 text-slate-800';
}
