/**
 * Canonical branch enum for the client app — mirrors api/constants/branches.js
 * (the backend source of truth). Keep in sync with admin/constants/branches.ts.
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

export function normalizeBranch(v?: string | null): BranchKey | null {
  if (!v) return null;
  const key = String(v).trim().toUpperCase().replace(/[-\s]+/g, '_');
  const mapped = key === 'DQI' ? 'DAQQI' : key;
  return (BRANCHES as readonly string[]).includes(mapped) ? (mapped as BranchKey) : null;
}
