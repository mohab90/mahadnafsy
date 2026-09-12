import type { StaffMember } from '../../../types';

/**
 * The signed-in employee's role, as a set of named questions.
 *
 * This used to resolve `currentStaff` itself — search staffMembers by email,
 * and fall back to GET /api/staff/me. That resolution moved into
 * SiteDataContext, because eleven screens were doing the same search *without*
 * the fallback and getting nobody: the staff list needs view_staff, which ten
 * of the sixteen roles do not hold, so for them staffMembers is empty and every
 * permission check on those screens read false.
 *
 * What is left here is the naming. `staffSelfLoading` is gone with the fetch —
 * nothing read it.
 */
export function useCurrentStaff({ currentStaff }: { currentStaff: StaffMember | null }) {
  const role = (currentStaff?.role || '').toLowerCase();
  return {
    currentStaff,
    isSalesOnly: role === 'sales',
    isCollectionRole: role === 'collection',
    isReceptionDaqqi: role === 'reception_daqqi',
    isDaqqiManager: role === 'daqqi_manager',
    isOnlineManager: role === 'online_manager',
    isSalesCollectionManager: role === 'sales_collection_manager',
  };
}
