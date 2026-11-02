export const COMPLAINT_STATUSES = [
  'PENDING',
  'SUBMITTED',
  'UNDER REVIEW',
  'TRIAGED',
  'ASSIGNED',
  'IN PROGRESS',
  'FOR HEARING / MEDIATION',
  'RESOLVED',
  'CLOSED',
];

export function normalizeComplaintStatus(status) {
  return typeof status === 'string' ? status.trim().toUpperCase() : '';
}

export function isValidComplaintStatus(status) {
  return COMPLAINT_STATUSES.includes(normalizeComplaintStatus(status));
}
