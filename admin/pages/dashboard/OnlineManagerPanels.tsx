import React from 'react';
import { AlarmClock, Banknote } from 'lucide-react';
import { useSiteData } from '../../context/SiteDataContext';
import { type TabKey } from './navigation';
import { type SubscriberItem, type InstallmentPlan, type InstallmentEntry, type PaymentHistoryEntry } from '../../types';

interface Props {
  onlineMgrFollowupOpen: boolean;
  setOnlineMgrFollowupOpen: (open: boolean) => void;
  onlineMgrNewEventsOpen: boolean;
  setOnlineMgrNewEventsOpen: (open: boolean) => void;
  isNonAdminStaff: boolean;
  salesOwnSubscribers: SubscriberItem[];
  setActiveTab: (tab: TabKey) => void;
}

export default function OnlineManagerPanels({
  onlineMgrFollowupOpen,
  setOnlineMgrFollowupOpen,
  onlineMgrNewEventsOpen,
  setOnlineMgrNewEventsOpen,
  isNonAdminStaff,
  salesOwnSubscribers,
  setActiveTab,
}: Props) {
  const { subscribers } = useSiteData();
  const subs = isNonAdminStaff ? salesOwnSubscribers : subscribers;

  return (
    <>
      {/* ── Online Manager: Collection/Installment Follow-up Panel ── */}
      {onlineMgrFollowupOpen && (() => {
        const today = new Date().toISOString().slice(0, 10);
        type OverdueEntry = { sub: SubscriberItem; plan: InstallmentPlan; entry: InstallmentEntry };
        const overdueEntries: OverdueEntry[] = [];
        const upcomingEntries: OverdueEntry[] = [];
        const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        for (const sub of subs) {
          for (const plan of (sub.installmentPlans || [])) {
            for (const entry of (plan.entries || [])) {
              if (!entry.paidAt) {
                if (entry.dueDate <= today) overdueEntries.push({ sub, plan, entry });
                else if (entry.dueDate <= soon) upcomingEntries.push({ sub, plan, entry });
              }
            }
          }
        }
        overdueEntries.sort((a, b) => a.entry.dueDate.localeCompare(b.entry.dueDate));
        upcomingEntries.sort((a, b) => a.entry.dueDate.localeCompare(b.entry.dueDate));
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-end" onClick={() => setOnlineMgrFollowupOpen(false)}>
            <div className="bg-white h-full w-full max-w-md shadow-2xl flex flex-col" dir="rtl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gradient-to-l from-teal-50 to-white">
                <div>
                  <h2 className="font-bold text-gray-900 text-lg flex items-center gap-2"><AlarmClock size={18} className="text-teal-600" /> متابعات التحصيل والأقساط</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{overdueEntries.length} قسط متأخر · {upcomingEntries.length} قسط قادم خلال 7 أيام</p>
                </div>
                <button onClick={() => setOnlineMgrFollowupOpen(false)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
              </div>
              <div className="grid grid-cols-2 gap-0 border-b border-gray-100">
                {[
                  { label: 'متأخرة', val: overdueEntries.length, color: overdueEntries.length > 0 ? 'text-red-600 bg-red-50' : 'text-gray-400 bg-gray-50' },
                  { label: 'قادمة (7 أيام)', val: upcomingEntries.length, color: upcomingEntries.length > 0 ? 'text-amber-600 bg-amber-50' : 'text-gray-400 bg-gray-50' },
                ].map(c => (
                  <div key={c.label} className={`${c.color} py-3 text-center`}>
                    <div className="text-2xl font-extrabold">{c.val}</div>
                    <div className="text-[11px] font-medium opacity-80">{c.label}</div>
                  </div>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-5">
                {overdueEntries.length > 0 && (
                  <div>
                    <span className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full mb-2 inline-block">⚠️ متأخرة ({overdueEntries.length})</span>
                    <div className="space-y-2">
                      {overdueEntries.map((e, i) => (
                        <div key={i} className="bg-red-50 border border-red-100 rounded-xl p-3 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-bold text-gray-800 text-sm truncate">{e.sub.name}</p>
                            <p className="text-[11px] text-gray-500">{e.plan.courseTitle || 'قسط'} · {e.entry.amount} {e.entry.currency}</p>
                            <p className="text-[10px] text-red-600 font-bold">📅 {e.entry.dueDate}</p>
                          </div>
                          <div className="flex-shrink-0 flex gap-1">
                            {e.sub.phone && <a href={`https://wa.me/${e.sub.phone.replace(/[^0-9]/g,'')}`} target="_blank" rel="noopener noreferrer" className="w-7 h-7 rounded-full bg-green-500 hover:bg-green-600 text-white text-xs font-bold flex items-center justify-center">W</a>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {upcomingEntries.length > 0 && (
                  <div>
                    <span className="text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full mb-2 inline-block">📅 قادمة ({upcomingEntries.length})</span>
                    <div className="space-y-2">
                      {upcomingEntries.map((e, i) => (
                        <div key={i} className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-bold text-gray-800 text-sm truncate">{e.sub.name}</p>
                            <p className="text-[11px] text-gray-500">{e.plan.courseTitle || 'قسط'} · {e.entry.amount} {e.entry.currency}</p>
                            <p className="text-[10px] text-amber-700 font-bold">📅 {e.entry.dueDate}</p>
                          </div>
                          <div className="flex-shrink-0 flex gap-1">
                            {e.sub.phone && <a href={`https://wa.me/${e.sub.phone.replace(/[^0-9]/g,'')}`} target="_blank" rel="noopener noreferrer" className="w-7 h-7 rounded-full bg-green-500 hover:bg-green-600 text-white text-xs font-bold flex items-center justify-center">W</a>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {overdueEntries.length === 0 && upcomingEntries.length === 0 && (
                  <div className="text-center py-20">
                    <div className="text-5xl mb-3">✅</div>
                    <p className="text-gray-500 font-bold">لا توجد أقساط متأخرة أو قادمة</p>
                  </div>
                )}
              </div>
              <div className="border-t border-gray-200 px-5 py-4 bg-gray-50">
                <button onClick={() => { setOnlineMgrFollowupOpen(false); setActiveTab('online_clients'); }} className="w-full py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold rounded-xl transition">عرض عملاء الاونلاين</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Online Manager: New Subscribers & Payments Panel ── */}
      {onlineMgrNewEventsOpen && (() => {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const newSubs = subs.filter(s => s.createdAt && s.createdAt.slice(0, 10) >= since)
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        type NewPayItem = { sub: SubscriberItem; payment: PaymentHistoryEntry };
        const newPayments: NewPayItem[] = subs
          .flatMap(s => (s.paymentHistory || []).filter(p => p.at && p.at.slice(0, 10) >= since).map(p => ({ sub: s, payment: p })))
          .sort((a, b) => (b.payment.at || '').localeCompare(a.payment.at || ''));
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-end" onClick={() => setOnlineMgrNewEventsOpen(false)}>
            <div className="bg-white h-full w-full max-w-md shadow-2xl flex flex-col" dir="rtl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gradient-to-l from-emerald-50 to-white">
                <div>
                  <h2 className="font-bold text-gray-900 text-lg flex items-center gap-2"><Banknote size={18} className="text-emerald-600" /> مشتركين جدد ومدفوعات</h2>
                  <p className="text-xs text-gray-500 mt-0.5">آخر 7 أيام · {newSubs.length} مشترك جديد · {newPayments.length} دفعة</p>
                </div>
                <button onClick={() => setOnlineMgrNewEventsOpen(false)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
              </div>
              <div className="grid grid-cols-2 gap-0 border-b border-gray-100">
                {[
                  { label: 'عملاء أونلاين جدد', val: newSubs.length, color: newSubs.length > 0 ? 'text-emerald-600 bg-emerald-50' : 'text-gray-400 bg-gray-50' },
                  { label: 'مدفوعات', val: newPayments.length, color: newPayments.length > 0 ? 'text-blue-600 bg-blue-50' : 'text-gray-400 bg-gray-50' },
                ].map(c => (
                  <div key={c.label} className={`${c.color} py-3 text-center`}>
                    <div className="text-2xl font-extrabold">{c.val}</div>
                    <div className="text-[11px] font-medium opacity-80">{c.label}</div>
                  </div>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-5">
                {newSubs.length > 0 && (
                  <div>
                    <span className="text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full mb-2 inline-block">🆕 مشتركين جدد ({newSubs.length})</span>
                    <div className="space-y-2">
                      {newSubs.map(s => (
                        <div key={s.id} className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-bold text-gray-800 text-sm truncate">{s.name}</p>
                            <p className="text-[11px] text-gray-500">{s.email}</p>
                            <p className="text-[10px] text-emerald-700 font-bold">📅 {s.createdAt?.slice(0, 10)}</p>
                          </div>
                          <div className="flex-shrink-0 flex gap-1">
                            {s.phone && <a href={`https://wa.me/${s.phone.replace(/[^0-9]/g,'')}`} target="_blank" rel="noopener noreferrer" className="w-7 h-7 rounded-full bg-green-500 hover:bg-green-600 text-white text-xs font-bold flex items-center justify-center">W</a>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {newPayments.length > 0 && (
                  <div>
                    <span className="text-xs font-bold text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full mb-2 inline-block">💳 مدفوعات جديدة ({newPayments.length})</span>
                    <div className="space-y-2">
                      {newPayments.slice(0, 30).map((item, i) => (
                        <div key={i} className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                          <p className="font-bold text-gray-800 text-sm truncate">{item.sub.name}</p>
                          <p className="text-[11px] text-gray-500">{item.payment.amount} {item.payment.currency} · {item.payment.paymentType || 'دفعة'}</p>
                          <p className="text-[10px] text-blue-700 font-bold">📅 {item.payment.at?.slice(0, 10)}</p>
                        </div>
                      ))}
                      {newPayments.length > 30 && <p className="text-xs text-gray-400 text-center">+{newPayments.length - 30} دفعة أخرى</p>}
                    </div>
                  </div>
                )}
                {newSubs.length === 0 && newPayments.length === 0 && (
                  <div className="text-center py-20">
                    <div className="text-5xl mb-3">📭</div>
                    <p className="text-gray-500 font-bold">لا توجد أحداث جديدة في آخر 7 أيام</p>
                  </div>
                )}
              </div>
              <div className="border-t border-gray-200 px-5 py-4 bg-gray-50">
                <button onClick={() => { setOnlineMgrNewEventsOpen(false); setActiveTab('online_clients'); }} className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition">عرض عملاء الاونلاين</button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
