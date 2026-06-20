/**
 * Canonical branch enum for the admin app — mirrors api/constants/branches.js
 * (the backend source of truth). Use these instead of hand-typed strings so the
 * frontend and backend never drift (Top20 #11).
 */
export const BRANCHES = [
  'DAQQI',
  'TAGAMOA',
  'ONLINE_EGYPT',
  'ONLINE_SAUDI',
  'ONLINE_ABROAD',
  'OTHER',
] as const;

export type BranchKey = (typeof BRANCHES)[number];

export const BRANCH_FILTERS = ['ALL', ...BRANCHES] as const;

export const BRANCH_LABELS_AR: Record<BranchKey, string> = {
  DAQQI: 'فرع الدقي',
  TAGAMOA: 'فرع التجمع',
  ONLINE_EGYPT: 'أونلاين محلي (مصر)',
  ONLINE_SAUDI: 'أونلاين سعودي',
  ONLINE_ABROAD: 'أونلاين دولي',
  OTHER: 'أخرى',
};

export function normalizeBranch(v?: string | null): BranchKey | null {
  if (!v) return null;
  const key = String(v).trim().toUpperCase().replace(/[-\s]+/g, '_');
  const mapped = key === 'DQI' ? 'DAQQI' : key;
  return (BRANCHES as readonly string[]).includes(mapped) ? (mapped as BranchKey) : null;
}

export const isBranch = (v?: string | null): v is BranchKey =>
  normalizeBranch(v) !== null;
