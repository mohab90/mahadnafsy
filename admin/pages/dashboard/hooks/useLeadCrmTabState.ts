import { useEffect, useState } from 'react';
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
    const period = new Date().toISOString().slice(0, 7);
    void mysqlAdmin.listSalesTargets(period)
      .then(rows => setLeadsSalesTargets(rows as unknown as SalesTarget[]))
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
