import { useEffect, useState } from 'react';
import { cairoMonthOnly } from '../../../../shared/cairoDate';
import type { LeadItem, SalesTarget } from '../../../types';
import type { PaymentDraft } from '../../../components/PaymentModal';
import { createClientPaymentDraft } from '../../../lib/clientActionDrafts';
import { mysqlAdmin } from '../../../lib/mysqlapi';

// canReadTargets: GET /api/admin/sales-targets needs view_leads, which support,
// HR, the accountant and the instructors do not hold — the dashboard asked for it
// on every load anyway (30 refusals on 7 Oct).
export function useLeadCrmTabState(canReadTargets = true) {
  const [salesNotifOpen, setSalesNotifOpen] = useState(false);
  const [onlineMgrFollowupOpen, setOnlineMgrFollowupOpen] = useState(false);
  const [onlineMgrNewEventsOpen, setOnlineMgrNewEventsOpen] = useState(false);
  const [quickBookOpen, setQuickBookOpen] = useState(false);
  const [quickBookSearch, setQuickBookSearch] = useState('');
  const [leadPayRow, setLeadPayRow] = useState<LeadItem | null>(null);
  const [leadPayDraft, setLeadPayDraft] = useState<PaymentDraft>(createClientPaymentDraft());
  const [leadsSalesTargets, setLeadsSalesTargets] = useState<SalesTarget[]>([]);

  useEffect(() => {
    if (!canReadTargets) return;
    const period = cairoMonthOnly();
    void mysqlAdmin.listSalesTargets(period)
      .then(rows => setLeadsSalesTargets(rows.map(row => ({
        staffId: String(row.staffId || ''),
        month: String(row.period || period),
        targetEGP: Number(row.revenueTarget) || 0,
      })).filter(row => row.staffId && row.staffId !== '__collection__')))
      .catch(() => setLeadsSalesTargets([]));
  }, [canReadTargets]);

  return {
    salesNotifOpen, setSalesNotifOpen,
    onlineMgrFollowupOpen, setOnlineMgrFollowupOpen,
    onlineMgrNewEventsOpen, setOnlineMgrNewEventsOpen,
    quickBookOpen, setQuickBookOpen,
    quickBookSearch, setQuickBookSearch,
    leadPayRow, setLeadPayRow,
    leadPayDraft, setLeadPayDraft,
    leadsSalesTargets,
  };
}
