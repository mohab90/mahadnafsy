import { useMemo } from 'react';
import { normBranchId } from './dashboardShared';

type BranchEntry = { id: string; label: string };

/**
 * Pure derived values for the dashboard shell: inbox unread count plus the
 * institute branch list/label map parsed from admin settings.
 */
export function useDashboardDerived(
  content: Record<string, string>,
  notifications: { isRead?: boolean }[],
  branchesFromTable: BranchEntry[] = [],
) {
  const inboxUnreadCount = useMemo(() =>
    notifications.filter(n => !n.isRead).length,
    [notifications]
  );

  // The branches table first, the content string only as a fallback.
  //
  // This parsed content['institute.branches'] alone, and that key does not
  // exist on the live tenant — so instituteBranches was empty, and the branch
  // dropdown in the booking dialog offered nothing but its placeholder while
  // the branches table held seven. The field is drawn as required, in red,
  // with nothing in it to choose: a lead whose branch is missing could not be
  // given one, and 61 leads have no branch.
  //
  // hooks/useBranches.ts already reads the table and says in its own comment
  // that this content fallback "is why the branch dropdown was empty in some
  // places and differed in others". The dashboard never adopted it. Callers
  // pass it in rather than this hook fetching, so the hook stays pure.
  const instituteBranches = useMemo(() => {
    if (branchesFromTable.length) return branchesFromTable;
    try {
      const parsed = JSON.parse(content['institute.branches'] || '[]');
      return Array.isArray(parsed) ? parsed as BranchEntry[] : [];
    } catch { return [] as BranchEntry[]; }
  }, [content, branchesFromTable]);

  const branchLabelMap = useMemo((): Record<string, string> => {
    const base = Object.fromEntries(instituteBranches.flatMap(b => [
      [b.id, b.label],
      [normBranchId(b.id), b.label],
    ]));

    return {
      ...base,
      'online-egypt': base['ONLINE_EGYPT'] || 'أونلاين مصر',
      'online-saudi': base['ONLINE_SAUDI'] || 'أونلاين السعودية',
      'online-abroad': base['ONLINE_ABROAD'] || 'أونلاين خارج مصر',
      'online-26': base['ONLINE_EGYPT'] || 'أونلاين مصر',
      daqqi: base['DAQQI'] || 'دقي',
      tagamoa: base['TAGAMOA'] || 'التجمع',
      other: 'أخرى',
      'اون_لاين_داخل_مصر': base['ONLINE_EGYPT'] || 'أونلاين مصر',
      'اونلاين_داخل_مصر': base['ONLINE_EGYPT'] || 'أونلاين مصر',
    };
  }, [instituteBranches]);

  return { inboxUnreadCount, instituteBranches, branchLabelMap };
}
