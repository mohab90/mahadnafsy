// «أداء فريق خدمة العملاء» — the section's only team screen.
//
// خدمة العملاء had none: every tab in it is one customer's problem in detail —
// the inbox, the tickets, the refunds, the consultations, the certificates. So
// there was nothing to give somebody who should see how the team is doing
// without reading what the customers wrote.
//
// Every figure comes from GET /api/admin/cx-performance, computed in SQL. What
// a ticket already records is what a service team is measured on: who it went
// to, how long until it was first answered, whether it beat its SLA, and what
// the customer scored the outcome. No subject and no customer name reaches this
// screen, which is what lets the performance key open it on its own.
import React, { useEffect, useState } from 'react';
import { Headphones, Clock, ShieldAlert, Star, Inbox } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import type { CxPerformance } from '../../../types';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn }

const STATUS_LABELS: Record<string, string> = {
  open: 'مفتوحة',
  pending: 'بانتظار الرد',
  in_progress: 'جارية',
  resolved: 'محلولة',
  closed: 'مغلقة',
  escalated: 'مُصعَّدة',
};

/** Minutes as something a person reads: 45 د، 3 س 20 د، 2 يوم. */
function readableMinutes(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  if (value < 60) return `${Math.round(value)} د`;
  if (value < 60 * 24) {
    const hours = Math.floor(value / 60);
    const minutes = Math.round(value % 60);
    return minutes ? `${hours} س ${minutes} د` : `${hours} س`;
  }
  const days = Math.floor(value / (60 * 24));
  const hours = Math.round((value % (60 * 24)) / 60);
  return hours ? `${days} ي ${hours} س` : `${days} ي`;
}

