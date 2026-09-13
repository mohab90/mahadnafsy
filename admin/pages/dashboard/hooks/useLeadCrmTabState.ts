import { useEffect, useState } from 'react';
import { cairoMonthOnly } from '../../../../shared/cairoDate';
import type { LeadItem, SalesTarget } from '../../../types';
import type { PaymentDraft } from '../../../components/PaymentModal';
import { createClientPaymentDraft } from '../../../lib/clientActionDrafts';
import { mysqlAdmin } from '../../../lib/mysqlapi';

export function useLeadCrmTabState() {
  const [salesNotifOpen, setSalesNotifOpen] = useState(false);
  const [onlineMgrFollowupOpen, setOnlineMgrFollowupOpen] = useState(false);
  const [onlineMgrNewEventsOpen, setOnlineMgrNewEventsOpen] = useState(false);
  const [quickBookOpen, setQuickBookOpen] = useState(false);
  const [quickBookSearch, setQuickBookSearch] = useState('');
  const [leadPayRow, setLeadPayRow] = useState<LeadItem | null>(null);
  const [leadPayDraft, setLeadPayDraft] = useState<PaymentDraft>(createClientPaymentDraft());
  const [leadsSalesTargets, setLeadsSalesTargets] = useState<SalesTarget[]>([]);

  useEffect(() => {
    const period = cairoMonthOnly();
    void mysqlAdmin.listSalesTargets(period)
      .then(rows => setLeadsSalesTargets(rows.map(row => ({
        staffId: String(row.staffId || ''),
        month: String(row.period || period),
        targetEGP: Number(row.revenueTarget) || 0,
      })).filter(row => row.staffId && row.staffId !== '__collection__')))
      .catch(() => setLeadsSalesTargets([]));
  }, []);

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
