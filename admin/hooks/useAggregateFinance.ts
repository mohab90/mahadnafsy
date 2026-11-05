import { useMemo } from 'react';
import { useSiteData } from '../context/SiteDataContext';
import { ROLE_DATA_SCOPE } from '../constants/permissions';

/**
 * May this account read the books of the company or of a branch — the P&L, the cockpit, the boxes, the chart of accounts, the receipt gaps — rather than only
 * the money of the clients it is responsible for?
 *
 * The server answers those routes only for a data scope of `all` or `branch:…` (api/lib/financialScope.js resolveFinancialScope: an account that sees its own
 * clients gets «Aggregate financial reports are not available for this data scope», a 403). The collection desk holds view_financial and opens the accounts
 * screens, which asked for all five anyway: 403 on every screen (5 Nov 2026). The scope is the staff row's own, else the role's default — the server's rule.
 */
export function useFinancialScope(): 'all' | 'branch' | 'own' | 'none' {
  const { isAdmin, currentStaff } = useSiteData();
  return useMemo(() => {
    if (isAdmin) return 'all';
    const role = String(currentStaff?.role || '').toLowerCase() as keyof typeof ROLE_DATA_SCOPE;
    const scope = String(currentStaff?.dataScope || ROLE_DATA_SCOPE[role] || 'none');
    if (scope === 'all') return 'all';
    if (scope.startsWith('branch:')) return 'branch';
    return scope === 'none' ? 'none' : 'own';
  }, [isAdmin, currentStaff?.role, currentStaff?.dataScope]);
}

/** The books of the company or of a branch (not only the money of the account's own clients). */
export function useAggregateFinance(): boolean {
  const scope = useFinancialScope();
  return scope === 'all' || scope === 'branch';
}
