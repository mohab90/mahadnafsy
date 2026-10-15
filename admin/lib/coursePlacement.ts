import type { SubscriberItem } from '../types';

// A client in two branches: a course placed in a branch other than the client's own
// (api/lib/coursePlacement.js). A branch's list holds the clients it owns AND the ones with a course
// placed in it, and shows each only the courses that are its own.

export type BranchTest = (branch: string | null | undefined) => boolean;

export const placementsOf = (client: Pick<SubscriberItem, 'coursePlacements'>): Record<string, string> => client.coursePlacements || {};
export const isSplit = (client: Pick<SubscriberItem, 'coursePlacements'>): boolean => Object.keys(placementsOf(client)).length > 0;

/** The branch a course is in: where it was placed, else the client's own. */
export const itemBranch = (client: Pick<SubscriberItem, 'branch' | 'coursePlacements'>, item: string): string | null | undefined =>
  placementsOf(client)[item] || client.branch;

/** Whether the client belongs to the branch the test describes — by their own branch or by a course placed there. */
export const holdsIn = (client: Pick<SubscriberItem, 'branch' | 'coursePlacements'>, test: BranchTest): boolean =>
  test(client.branch) || Object.values(placementsOf(client)).some(branch => test(branch));

/** Whether a course shows in the branch the test describes. A client who is not split shows every course. */
export const itemShowsIn = (client: Pick<SubscriberItem, 'branch' | 'coursePlacements'>, item: string, test: BranchTest): boolean =>
  !isSplit(client) || test(itemBranch(client, item));

export const PLACEMENT_BRANCHES: Array<[string, string]> = [
  ['ONLINE_EGYPT', '🌐 أونلاين — مصر'], ['ONLINE_SAUDI', '🇸🇦 أونلاين — السعودية'], ['ONLINE_ABROAD', '🌍 أونلاين — دولي'],
  ['DAQQI', '🏢 فرع الدقي'], ['TAGAMOA', '🏢 فرع التجمع'],
];
