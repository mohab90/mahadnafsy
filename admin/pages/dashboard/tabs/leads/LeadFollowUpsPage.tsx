import { useEffect, useState } from 'react';
import { AlarmClock, CheckCheck, MessageCircle, NotebookPen, Phone, RefreshCw } from 'lucide-react';
import type { LeadStatus, StaffMember } from '../../../../types';
import { cairoDateTime, cairoDay } from '../../../../../shared/cairoDate';
import { LEAD_STATUS_CFG, crmStatusLabels } from './LeadSubcomponents';
import type { ReminderLead } from './useLeadRemindersData';
import WhatsAppLink from './WhatsAppLink';

/**
 * «المتابعات» — «صفحه المتابعات محتاج يتعملها اعاده تصميم وهيكله وتبقي ابسط
 * واسهل بكتير ومفهومه».
 *
 * It was four stat cards, a cards/list switch, a server work queue, the
 * reminders, and a bulk-WhatsApp panel for silent leads underneath, all on one
 * screen. Now: one question at a time — who is late, who is today, who this
 * week, who promised to pay, who nobody has called — as chips with their
 * counts, and one list. Each person has the three things a rep does with a
 * follow-up: log the contact (which takes them off this list, and a new date
 * brings them back on that day — api/lib/leadInteractions.js), push it to
 * tomorrow, or mark it done.
 */
export type FollowUpGroup = 'overdue' | 'today' | 'week' | 'promised' | 'untouched';

const GROUPS: Array<{ key: FollowUpGroup; label: string; tone: string; empty: string }> = [
  { key: 'overdue', label: 'متأخرة', tone: 'red', empty: 'مفيش متابعات متأخرة' },
  { key: 'today', label: 'النهارده', tone: 'amber', empty: 'مفيش متابعات النهارده' },
  { key: 'week', label: 'الأسبوع ده', tone: 'blue', empty: 'مفيش متابعات الأسبوع ده' },
  { key: 'promised', label: 'وعدوا يدفعوا', tone: 'emerald', empty: 'مفيش حد وعد بالدفع' },
  { key: 'untouched', label: 'محدش كلمهم', tone: 'gray', empty: 'كل الليدز الجديدة اتكلموا' },
];
const TONE: Record<string, { on: string; off: string; badge: string }> = {
  red: { on: 'bg-red-600 text-white border-red-600', off: 'border-red-200 text-red-700 bg-red-50', badge: 'bg-red-100 text-red-700' },
  amber: { on: 'bg-amber-500 text-white border-amber-500', off: 'border-amber-200 text-amber-700 bg-amber-50', badge: 'bg-amber-100 text-amber-700' },
  blue: { on: 'bg-blue-600 text-white border-blue-600', off: 'border-blue-200 text-blue-700 bg-blue-50', badge: 'bg-blue-50 text-blue-700' },
  emerald: { on: 'bg-emerald-600 text-white border-emerald-600', off: 'border-emerald-200 text-emerald-700 bg-emerald-50', badge: 'bg-emerald-100 text-emerald-700' },
  gray: { on: 'bg-gray-700 text-white border-gray-700', off: 'border-gray-200 text-gray-700 bg-gray-50', badge: 'bg-gray-100 text-gray-600' },
};

const n = (value: number) => value.toLocaleString('ar-EG-u-nu-latn');

function dueLabel(group: FollowUpGroup, lead: ReminderLead): string {
  if (group === 'overdue') return lead.daysOverdue > 0 ? `متأخرة ${n(lead.daysOverdue)} يوم` : 'متأخرة';
  if (group === 'today') return 'النهارده';
  if (group === 'week') return lead.nextFollowUpDate || '';
  if (group === 'promised') {
    if (!lead.nextFollowUpDate) return 'وعد بالدفع — من غير ميعاد';
    return lead.daysOverdue > 0 ? `وعد متأخر ${n(lead.daysOverdue)} يوم` : `وعد — ${lead.nextFollowUpDate}`;
  }
  return lead.createdAt ? `دخل ${cairoDay(lead.createdAt)}` : 'محدش كلمه';
}

function lastContact(lead: ReminderLead): string {
  const comms = lead.communications || [];
  const latest = comms.length ? [...comms].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] : null;
  if (latest) return `${latest.notes || ''}${latest.date ? ` · ${cairoDateTime(latest.date)}` : ''}`;
  const note = (lead as ReminderLead & { lastContactNote?: string }).lastContactNote;
  return note ? String(note) : '';
}

