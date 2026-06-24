import { useMemo } from 'react';
import { normBranchId } from './dashboardShared';

type BranchEntry = { id: string; label: string };

/**
 * Pure derived values for the dashboard shell: inbox unread count + the
 * institute branch list/label map parsed from admin settings. Extracted verbatim
 * from Dashboard.tsx — all three are pure useMemos (no side effects), so behaviour
 * is identical; only the location changed.
 */
export function useDashboardDerived(content: Record<string, string>, notifications: { isRead?: boolean }[]) {
  const inboxUnreadCount = useMemo(() =>
    notifications.filter(n => !n.isRead).length,
    [notifications]
  );

  const instituteBranches = useMemo(() => {
    try {
      const parsed = JSON.parse(content['institute.branches'] || '[]');
      return Array.isArray(parsed) ? parsed as BranchEntry[] : [];
    } catch { return [] as BranchEntry[]; }
  }, [content]);

  const branchLabelMap = useMemo((): Record<string, string> => {
    const base = Object.fromEntries(instituteBranches.flatMap(b => [
      [b.id, b.label],
      [normBranchId(b.id), b.label],
    ]));
    // Legacy / un-normalized values that may still appear in DB or old records
    return {
      ...base,
      'online-egypt':        base['ONLINE_EGYPT']  || 'أونلاين مصر',
      'online-saudi':        base['ONLINE_SAUDI']  || 'أونلاين السعودية',
      'online-abroad':       base['ONLINE_ABROAD'] || 'أونلاين خارج مصر',
      'online-26':           base['ONLINE_EGYPT']  || 'أونلاين مصر',
      'daqqi':               base['DAQQI']         || 'دقي',
      'tagamoa':             base['TAGAMOA']       || 'التجمع',
      'other':               'أخرى',
      'اون_لاين_داخل_مصر':  base['ONLINE_EGYPT']  || 'أونلاين مصر',
      'اونلاين_داخل_مصر':   base['ONLINE_EGYPT']  || 'أونلاين مصر',
    };
  }, [instituteBranches]);

  return { inboxUnreadCount, instituteBranches, branchLabelMap };
}