const CxTeamTab: React.FC<Props> = ({ notify }) => {
  const [data, setData] = useState<CxPerformance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    mysqlAdmin.getCxPerformance()
      .then(result => { if (live) { setData(result); setLoading(false); } })
      .catch(() => {
        if (!live) return;
        setLoading(false);
        notify('error', 'تعذّر تحميل أداء فريق خدمة العملاء');
      });
    return () => { live = false; };
  }, [notify]);

  if (loading) {
    return (
      <div className="py-16 text-center text-gray-400 text-sm" dir="rtl">
        جارٍ تحميل أرقام الفريق…
      </div>
    );
  }
  if (!data) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl py-14 text-center text-gray-400 text-sm" dir="rtl">
        لا توجد أرقام لعرضها الآن.
      </div>
    );
  }

  const { totals, byAgent, byStatus, inbox } = data;
  const resolutionRate = totals.tickets > 0 ? Math.round((totals.resolved / totals.tickets) * 100) : null;

  return (
    <div className="space-y-5" dir="rtl">
      <div className="bg-gradient-to-l from-rose-700 to-pink-600 rounded-2xl p-5 text-white">
        <h2 className="text-xl font-bold flex items-center gap-2"><Headphones size={22} /> أداء فريق خدمة العملاء</h2>
        <p className="text-rose-200 text-sm mt-0.5">
          التذاكر وزمن أول رد ونسبة الحل وتقييم العملاء — بدون فتح محتوى أي تذكرة
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-4">
          {[
            { label: 'إجمالي التذاكر', value: totals.tickets },
            { label: 'مفتوحة الآن', value: totals.open, bg: 'bg-rose-500/30' },
            { label: 'نسبة الحل', value: resolutionRate === null ? '—' : `${resolutionRate}%` },
            { label: 'متوسط أول رد', value: readableMinutes(totals.avgFirstResponseMinutes), small: true },
            { label: 'تقييم العملاء', value: totals.avgCsat === null ? '—' : `${totals.avgCsat} / 5`, small: true },
          ].map(card => (
            <div key={card.label} className={`${card.bg || 'bg-white/15'} rounded-xl p-3 text-center`}>
              <div className={`font-black ${card.small ? 'text-base' : 'text-2xl'}`}>{card.value}</div>
              <div className="text-xs text-rose-200 mt-0.5">{card.label}</div>
            </div>
          ))}
        </div>
      </div>

      {(totals.slaBreached > 0 || totals.unassigned > 0) && (
        <div className="flex flex-wrap gap-3">
          {totals.slaBreached > 0 && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-2 text-sm font-bold">
              <ShieldAlert size={16} /> {totals.slaBreached} تذكرة تجاوزت زمن الرد المتفق عليه
            </div>
          )}
          {totals.unassigned > 0 && (
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 text-slate-700 rounded-xl px-4 py-2 text-sm font-bold">
              <Inbox size={16} /> {totals.unassigned} تذكرة بلا مسؤول
            </div>
          )}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <Headphones size={15} className="text-rose-500" /> لكل موظف ({byAgent.length})
          </h3>
        </div>
        {byAgent.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">لا تذاكر بعد</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="px-4 py-2 text-right font-bold">الموظف</th>
                  <th className="px-3 py-2 font-bold">تذاكر</th>
                  <th className="px-3 py-2 font-bold">مفتوحة</th>
                  <th className="px-3 py-2 font-bold">محلولة</th>
                  <th className="px-3 py-2 font-bold">متوسط أول رد</th>
                  <th className="px-3 py-2 font-bold">تجاوز SLA</th>
                  <th className="px-3 py-2 font-bold">تقييم العميل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {byAgent.map(agent => (
                  <tr key={agent.id || agent.name} className="hover:bg-gray-50 text-center">
                    <td className="px-4 py-3 text-right">
                      <span className="font-bold text-gray-800">{agent.name}</span>
                      {!agent.id && <span className="text-xs text-gray-400 mr-2">(بلا مسؤول)</span>}
                    </td>
                    <td className="px-3 py-3 font-bold text-gray-700 tabular-nums">{agent.tickets}</td>
                    <td className="px-3 py-3 font-bold text-rose-600 tabular-nums">{agent.open}</td>
                    <td className="px-3 py-3 font-bold text-emerald-600 tabular-nums">{agent.resolved}</td>
                    <td className="px-3 py-3 text-gray-600 tabular-nums">{readableMinutes(agent.avgFirstResponseMinutes)}</td>
                    <td className={`px-3 py-3 font-bold tabular-nums ${agent.slaBreached ? 'text-amber-600' : 'text-gray-300'}`}>
                      {agent.slaBreached}
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      {agent.avgCsat === null
                        ? <span className="text-gray-300">—</span>
                        : (
                          <span className="inline-flex items-center gap-1 font-bold text-amber-600">
                            <Star size={13} /> {agent.avgCsat}
                            <span className="text-gray-400 font-normal text-xs">({agent.csatAnswers})</span>
                          </span>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Clock size={15} className="text-rose-500" /> التذاكر حسب الحالة</h3>
          {byStatus.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-6">لا تذاكر بعد</p>
          ) : (
            <div className="space-y-3">
              {byStatus.map(row => {
                const share = totals.tickets > 0 ? Math.round((row.count / totals.tickets) * 100) : 0;
                return (
                  <div key={row.status}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600">{STATUS_LABELS[row.status] || row.status}</span>
                      <span className="font-bold text-gray-800 tabular-nums">{row.count}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-rose-500 rounded-full" style={{ width: `${share}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Inbox size={15} className="text-cyan-500" /> المحادثات الواردة</h3>
          {inbox.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-6">لا محادثات</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {inbox.map(row => (
                <div key={row.id || row.name} className="flex items-center justify-between py-2.5">
                  <span className="text-sm text-gray-700 font-bold">{row.name}</span>
                  <span className="flex items-center gap-3 text-xs">
                    <span className="text-gray-500 tabular-nums">{row.conversations} محادثة</span>
                    {row.unread > 0 && (
                      <span className="bg-rose-100 text-rose-700 rounded-full px-2 py-0.5 font-bold tabular-nums">
                        {row.unread} غير مقروءة
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CxTeamTab;
