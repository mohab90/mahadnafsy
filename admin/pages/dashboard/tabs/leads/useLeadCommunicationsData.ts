import { useMemo } from 'react';
import type { LeadItem, LeadStatus, StaffMember } from '../../../../types';

export interface LeadCommunicationFilter {
  staffId: string;
  type: string;
  dateFrom: string;
  dateTo: string;
  search: string;
}

export interface LeadCommunicationEntry {
  leadId: string;
  leadName: string;
  leadPhone: string;
  leadStatus: LeadStatus;
  staffName: string;
  staffId: string;
  commId: string;
  type: string;
  date: string;
  notes: string;
  outcome?: string;
}

export const LEAD_COMM_TYPE_META: Record<string, { icon: string; label: string; color: string; dot: string }> = {
  call: { icon: '📞', label: 'مكالمة', color: 'bg-blue-100 text-blue-800 border-blue-200', dot: 'bg-blue-500' },
  whatsapp: { icon: '💬', label: 'واتساب', color: 'bg-emerald-100 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  email: { icon: '✉️', label: 'إيميل', color: 'bg-purple-100 text-purple-800 border-purple-200', dot: 'bg-purple-500' },
  meeting: { icon: '🤝', label: 'اجتماع', color: 'bg-orange-100 text-orange-800 border-orange-200', dot: 'bg-orange-500' },
  note: { icon: '📝', label: 'ملاحظة', color: 'bg-gray-100 text-gray-700 border-gray-200', dot: 'bg-gray-400' },
  payment_followup: { icon: '💳', label: 'متابعة دفع', color: 'bg-red-100 text-red-700 border-red-200', dot: 'bg-red-400' },
  new_course_sale: { icon: '🎓', label: 'بيع كورس', color: 'bg-teal-100 text-teal-700 border-teal-200', dot: 'bg-teal-500' },
};

export function useLeadCommunicationsData(
  effectiveLeads: LeadItem[],
  commFilter: LeadCommunicationFilter,
  salesReps: StaffMember[],
) {
  return useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    const allComms: LeadCommunicationEntry[] = effectiveLeads.flatMap((lead) =>
      (lead.communications || []).map((comm) => ({
        leadId: lead.id,
        leadName: lead.name,
        leadPhone: lead.phone,
        leadStatus: lead.status,
        staffName: lead.assignedSalesName || '—',
        staffId: lead.assignedSalesId || '',
        commId: comm.id,
        type: comm.type,
        date: comm.date,
        notes: comm.notes,
        outcome: comm.outcome,
      })),
    ).sort((a, b) => b.date.localeCompare(a.date));

    const filteredComms = allComms.filter((comm) => {
      if (commFilter.staffId && comm.staffId !== commFilter.staffId) return false;
      if (commFilter.type && comm.type !== commFilter.type) return false;
      if (commFilter.dateFrom && comm.date.slice(0, 10) < commFilter.dateFrom) return false;
      if (commFilter.dateTo && comm.date.slice(0, 10) > commFilter.dateTo) return false;
      if (commFilter.search) {
        const query = commFilter.search.toLowerCase();
        if (!comm.leadName.toLowerCase().includes(query) && !comm.leadPhone.includes(query) && !comm.notes.toLowerCase().includes(query)) return false;
      }
      return true;
    });

    const todayComms = allComms.filter((comm) => comm.date.slice(0, 10) === todayStr);
    const weekComms = allComms.filter((comm) => comm.date.slice(0, 10) >= weekAgo);

    const repStats = salesReps.map((rep) => {
      const repComms = weekComms.filter((comm) => comm.staffId === rep.id);
      return {
        name: rep.name.split(' ')[0],
        calls: repComms.filter((comm) => comm.type === 'call').length,
        whatsapp: repComms.filter((comm) => comm.type === 'whatsapp').length,
        meetings: repComms.filter((comm) => comm.type === 'meeting').length,
        total: repComms.length,
      };
    }).sort((a, b) => b.total - a.total);

    const exportCommsCsv = () => {
      const header = ['التاريخ', 'العميل', 'الهاتف', 'نوع التواصل', 'المندوب', 'ملاحظات', 'النتيجة'];
      const rows = filteredComms.map((comm) => [
        comm.date.slice(0, 16),
        comm.leadName,
        comm.leadPhone,
        LEAD_COMM_TYPE_META[comm.type]?.label || comm.type,
        comm.staffName,
        comm.notes,
        comm.outcome || '',
      ]);
      const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `communications-${todayStr}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    };

    return {
      todayStr,
      allComms,
      filteredComms,
      callCount: todayComms.filter((comm) => comm.type === 'call').length,
      waCount: todayComms.filter((comm) => comm.type === 'whatsapp').length,
      meetingCount: weekComms.filter((comm) => comm.type === 'meeting').length,
      uniqueLeadsToday: new Set(todayComms.map((comm) => comm.leadId)).size,
      typeMeta: LEAD_COMM_TYPE_META,
      exportCommsCsv,
      repStats,
    };
  }, [effectiveLeads, commFilter, salesReps]);
}
