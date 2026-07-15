export function normalizeBranchKey(value?: string | null) {
  return String(value || '').trim().toUpperCase().replace(/[-\s]+/g, '_');
}

export function branchSlugToFilter(slug?: string | null) {
  const normalized = normalizeBranchKey(slug);
  if (!normalized || normalized === 'ALL') return '';
  if (normalized === 'ONLINE_EGYPT' || normalized === 'ONLINE') return 'ONLINE_EGYPT';
  if (normalized === 'ONLINE_SAUDI' || normalized === 'SAUDI') return 'ONLINE_SAUDI';
  if (normalized === 'ONLINE_ABROAD' || normalized === 'ABROAD' || normalized === 'INTERNATIONAL') return 'ONLINE_ABROAD';
  if (normalized === 'DAQQI' || normalized === 'DOKKI' || normalized === 'DQI') return 'DAQQI';
  return normalized;
}

export function branchMatchesFilter(value?: string | null, filter?: string | null) {
  const wanted = branchSlugToFilter(filter);
  if (!wanted) return true;
  const branch = normalizeBranchKey(value);
  if (wanted === 'DAQQI') return branch === 'DAQQI' || branch === 'DOKKI' || branch === 'DQI';
  if (wanted === 'ONLINE_EGYPT') return branch === 'ONLINE_EGYPT' || branch === 'ONLINE';
  return branch === wanted;
}