export function LeadFollowUpsPage({
  groups, isSalesOnly, salesReps, staffFilter, setStaffFilter, refreshing, onRefresh,
  onLogContact, onSnooze, onDone, onOpenLead,
}: {
  groups: Record<FollowUpGroup, ReminderLead[]>;
  isSalesOnly: boolean;
  salesReps: StaffMember[];
  staffFilter: string;
  setStaffFilter: (value: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
  onLogContact: (lead: ReminderLead) => void;
  onSnooze: (lead: ReminderLead) => void;
  onDone: (lead: ReminderLead) => void;
  onOpenLead: (leadId: string) => void;
}) {
  // The first kind that has someone in it, overdue first.
  const firstFull = GROUPS.find(group => groups[group.key].length > 0)?.key || 'today';
  const [group, setGroup] = useState<FollowUpGroup>(firstFull);
  const [chosen, setChosen] = useState(false);
  useEffect(() => { if (!chosen) setGroup(firstFull); }, [chosen, firstFull]);
  const config = GROUPS.find(item => item.key === group)!;
  const rows = groups[group];

  return (
    <section className="space-y-4" dir="rtl">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900"><AlarmClock size={19} className="text-primary-600" /> المتابعات</h3>
          <p className="mt-0.5 text-xs text-gray-500">سجّل التواصل من الزرار، والعميل بيتشال من هنا. لو حطيت ميعاد جديد بيرجع في يومه.</p>
        </div>
        <div className="flex items-center gap-2">
          {!isSalesOnly && (
            <select value={staffFilter} onChange={event => setStaffFilter(event.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs" aria-label="السيلز">
              <option value="">كل السيلز</option>
              {salesReps.map(rep => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
            </select>
          )}
          <button type="button" onClick={onRefresh} className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> تحديث
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="نوع المتابعة">
        {GROUPS.map(item => {
          const tone = TONE[item.tone];
          return (
            <button key={item.key} type="button" role="tab" aria-selected={group === item.key}
              onClick={() => { setGroup(item.key); setChosen(true); }}
              className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${group === item.key ? tone.on : tone.off}`}>
              {item.label} <span className="mr-1 text-base">{n(groups[item.key].length)}</span>
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-emerald-100 bg-white py-12 text-center">
          <CheckCheck size={30} className="mx-auto mb-2 text-emerald-400" />
          <p className="font-bold text-emerald-700">{config.empty}</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
          {rows.map(lead => {
            const said = lastContact(lead);
            return (
              <li key={lead.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-[180px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => onOpenLead(lead.id)} className="font-bold text-gray-900 hover:text-primary-700">{lead.name || lead.phone}</button>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${TONE[config.tone].badge}`}>{dueLabel(group, lead)}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${LEAD_STATUS_CFG[lead.status as LeadStatus]?.color || 'bg-gray-100 text-gray-500'}`}>
                      {crmStatusLabels[lead.status] || lead.status}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-gray-500">
                    <span dir="ltr" className="font-mono">{lead.phone}</span>
                    {!isSalesOnly && lead.assignedSalesName && <span>👤 {lead.assignedSalesName}</span>}
                  </div>
                  {said && <p className="mt-0.5 line-clamp-1 text-xs text-gray-600">آخر تواصل: {said}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <a href={`tel:${lead.phone}`} title="اتصال" className="grid h-8 w-8 place-items-center rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"><Phone size={14} /></a>
                  <WhatsAppLink leadId={lead.id} phone={lead.phone}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
                    <MessageCircle size={14} />
                  </WhatsAppLink>
                  <button type="button" onClick={() => onLogContact(lead)}
                    className="flex h-8 items-center gap-1 rounded-lg bg-primary-600 px-3 text-xs font-bold text-white hover:bg-primary-700">
                    <NotebookPen size={13} /> سجّل التواصل
                  </button>
                  <button type="button" onClick={() => onSnooze(lead)}
                    className="h-8 rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-xs text-gray-600 hover:bg-gray-100">بكرة</button>
                  <button type="button" onClick={() => onDone(lead)} title="المتابعة خلصت"
                    className="flex h-8 items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50">
                    <CheckCheck size={13} /> تم
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
