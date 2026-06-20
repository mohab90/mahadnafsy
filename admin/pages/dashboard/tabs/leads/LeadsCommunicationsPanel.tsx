import React, { useMemo, useState } from 'react';
import {
  Activity, Bell, CheckCheck, Clock, Download, ExternalLink, MessageCircle,
  Phone, Plus, RefreshCw, TrendingUp, X,
} from 'lucide-react';
import { useSiteData } from '../../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { CommunicationRecord, LeadItem, LeadStatus } from '../../../../types';
import { ScoreBadge, formatWaPhone, crmStatusLabels, LEAD_STATUS_CFG } from './LeadSubcomponents';
import { calcLeadScore } from '../leadUtils';
import type { NotifyFn } from '../CrmSettingsModal';

interface Props {
  effectiveLeads: LeadItem[];
  isSalesOnly: boolean;
  notify: NotifyFn;
  onSelectLead: (id: string) => void;
}

export function LeadsCommunicationsPanel({ effectiveLeads, isSalesOnly, notify, onSelectLead }: Props) {
  const { leads, updateLead, staffMembers } = useSiteData();

  const salesReps = useMemo(() =>
    staffMembers.filter(s => (s.role || '').toLowerCase() === 'sales' && s.status === 'active'),
    [staffMembers]
  );

  const [commFilter, setCommFilter] = useState<{ staffId: string; type: string; dateFrom: string; dateTo: string; search: string; }>({ staffId: '', type: '', dateFrom: '', dateTo: '', search: '' });
  const [showAddComm, setShowAddComm] = useState(false);
  const [addCommDraft, setAddCommDraft] = useState({ leadSearch: '', selectedLeadId: '', type: 'call' as CommunicationRecord['type'], notes: '', outcome: '', nextFollowUp: '' });
  const [addCommSearchResults, setAddCommSearchResults] = useState<LeadItem[]>([]);
  const [reminderStaffFilter, setReminderStaffFilter] = useState('');
  const [reminderView, setReminderView] = useState<'list' | 'kanban'>('kanban');
  const [snoozeIds, setSnoozeIds] = useState<Set<string>>(new Set());
  const [staleLeads, setStaleLeads] = useState<{
    id: string; name: string; phone: string; email: string;
    status: string; interest_level: string;
    days_silent: number; last_comm_date: string; next_follow_up_date: string | null;
    assigned_sales_name: string | null;
  }[]>([]);
  const [staleLoading, setStaleLoading] = useState(false);
  const [staleBulkMsg, setStaleBulkMsg] = useState('أهلاً {name} 💚 نتمنى تواصلك معنا لمعرفة المزيد عن برامجنا. فريق مهاد للدراسات النفسية 🌿');
  const [staleSending, setStaleSending] = useState(false);
  const [staleSelected, setStaleSelected] = useState<Set<string>>(new Set());
  const [dueToday, setDueToday] = useState<{
    id: string; name: string; phone: string; email: string;
    status: string; interest_level: string;
    next_follow_up_date: string; assigned_sales_name: string | null; overdue_days: number;
  }[]>([]);
  const [dueTodayLoading, setDueTodayLoading] = useState(false);

        const todayStr = new Date().toISOString().slice(0, 10);
        const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

        // Build a flat list of all communications across all leads
        interface CommEntry {
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

        const allComms: CommEntry[] = [];
        effectiveLeads.forEach(l => {
          (l.communications || []).forEach(c => {
            allComms.push({
              leadId: l.id,
              leadName: l.name,
              leadPhone: l.phone,
              leadStatus: l.status,
              staffName: l.assignedSalesName || '—',
              staffId: l.assignedSalesId || '',
              commId: c.id,
              type: c.type,
              date: c.date,
              notes: c.notes,
              outcome: c.outcome,
            });
          });
        });

        // Sort newest first
        allComms.sort((a, b) => b.date.localeCompare(a.date));


        // Filtered comms
        const filteredComms = allComms.filter(c => {
          if (commFilter.staffId && c.staffId !== commFilter.staffId) return false;
          if (commFilter.type && c.type !== commFilter.type) return false;
          if (commFilter.dateFrom && c.date.slice(0, 10) < commFilter.dateFrom) return false;
          if (commFilter.dateTo && c.date.slice(0, 10) > commFilter.dateTo) return false;
          if (commFilter.search) {
            const q = commFilter.search.toLowerCase();
            if (!c.leadName.toLowerCase().includes(q) && !c.leadPhone.includes(q) && !c.notes.toLowerCase().includes(q)) return false;
          }
          return true;
        });

        // Stats
        const todayComms = allComms.filter(c => c.date.slice(0, 10) === todayStr);
        const weekComms = allComms.filter(c => c.date.slice(0, 10) >= weekAgo);
        const callCount = todayComms.filter(c => c.type === 'call').length;
        const waCount = todayComms.filter(c => c.type === 'whatsapp').length;
        const meetingCount = weekComms.filter(c => c.type === 'meeting').length;

        // Unique leads contacted today
        const uniqueLeadsToday = new Set(todayComms.map(c => c.leadId)).size;

        // Type display
        const TYPE_META: Record<string, { icon: string; label: string; color: string; dot: string }> = {
          call:            { icon: '📞', label: 'مكالمة',   color: 'bg-blue-100 text-blue-800 border-blue-200',    dot: 'bg-blue-500' },
          whatsapp:        { icon: '💬', label: 'واتساب',   color: 'bg-emerald-100 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
          email:           { icon: '✉️', label: 'إيميل',    color: 'bg-purple-100 text-purple-800 border-purple-200',  dot: 'bg-purple-500' },
          meeting:         { icon: '🤝', label: 'اجتماع',   color: 'bg-orange-100 text-orange-800 border-orange-200',  dot: 'bg-orange-500' },
          note:            { icon: '📝', label: 'ملاحظة',   color: 'bg-gray-100 text-gray-700 border-gray-200',       dot: 'bg-gray-400' },
          payment_followup:{ icon: '💳', label: 'متابعة دفع', color: 'bg-red-100 text-red-700 border-red-200',        dot: 'bg-red-400' },
          new_course_sale: { icon: '🎓', label: 'بيع كورس', color: 'bg-teal-100 text-teal-700 border-teal-200',      dot: 'bg-teal-500' },
        };

        const exportCommsCsv = () => {
          const header = ['التاريخ', 'العميل', 'الهاتف', 'نوع التواصل', 'المندوب', 'ملاحظات', 'النتيجة'];
          const rows = filteredComms.map(c => [
            c.date.slice(0, 16), c.leadName, c.leadPhone,
            TYPE_META[c.type]?.label || c.type,
            c.staffName, c.notes, c.outcome || '',
          ]);
          const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
          const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = `communications-${todayStr}.csv`; a.click();
          URL.revokeObjectURL(url);
        };

        // Per-rep stats
        const repStats = salesReps.map(rep => {
          const repComms = weekComms.filter(c => c.staffId === rep.id);
          return {
            name: rep.name.split(' ')[0],
            calls: repComms.filter(c => c.type === 'call').length,
            whatsapp: repComms.filter(c => c.type === 'whatsapp').length,
            meetings: repComms.filter(c => c.type === 'meeting').length,
            total: repComms.length,
          };
        }).sort((a, b) => b.total - a.total);

        const next7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

        // Categorize all leads with follow-up dates
        const remindersAll = leads.filter(l =>
          !l.hidden && l.nextFollowUpDate && !['converted', 'lost', 'not_interested_hidden'].includes(l.status)
        ).map(l => ({
          ...l,
          daysOverdue: l.nextFollowUpDate! < todayStr
            ? Math.floor((Date.now() - new Date(l.nextFollowUpDate!).getTime()) / 86400000)
            : 0,
          isToday: l.nextFollowUpDate === todayStr,
          isUpcoming: l.nextFollowUpDate! > todayStr && l.nextFollowUpDate! <= next7,
        }));

        const overdue   = remindersAll.filter(l => l.nextFollowUpDate! < todayStr).sort((a, b) => b.daysOverdue - a.daysOverdue);
        const today     = remindersAll.filter(l => l.nextFollowUpDate === todayStr).sort((a, b) => calcLeadScore(b) - calcLeadScore(a));
        const upcoming  = remindersAll.filter(l => l.nextFollowUpDate! > todayStr && l.nextFollowUpDate! <= next7).sort((a, b) => (a.nextFollowUpDate || '').localeCompare(b.nextFollowUpDate || ''));


        const filterByStaff = <T extends LeadItem>(arr: T[]) =>
          reminderStaffFilter ? arr.filter(l => l.assignedSalesId === reminderStaffFilter) : arr;

        const overdueFiltered  = filterByStaff(overdue).filter(l => !snoozeIds.has(l.id));
        const todayFiltered    = filterByStaff(today).filter(l => !snoozeIds.has(l.id));
        const upcomingFiltered = filterByStaff(upcoming).filter(l => !snoozeIds.has(l.id));

        // Completion rate (leads with nextFollowUpDate in past who now have a comm after that date)
        const totalDue = leads.filter(l => l.nextFollowUpDate && l.nextFollowUpDate <= todayStr && !l.hidden).length;
        const completed = leads.filter(l => {
          if (!l.nextFollowUpDate || l.nextFollowUpDate > todayStr || l.hidden) return false;
          return (l.communications || []).some(c => c.date.slice(0, 10) >= l.nextFollowUpDate!);
        }).length;
        const completionRate = totalDue > 0 ? Math.round((completed / totalDue) * 100) : 0;

        const snooze1Day = (lead: LeadItem) => {
          const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
          updateLead({ ...lead, nextFollowUpDate: tomorrow });
          setSnoozeIds(s => new Set([...s, lead.id]));
        };

        const markDone = (lead: LeadItem) => {
          const rec: CommunicationRecord = {
            id: `rem-${Date.now()}`,
            type: 'note',
            date: new Date().toISOString().slice(0, 16).replace('T', ' '),
            notes: '✅ تم إنجاز المتابعة',
          };
          updateLead({
            ...lead,
            communications: [...(lead.communications || []), rec],
            nextFollowUpDate: undefined,
          });
          setSnoozeIds(s => new Set([...s, lead.id]));
        };

        const ReminderCard = ({ lead, urgency }: { lead: LeadItem & { daysOverdue: number }; urgency: 'overdue' | 'today' | 'upcoming' }) => {
          const cfg = {
            overdue:  { border: 'border-red-300 border-r-4 border-r-red-500',  badge: 'bg-red-100 text-red-700 border-red-200',  icon: '🔴', label: `متأخر ${lead.daysOverdue} يوم` },
            today:    { border: 'border-amber-300 border-r-4 border-r-amber-500', badge: 'bg-amber-100 text-amber-700 border-amber-200', icon: '🟡', label: 'اليوم' },
            upcoming: { border: 'border-blue-200',                               badge: 'bg-blue-50 text-blue-700 border-blue-200',     icon: '📅', label: lead.nextFollowUpDate! },
          }[urgency];

          return (
            <div className={`bg-white border ${cfg.border} rounded-xl p-3 hover:shadow-md transition`}>
              <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0 border ${cfg.badge}`}>
                  {cfg.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                    <span className="font-bold text-gray-900 text-sm">{lead.name}</span>
                    <ScoreBadge score={calcLeadScore(lead)} />
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${cfg.badge}`}>{cfg.label}</span>
                  </div>
                  <p className="text-xs text-gray-500 font-mono" dir="ltr">{lead.phone}</p>
                  {lead.assignedSalesName && !isSalesOnly && (
                    <p className="text-[10px] text-gray-400 mt-0.5">👤 {lead.assignedSalesName}</p>
                  )}
                  {(() => {
                    const lastComm = (lead.communications || []).length
                      ? [...lead.communications!].sort((a, b) => b.date.localeCompare(a.date))[0]
                      : null;
                    return lastComm ? <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-1 italic">آخر تواصل: {lastComm.notes}</p> : null;
                  })()}
                </div>
              </div>
              <div className="flex gap-1.5 mt-2.5">
                <a href={`https://wa.me/${formatWaPhone(lead.phone)}`} target="_blank" rel="noreferrer"
                  className="flex-1 py-1.5 text-center text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition">
                  💬 واتساب
                </a>
                <a href={`tel:${lead.phone}`}
                  className="flex-1 py-1.5 text-center text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition">
                  📞 اتصال
                </a>
                <button onClick={() => snooze1Day(lead)}
                  className="px-2.5 py-1.5 text-[11px] font-bold bg-gray-50 text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-100 transition" title="تأجيل يوم">
                  ⏰
                </button>
                <button onClick={() => markDone(lead)}
                  className="px-2.5 py-1.5 text-[11px] font-bold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition" title="تم الإنجاز">
                  ✅
                </button>
                <button onClick={() => onSelectLead(lead.id)}
                  className="px-2.5 py-1.5 text-[11px] bg-gray-50 text-gray-500 border border-gray-200 rounded-lg hover:bg-primary-50 hover:text-primary-600 transition">
                  <ExternalLink size={11} />
                </button>
              </div>
            </div>
          );
        };

  return (
    <>
          <div className="space-y-5" dir="rtl">

            {/* ── Stats Bar ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'مكالمات اليوم', val: callCount, icon: '📞', color: 'bg-blue-50 border-blue-200 text-blue-700' },
                { label: 'واتساب اليوم',  val: waCount,   icon: '💬', color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
                { label: 'لقاءات الأسبوع', val: meetingCount, icon: '🤝', color: 'bg-orange-50 border-orange-200 text-orange-700' },
                { label: 'عملاء تواصل معهم اليوم', val: uniqueLeadsToday, icon: '👥', color: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
              ].map(s => (
                <div key={s.label} className={`${s.color} border rounded-2xl p-4 flex items-center gap-3`}>
                  <span className="text-2xl">{s.icon}</span>
                  <div>
                    <p className="text-2xl font-extrabold">{s.val}</p>
                    <p className="text-xs opacity-70">{s.label}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* ── Rep Performance Bar (this week) ── */}
            {repStats.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2 text-sm">
                  <TrendingUp size={15} className="text-indigo-500" /> أداء الفريق هذا الأسبوع
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-100">
                        <th className="text-right py-1.5 px-2 font-semibold">المندوب</th>
                        <th className="text-center py-1.5 px-2 font-semibold">📞</th>
                        <th className="text-center py-1.5 px-2 font-semibold">💬</th>
                        <th className="text-center py-1.5 px-2 font-semibold">🤝</th>
                        <th className="text-center py-1.5 px-2 font-semibold">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {repStats.map(r => (
                        <tr key={r.name} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="py-1.5 px-2 font-bold text-gray-800">{r.name}</td>
                          <td className="py-1.5 px-2 text-center text-blue-700 font-bold">{r.calls}</td>
                          <td className="py-1.5 px-2 text-center text-emerald-700 font-bold">{r.whatsapp}</td>
                          <td className="py-1.5 px-2 text-center text-orange-700 font-bold">{r.meetings}</td>
                          <td className="py-1.5 px-2 text-center">
                            <span className={`inline-block px-2 py-0.5 rounded-full font-extrabold text-xs ${r.total >= 20 ? 'bg-emerald-100 text-emerald-700' : r.total >= 10 ? 'bg-amber-100 text-amber-700' : 'bg-red-50 text-red-600'}`}>{r.total}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Filter Bar ── */}
            <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
                  <Activity size={15} className="text-primary-500" /> سجل التواصلات
                  <span className="text-xs font-normal text-gray-400">({filteredComms.length} من {allComms.length})</span>
                </h3>
                <div className="flex gap-2">
                  <button onClick={() => setShowAddComm(v => !v)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition">
                    <Plus size={13} /> تسجيل تواصل
                  </button>
                  <button onClick={exportCommsCsv}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition">
                    <Download size={13} /> تصدير
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <input
                  value={commFilter.search}
                  onChange={e => setCommFilter(f => ({ ...f, search: e.target.value }))}
                  placeholder="بحث بالاسم أو الهاتف أو الملاحظة..."
                  className="flex-1 min-w-[160px] border border-gray-200 rounded-xl px-3 py-2 text-xs"
                />
                <select value={commFilter.type} onChange={e => setCommFilter(f => ({ ...f, type: e.target.value }))}
                  className="border border-gray-200 rounded-xl px-3 py-2 text-xs bg-white">
                  <option value="">كل الأنواع</option>
                  <option value="call">📞 مكالمة</option>
                  <option value="whatsapp">💬 واتساب</option>
                  <option value="email">✉️ إيميل</option>
                  <option value="meeting">🤝 اجتماع</option>
                  <option value="note">📝 ملاحظة</option>
                </select>
                {!isSalesOnly && (
                  <select value={commFilter.staffId} onChange={e => setCommFilter(f => ({ ...f, staffId: e.target.value }))}
                    className="border border-gray-200 rounded-xl px-3 py-2 text-xs bg-white">
                    <option value="">كل المندوبين</option>
                    {salesReps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                )}
                <input type="date" value={commFilter.dateFrom} onChange={e => setCommFilter(f => ({ ...f, dateFrom: e.target.value }))}
                  className="border border-gray-200 rounded-xl px-3 py-2 text-xs" />
                <input type="date" value={commFilter.dateTo} onChange={e => setCommFilter(f => ({ ...f, dateTo: e.target.value }))}
                  className="border border-gray-200 rounded-xl px-3 py-2 text-xs" />
                {(commFilter.staffId || commFilter.type || commFilter.dateFrom || commFilter.dateTo || commFilter.search) && (
                  <button onClick={() => setCommFilter({ staffId: '', type: '', dateFrom: '', dateTo: '', search: '' })}
                    className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 px-2 py-1.5 rounded-xl border border-red-200 bg-red-50">
                    <X size={11} /> مسح الفلاتر
                  </button>
                )}
              </div>
            </div>

            {/* ── Quick Add Communication ── */}
            {showAddComm && (
              <div className="bg-white border border-primary-200 rounded-2xl p-4 shadow-sm space-y-3">
                <h4 className="font-bold text-primary-700 text-sm flex items-center gap-2">
                  <Plus size={14} /> تسجيل تواصل جديد
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="relative">
                    <label className="text-xs font-bold text-gray-600 mb-1 block">البحث عن عميل</label>
                    <input
                      value={addCommDraft.leadSearch}
                      onChange={e => {
                        setAddCommDraft(d => ({ ...d, leadSearch: e.target.value, selectedLeadId: '' }));
                        const q = e.target.value.toLowerCase();
                        if (q.length >= 2) {
                          setAddCommSearchResults(effectiveLeads.filter(l =>
                            l.name.toLowerCase().includes(q) || l.phone.includes(q)
                          ).slice(0, 6));
                        } else {
                          setAddCommSearchResults([]);
                        }
                      }}
                      placeholder="ابحث عن العميل..."
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
                    />
                    {addCommSearchResults.length > 0 && !addCommDraft.selectedLeadId && (
                      <div className="absolute top-full mt-1 right-0 left-0 z-50 bg-white border border-gray-200 rounded-xl shadow-xl max-h-48 overflow-y-auto">
                        {addCommSearchResults.map(l => (
                          <button key={l.id} onClick={() => {
                            setAddCommDraft(d => ({ ...d, leadSearch: l.name, selectedLeadId: l.id }));
                            setAddCommSearchResults([]);
                          }} className="w-full text-right px-3 py-2 text-xs hover:bg-gray-50 flex justify-between items-center">
                            <span className="font-bold text-gray-800">{l.name}</span>
                            <span className="text-gray-400 font-mono">{l.phone}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {addCommDraft.selectedLeadId && (
                      <span className="absolute left-2 top-8 text-emerald-600 text-xs font-bold">✓ محدد</span>
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-600 mb-1 block">نوع التواصل</label>
                    <select value={addCommDraft.type} onChange={e => setAddCommDraft(d => ({ ...d, type: e.target.value as CommunicationRecord['type'] }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
                      <option value="call">📞 مكالمة</option>
                      <option value="whatsapp">💬 واتساب</option>
                      <option value="email">✉️ إيميل</option>
                      <option value="meeting">🤝 اجتماع</option>
                      <option value="note">📝 ملاحظة</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-600 mb-1 block">ملاحظة التواصل *</label>
                  <textarea value={addCommDraft.notes} onChange={e => setAddCommDraft(d => ({ ...d, notes: e.target.value }))}
                    rows={2} placeholder="ما الذي حصل في هذا التواصل؟"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none" />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-xs font-bold text-gray-600 mb-1 block">النتيجة (اختياري)</label>
                    <input value={addCommDraft.outcome} onChange={e => setAddCommDraft(d => ({ ...d, outcome: e.target.value }))}
                      placeholder="نتيجة التواصل..." className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs font-bold text-gray-600 mb-1 block">موعد المتابعة التالية</label>
                    <input type="date" value={addCommDraft.nextFollowUp} onChange={e => setAddCommDraft(d => ({ ...d, nextFollowUp: e.target.value }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    disabled={!addCommDraft.selectedLeadId || !addCommDraft.notes.trim()}
                    onClick={() => {
                      const lead = effectiveLeads.find(l => l.id === addCommDraft.selectedLeadId);
                      if (!lead) return;
                      const rec: CommunicationRecord = {
                        id: `comm-${Date.now()}`,
                        type: addCommDraft.type,
                        date: new Date().toISOString().slice(0, 16).replace('T', ' '),
                        notes: addCommDraft.notes.trim(),
                        outcome: addCommDraft.outcome.trim() || undefined,
                        nextFollowUp: addCommDraft.nextFollowUp || undefined,
                      };
                      updateLead({
                        ...lead,
                        communications: [...(lead.communications || []), rec],
                        nextFollowUpDate: addCommDraft.nextFollowUp || lead.nextFollowUpDate,
                        status: lead.status === 'new' ? 'contacted' : lead.status,
                      });
                      setAddCommDraft({ leadSearch: '', selectedLeadId: '', type: 'call', notes: '', outcome: '', nextFollowUp: '' });
                      setShowAddComm(false);
                    }}
                    className="flex-1 py-2 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 disabled:opacity-50 transition">
                    حفظ التواصل
                  </button>
                  <button onClick={() => setShowAddComm(false)} className="px-4 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition text-sm">إلغاء</button>
                </div>
              </div>
            )}

            {/* ── Communications Timeline ── */}
            <div className="space-y-2">
              {filteredComms.length === 0 ? (
                <div className="bg-gray-50 border border-gray-200 rounded-2xl p-10 text-center">
                  <Phone size={32} className="text-gray-200 mx-auto mb-3" />
                  <p className="text-sm text-gray-400 font-medium">لا توجد تواصلات تطابق الفلتر</p>
                </div>
              ) : (
                <>
                  {filteredComms.slice(0, 120).map((c, i) => {
                    const meta = TYPE_META[c.type] || { icon: '📌', label: c.type, color: 'bg-gray-100 text-gray-700 border-gray-200', dot: 'bg-gray-400' };
                    const dateStr = c.date.slice(0, 16).replace('T', ' ');
                    const isToday = c.date.slice(0, 10) === todayStr;
                    const lead = effectiveLeads.find(l => l.id === c.leadId);
                    return (
                      <div key={`${c.commId}-${i}`} className={`bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-start gap-3 shadow-sm hover:shadow transition ${isToday ? 'border-r-4 border-r-primary-400' : ''}`}>
                        {/* Type Badge */}
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-base flex-shrink-0 mt-0.5 border ${meta.color}`}>
                          {meta.icon}
                        </div>
                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                            <span className="font-bold text-gray-900 text-sm">{c.leadName}</span>
                            <a href={`tel:${c.leadPhone}`} className="text-blue-600 font-mono text-xs hover:underline" dir="ltr">{c.leadPhone}</a>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${meta.color}`}>{meta.label}</span>
                            {!isSalesOnly && c.staffName !== '—' && (
                              <span className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded-full">{c.staffName}</span>
                            )}
                            {isToday && <span className="text-[10px] bg-primary-50 text-primary-700 font-bold px-1.5 py-0.5 rounded-full border border-primary-200">اليوم</span>}
                          </div>
                          <p className="text-xs text-gray-700 leading-relaxed line-clamp-2">{c.notes}</p>
                          {c.outcome && <p className="text-[10px] text-emerald-600 mt-0.5 font-medium">↩ {c.outcome}</p>}
                        </div>
                        {/* Date + Actions */}
                        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                          <span className="text-[10px] text-gray-400" dir="ltr">{dateStr}</span>
                          <div className="flex gap-1">
                            {lead && (
                              <a href={`https://wa.me/${formatWaPhone(c.leadPhone)}`} target="_blank" rel="noreferrer"
                                className="h-6 w-6 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center hover:bg-emerald-100 text-xs transition" title="واتساب">
                                💬
                              </a>
                            )}
                            {lead && (
                              <button onClick={() => onSelectLead(c.leadId)}
                                className="h-6 w-6 rounded-lg bg-gray-50 text-gray-500 flex items-center justify-center hover:bg-primary-50 hover:text-primary-600 transition" title="تفاصيل العميل">
                                <ExternalLink size={11} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {filteredComms.length > 120 && (
                    <p className="text-center text-xs text-gray-400 py-3">تم عرض 120 من {filteredComms.length} — استخدم الفلتر لتضييق النتائج</p>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="space-y-5" dir="rtl">
            {/* ── Section Divider: Reminders ── */}
            <div className="flex items-center gap-3 pt-2">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="flex items-center gap-1.5 text-sm font-bold text-gray-500 px-2">
                <Bell size={14} className="text-primary-500" />
                التذكيرات والمتابعة
              </span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            {/* ── Stats Bar ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'متأخرة', val: overdue.length, color: 'bg-red-50 border-red-200 text-red-700', icon: '🔴' },
                { label: 'اليوم', val: today.length, color: 'bg-amber-50 border-amber-200 text-amber-700', icon: '🟡' },
                { label: 'هذا الأسبوع', val: upcoming.length, color: 'bg-blue-50 border-blue-200 text-blue-700', icon: '📅' },
                { label: 'معدل الإنجاز', val: `${completionRate}%`, color: completionRate >= 70 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-orange-50 border-orange-200 text-orange-700', icon: completionRate >= 70 ? '🏆' : '⚡' },
              ].map(s => (
                <div key={s.label} className={`${s.color} border rounded-2xl p-4 flex items-center gap-3`}>
                  <span className="text-2xl">{s.icon}</span>
                  <div>
                    <p className="text-2xl font-extrabold">{s.val}</p>
                    <p className="text-xs opacity-70">{s.label}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* ── Toolbar ── */}
            <div className="flex flex-wrap items-center gap-3 bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-sm">
              <div className="flex gap-1">
                <button onClick={() => setReminderView('kanban')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${reminderView === 'kanban' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  بطاقات
                </button>
                <button onClick={() => setReminderView('list')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${reminderView === 'list' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  قائمة
                </button>
              </div>
              {!isSalesOnly && (
                <select value={reminderStaffFilter} onChange={e => setReminderStaffFilter(e.target.value)}
                  className="border border-gray-200 rounded-xl px-3 py-1.5 text-xs bg-white">
                  <option value="">كل المندوبين</option>
                  {salesReps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              )}
              {snoozeIds.size > 0 && (
                <button onClick={() => setSnoozeIds(new Set())}
                  className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-xl bg-gray-50 hover:bg-gray-100 transition">
                  إلغاء التأجيل ({snoozeIds.size})
                </button>
              )}
              <div className="mr-auto flex items-center gap-2">
                <button onClick={() => {
                  setDueTodayLoading(true);
                  mysqlAdmin.adminGet<typeof dueToday>('/api/admin/crm/follow-up-due')
                    .then(data => setDueToday(Array.isArray(data) ? data : []))
                    .catch(() => {})
                    .finally(() => setDueTodayLoading(false));
                }} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition">
                  <RefreshCw size={12} className={dueTodayLoading ? 'animate-spin' : ''} /> تحديث
                </button>
              </div>
            </div>

            {/* ── Kanban View ── */}
            {reminderView === 'kanban' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Overdue */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-xl">
                    <span className="text-base">🔴</span>
                    <span className="font-bold text-red-700 text-sm">متأخرة</span>
                    <span className="mr-auto bg-red-500 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full">{overdueFiltered.length}</span>
                  </div>
                  {overdueFiltered.length === 0 ? (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
                      <CheckCheck size={20} className="text-emerald-500 mx-auto mb-1" />
                      <p className="text-xs font-bold text-emerald-700">لا توجد متأخرة 🎉</p>
                    </div>
                  ) : overdueFiltered.slice(0, 20).map(lead => (
                    <ReminderCard key={lead.id} lead={lead as LeadItem & { daysOverdue: number }} urgency="overdue" />
                  ))}
                  {overdueFiltered.length > 20 && <p className="text-center text-xs text-gray-400">+{overdueFiltered.length - 20} أخرى</p>}
                </div>

                {/* Today */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl">
                    <span className="text-base">🟡</span>
                    <span className="font-bold text-amber-700 text-sm">اليوم</span>
                    <span className="mr-auto bg-amber-500 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full">{todayFiltered.length}</span>
                  </div>
                  {todayFiltered.length === 0 ? (
                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
                      <Bell size={20} className="text-gray-300 mx-auto mb-1" />
                      <p className="text-xs text-gray-400">لا متابعات لليوم</p>
                    </div>
                  ) : todayFiltered.slice(0, 20).map(lead => (
                    <ReminderCard key={lead.id} lead={lead as LeadItem & { daysOverdue: number }} urgency="today" />
                  ))}
                </div>

                {/* Upcoming */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl">
                    <span className="text-base">📅</span>
                    <span className="font-bold text-blue-700 text-sm">هذا الأسبوع</span>
                    <span className="mr-auto bg-blue-500 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full">{upcomingFiltered.length}</span>
                  </div>
                  {upcomingFiltered.length === 0 ? (
                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
                      <p className="text-xs text-gray-400">لا متابعات هذا الأسبوع</p>
                    </div>
                  ) : upcomingFiltered.slice(0, 20).map(lead => (
                    <ReminderCard key={lead.id} lead={lead as LeadItem & { daysOverdue: number }} urgency="upcoming" />
                  ))}
                </div>
              </div>
            )}

            {/* ── List View ── */}
            {reminderView === 'list' && (
              <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-right">
                      <th className="py-3 px-4 font-bold text-gray-700 text-xs">العميل</th>
                      <th className="py-3 px-3 font-bold text-gray-700 text-xs">الهاتف</th>
                      {!isSalesOnly && <th className="py-3 px-3 font-bold text-gray-700 text-xs">المندوب</th>}
                      <th className="py-3 px-3 font-bold text-gray-700 text-xs">تاريخ المتابعة</th>
                      <th className="py-3 px-3 font-bold text-gray-700 text-xs">الحالة</th>
                      <th className="py-3 px-3 font-bold text-gray-700 text-xs">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...overdueFiltered, ...todayFiltered, ...upcomingFiltered].map(lead => {
                      const urgency = lead.nextFollowUpDate! < todayStr ? 'overdue' : lead.nextFollowUpDate === todayStr ? 'today' : 'upcoming';
                      const urgCfg = {
                        overdue:  { row: 'bg-red-50/30 border-r-2 border-r-red-500',   badge: 'bg-red-100 text-red-700', label: `متأخر ${lead.daysOverdue}ي` },
                        today:    { row: 'bg-amber-50/30 border-r-2 border-r-amber-500', badge: 'bg-amber-100 text-amber-700', label: 'اليوم' },
                        upcoming: { row: '',                                              badge: 'bg-blue-50 text-blue-700',  label: lead.nextFollowUpDate! },
                      }[urgency];
                      return (
                        <tr key={lead.id} className={`border-b border-gray-50 hover:bg-gray-50/50 transition ${urgCfg.row}`}>
                          <td className="py-2.5 px-4">
                            <p className="font-bold text-gray-900 text-xs">{lead.name}</p>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${LEAD_STATUS_CFG[lead.status as LeadStatus]?.color || 'bg-gray-100 text-gray-500'}`}>
                              {crmStatusLabels[lead.status] || lead.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <a href={`tel:${lead.phone}`} className="text-blue-600 text-xs font-mono hover:underline" dir="ltr">{lead.phone}</a>
                          </td>
                          {!isSalesOnly && <td className="py-2.5 px-3 text-xs text-gray-600">{lead.assignedSalesName || '—'}</td>}
                          <td className="py-2.5 px-3">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${urgCfg.badge}`}>{urgCfg.label}</span>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${LEAD_STATUS_CFG[lead.status as LeadStatus]?.color || 'bg-gray-100'}`}>
                              {crmStatusLabels[lead.status] || lead.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex gap-1">
                              <a href={`https://wa.me/${formatWaPhone(lead.phone)}`} target="_blank" rel="noreferrer"
                                className="h-6 w-14 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center text-[10px] font-bold hover:bg-emerald-100 transition">
                                💬 WA
                              </a>
                              <button onClick={() => snooze1Day(lead)} title="تأجيل يوم"
                                className="h-6 w-6 rounded-lg bg-gray-50 text-gray-500 border border-gray-200 flex items-center justify-center hover:bg-gray-100 text-xs transition">⏰</button>
                              <button onClick={() => markDone(lead)} title="تم"
                                className="h-6 w-6 rounded-lg bg-emerald-600 text-white flex items-center justify-center hover:bg-emerald-700 text-xs transition">✓</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {(overdueFiltered.length + todayFiltered.length + upcomingFiltered.length) === 0 && (
                  <div className="py-12 text-center">
                    <CheckCheck size={32} className="text-emerald-400 mx-auto mb-3" />
                    <p className="font-bold text-emerald-700">لا توجد تذكيرات في الفئات المحددة 🎉</p>
                  </div>
                )}
              </div>
            )}

            {/* ── Stale Leads Section ── */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
                  <MessageCircle size={15} className="text-amber-500" />
                  عملاء متوقفون (لم يُتواصل معهم 7 أيام+)
                  {staleLeads.length > 0 && (
                    <span className="text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                      {staleLeads.length}
                    </span>
                  )}
                </h3>
                <button onClick={() => {
                  setStaleLoading(true);
                  mysqlAdmin.adminGet<typeof staleLeads>('/api/admin/crm/stale-leads?days=7')
                    .then(data => setStaleLeads(Array.isArray(data) ? data : []))
                    .catch(() => {})
                    .finally(() => setStaleLoading(false));
                }} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 transition">
                  <RefreshCw size={12} className={staleLoading ? 'animate-spin' : ''} /> تحديث
                </button>
              </div>

              {staleLoading ? (
                <div className="text-center py-8 text-sm text-gray-400">جارٍ التحميل...</div>
              ) : staleLeads.length === 0 ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center">
                  <CheckCheck size={24} className="text-emerald-500 mx-auto mb-2" />
                  <p className="text-sm font-bold text-emerald-800">جميع العملاء تم التواصل معهم مؤخراً ✅</p>
                </div>
              ) : (
                <>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <input type="checkbox"
                        checked={staleSelected.size === staleLeads.length && staleLeads.length > 0}
                        onChange={e => setStaleSelected(e.target.checked ? new Set(staleLeads.map(l => l.id)) : new Set())}
                        className="w-4 h-4 accent-amber-600" />
                      <span className="text-sm font-bold text-amber-800">تحديد الكل ({staleLeads.length})</span>
                      {staleSelected.size > 0 && <span className="text-xs text-amber-600 font-bold mr-auto">محدد: {staleSelected.size}</span>}
                    </div>
                    <textarea value={staleBulkMsg} onChange={e => setStaleBulkMsg(e.target.value)} rows={2}
                      className="w-full text-sm border border-amber-200 rounded-lg p-2 resize-none bg-white"
                      placeholder="نص الرسالة — استخدم {name} لاسم العميل" />
                    <button disabled={staleSending || staleSelected.size === 0}
                      onClick={async () => {
                        if (!staleBulkMsg.trim() || staleSelected.size === 0) return;
                        setStaleSending(true);
                        try {
                          const selectedLeads = staleLeads.filter(l => staleSelected.has(l.id)).map(l => ({ id: l.id, phone: l.phone, name: l.name }));
                          const result = await mysqlAdmin.adminPost<{ sent: number; failed: number }>('/api/admin/crm/bulk-whatsapp', { leads: selectedLeads, message: staleBulkMsg });
                          notify('success', `تم الإرسال: ${(result as { sent: number }).sent} رسالة ✅`);
                          setStaleSelected(new Set());
                          const fresh = await mysqlAdmin.adminGet<typeof staleLeads>('/api/admin/crm/stale-leads?days=7');
                          setStaleLeads(Array.isArray(fresh) ? fresh : []);
                        } catch (e: unknown) { notify('error', (e as Error).message || 'فشل الإرسال'); }
                        finally { setStaleSending(false); }
                      }}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-60">
                      {staleSending ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <MessageCircle size={15} />}
                      إرسال واتساب ({staleSelected.size})
                    </button>
                  </div>
                  {staleLeads.map(lead => (
                    <div key={lead.id} className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-3">
                      <input type="checkbox" checked={staleSelected.has(lead.id)}
                        onChange={e => setStaleSelected(prev => { const n = new Set(prev); e.target.checked ? n.add(lead.id) : n.delete(lead.id); return n; })}
                        className="w-4 h-4 accent-amber-600 flex-shrink-0" />
                      <div className={`w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center ${lead.days_silent >= 14 ? 'bg-red-100' : 'bg-amber-100'}`}>
                        <Clock size={15} className={lead.days_silent >= 14 ? 'text-red-500' : 'text-amber-500'} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-gray-900 text-sm">{lead.name}</p>
                        <p className="text-xs text-gray-500">{lead.phone} · آخر تواصل منذ <span className="font-bold text-amber-700">{lead.days_silent} يوم</span></p>
                        {lead.assigned_sales_name && <p className="text-xs text-gray-400">مندوب: {lead.assigned_sales_name}</p>}
                      </div>
                      <a href={`https://wa.me/${formatWaPhone(lead.phone)}`} target="_blank" rel="noreferrer"
                        className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1.5 rounded-lg hover:bg-emerald-100 font-bold flex-shrink-0">واتساب</a>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
    </>
  );
}
