export function formatComplaintSource(source) {
  const normalized = String(source || 'online')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');

  if (
    normalized === 'walkin' ||
    normalized === 'barangay-hall' ||
    normalized.startsWith('walk-in')
  ) {
    return 'Walk-in (Barangay Hall)';
  }

  return 'Online Form';
}