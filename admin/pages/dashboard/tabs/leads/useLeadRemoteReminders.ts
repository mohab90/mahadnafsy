import { useCallback, useEffect, useState } from 'react';

import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { NotifyFn } from '../CrmSettingsModal';
import type { StaleLeadRow } from './LeadStaleLeadsPanel';

type DueTodayLead = {
  id: string;
  name: string;
  phone: string;
  email: string;
  status: string;
  interest_level: string;
  next_follow_up_date: string;
  assigned_sales_name: string | null;
  overdue_days: number;
};

export function useLeadRemoteReminders(subTab: string, notify: NotifyFn) {
  const [staleLeads, setStaleLeads] = useState<StaleLeadRow[]>([]);
  const [staleLoading, setStaleLoading] = useState(false);
  const [staleBulkMsg, setStaleBulkMsg] = useState(
    'أهلاً {name} 💚 نتمنى تواصلك معنا لمعرفة المزيد عن برامجنا. فريق مهاد للدراسات النفسية 🌿',
  );
  const [staleSending, setStaleSending] = useState(false);
  const [staleSelected, setStaleSelected] = useState<Set<string>>(new Set());
  const [dueToday, setDueToday] = useState<DueTodayLead[]>([]);
  const [dueTodayLoading, setDueTodayLoading] = useState(false);

  const refreshStaleLeads = useCallback(async () => {
    setStaleLoading(true);
    try {
      const rows = await mysqlAdmin.adminGet<StaleLeadRow[]>('/admin/crm/stale-leads?days=7');
      setStaleLeads(Array.isArray(rows) ? rows : []);
    } catch {
      notify('error', 'تعذر تحميل الليدات المتأخرة');
    } finally {
      setStaleLoading(false);
    }
  }, [notify]);

  const refreshDueToday = useCallback(async () => {
    setDueTodayLoading(true);
    try {
      const rows = await mysqlAdmin.adminGet<DueTodayLead[]>('/admin/crm/follow-up-due');
      setDueToday(Array.isArray(rows) ? rows : []);
    } catch {
      notify('error', 'تعذر تحميل متابعات اليوم');
    } finally {
      setDueTodayLoading(false);
    }
  }, [notify]);

  const sendStaleBulkWhatsapp = useCallback(async () => {
    if (!staleBulkMsg.trim() || !staleSelected.size) return;
    setStaleSending(true);
    try {
      const selected = staleLeads
        .filter(lead => staleSelected.has(lead.id))
        .map(({ id, phone, name }) => ({ id, phone, name }));
      const result = await mysqlAdmin.adminPost<{ sent: number; failed: number }>(
        '/admin/crm/bulk-whatsapp',
        { leads: selected, message: staleBulkMsg },
      );
      notify('success', `تم الإرسال: ${result.sent} رسالة ✅`);
      setStaleSelected(new Set());
      await refreshStaleLeads();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'فشل الإرسال');
    } finally {
      setStaleSending(false);
    }
  }, [notify, refreshStaleLeads, staleBulkMsg, staleLeads, staleSelected]);

  useEffect(() => {
    void refreshDueToday();
  }, [refreshDueToday]);

  useEffect(() => {
    if (subTab !== 'reminders') return;
    void refreshStaleLeads();
  }, [subTab, refreshStaleLeads]);

  return {
    staleLeads,
    staleLoading,
    staleBulkMsg,
    setStaleBulkMsg,
    staleSending,
    staleSelected,
    setStaleSelected,
    dueToday,
    dueTodayLoading,
    refreshStaleLeads,
    refreshDueToday,
    sendStaleBulkWhatsapp,
  };
}
