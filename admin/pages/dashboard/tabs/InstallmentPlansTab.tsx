import React, { useState, useMemo } from 'react';
import { CreditCard, AlertTriangle, CheckCircle, Clock, TrendingUp, Download, Search, Filter, ChevronDown, Calendar, DollarSign, User, BarChart3 } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import type { SubscriberItem, InstallmentEntry, InstallmentPlan } from '../../../types';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }

const TODAY = new Date().toISOString().slice(0, 10);

interface EnrichedEntry {
  entry: InstallmentEntry;
  plan: InstallmentPlan;
  subscriber: SubscriberItem;
  status: 'paid' | 'upcoming' | 'overdue' | 'due_today';
  daysUntil: number;
}

const InstallmentPlansTab: React.FC<Props> = ({ notify }) => {
  const { subscribers, courses } = useSiteData();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'dueDate' | 'amount'>('dueDate');
  const [expandedSub, setExpandedSub] = useState<string | null>(null);

  const { entries, planStats } = useMemo(() => {
    const all: EnrichedEntry[] = [];
    subscribers.forEach(sub => {
      if (!sub.installmentPlans?.length) return;
      sub.installmentPlans.forEach(plan => {
        plan.entries.forEach(entry => {
          const paid = !!entry.paidAt;
          const daysUntil = Math.round((new Date(entry.dueDate).getTime() - new Date(TODAY).getTime()) / 86400000);
          let status: EnrichedEntry['status'] = 'upcoming';
          if (paid) status = 'paid';
          else if (daysUntil < 0) status = 'overdue';
          else if (daysUntil === 0) status = 'due_today';
          all.push({ entry, plan, subscriber: sub, status, daysUntil });
        });
      });
    });

    // Stats
    const totalExpected = all.reduce((s, e) => s + e.entry.amount, 0);
    const collected = all.filter(e => e.status === 'paid').reduce((s, e) => s + (e.entry.paidAmount ?? e.entry.amount), 0);
    const overdueAmount = all.filter(e => e.status === 'overdue').reduce((s, e) => s + e.entry.amount, 0);
    const upcomingAmount = all.filter(e => e.status === 'upcoming').reduce((s, e) => s + e.entry.amount, 0);

    return {
      entries: all,
      planStats: { totalExpected, collected, overdueAmount, upcomingAmount, collectionRate: totalExpected > 0 ? Math.round(collected / totalExpected * 100) : 0 },
    };
  }, [subscribers]);

  const filtered = useMemo(() => {
    return entries.filter(e => {
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return e.subscriber.name.toLowerCase().includes(q) || e.subscriber.phone.includes(q) || (e.plan.courseTitle || '').toLowerCase().includes(q);
      }
      return true;
    }).sort((a, b) => {
      if (sortBy === 'dueDate') return a.entry.dueDate < b.entry.dueDate ? -1 : 1;
      return b.entry.amount - a.entry.amount;
    });
  }, [entries, statusFilter, search, sortBy]);

  const statusConfig = {
    paid:      { label: 'مدفوعة', color: 'text-green-700', bg: 'bg-green-50 border-green-200', dot: 'bg-green-500', icon: '✅' },
    overdue:   { label: 'متأخرة', color: 'text-red-700', bg: 'bg-red-50 border-red-200', dot: 'bg-red-500', icon: '🔴' },
    due_today: { label: 'اليوم', color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200', dot: 'bg-orange-500', icon: '⏰' },
    upcoming:  { label: 'قادمة', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200', dot: 'bg-blue-400', icon: '📅' },
  };

  // By subscriber (for grouping)
  const bySubscriber = useMemo(() => {
    const map = new Map<string, { sub: SubscriberItem; plans: InstallmentPlan[] }>();
    subscribers.forEach(sub => {
      if (sub.installmentPlans?.length) map.set(sub.id, { sub, plans: sub.installmentPlans });
    });
    return [...map.values()].filter(({ sub }) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return sub.name.toLowerCase().includes(q) || sub.phone.includes(q);
    });
  }, [subscribers, search]);

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-indigo-700 to-blue-600 rounded-2xl p-5 text-white">
        <h2 className="text-xl font-bold flex items-center gap-2"><CreditCard size={22} /> إدارة التقسيط</h2>
        <p className="text-blue-200 text-sm mt-0.5">متابعة خطط السداد والأقساط المستحقة</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {[
            { label: 'إجمالي المتوقع', value: `${planStats.totalExpected.toLocaleString()} ج.م`, bg: 'bg-white/15' },
            { label: 'إجمالي المحصَّل', value: `${planStats.collected.toLocaleString()} ج.م`, bg: 'bg-green-500/25' },
            { label: 'متأخر التحصيل', value: `${planStats.overdueAmount.toLocaleString()} ج.م`, bg: planStats.overdueAmount > 0 ? 'bg-red-500/25' : 'bg-white/10' },
            { label: 'نسبة التحصيل', value: `${planStats.collectionRate}%`, bg: 'bg-white/15' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
              <div className="text-lg font-black leading-tight">{s.value}</div>
              <div className="text-xs text-blue-200 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
        {/* Progress bar */}
        <div className="mt-4">
          <div className="flex justify-between text-xs text-blue-200 mb-1">
            <span>نسبة التحصيل الكلية</span>
            <span>{planStats.collectionRate}%</span>
          </div>
          <div className="h-2 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-white rounded-full transition-all" style={{ width: `${planStats.collectionRate}%` }} />
          </div>
        </div>
      </div>

      {/* Tabs - Status filter */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'all', label: 'الكل', count: entries.length },
          { key: 'overdue', label: '🔴 متأخرة', count: entries.filter(e => e.status === 'overdue').length },
          { key: 'due_today', label: '⏰ اليوم', count: entries.filter(e => e.status === 'due_today').length },
          { key: 'upcoming', label: '📅 قادمة', count: entries.filter(e => e.status === 'upcoming').length },
          { key: 'paid', label: '✅ مدفوعة', count: entries.filter(e => e.status === 'paid').length },
        ].map(s => (
          <button key={s.key} onClick={() => setStatusFilter(s.key)}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${statusFilter === s.key ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'}`}>
            {s.label} <span className="ml-1 opacity-70">{s.count}</span>
          </button>
        ))}
      </div>

      {/* Search + Sort */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px] relative">
          <Search size={15} className="absolute right-3 top-2.5 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="بحث باسم العميل أو هاتفه..."
            className="w-full pr-9 pl-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
          <option value="dueDate">ترتيب: تاريخ الاستحقاق</option>
          <option value="amount">ترتيب: المبلغ</option>
        </select>
      </div>

      {/* Subscriber plans grouped view */}
      {statusFilter === 'all' && !search ? (
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-gray-600 flex items-center gap-2">
            <User size={14} /> العملاء ({bySubscriber.length} عميل لديهم خطط تقسيط)
          </h3>
          {bySubscriber.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <CreditCard size={40} className="mx-auto mb-3 opacity-20" />
              <p>لا توجد خطط تقسيط مسجلة</p>
            </div>
          ) : bySubscriber.map(({ sub, plans }) => {
            const subEntries = entries.filter(e => e.subscriber.id === sub.id);
            const overdueCount = subEntries.filter(e => e.status === 'overdue').length;
            const todayCount = subEntries.filter(e => e.status === 'due_today').length;
            const paid = subEntries.filter(e => e.status === 'paid').length;
            const total = subEntries.length;
            const expanded = expandedSub === sub.id;

            return (
              <div key={sub.id} className={`bg-white border rounded-2xl shadow-sm overflow-hidden transition-colors ${overdueCount > 0 ? 'border-red-200' : todayCount > 0 ? 'border-orange-200' : 'border-gray-200'}`}>
                <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-right"
                  onClick={() => setExpandedSub(expanded ? null : sub.id)}>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 ${overdueCount > 0 ? 'bg-red-500' : 'bg-indigo-500'}`}>
                    {sub.name.charAt(0)}
                  </div>
                  <div className="flex-1 text-right">
                    <p className="font-bold text-gray-800 text-sm">{sub.name}</p>
                    <p className="text-xs text-gray-400">{sub.phone} · {plans.length} خطة</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs shrink-0">
                    {overdueCount > 0 && <span className="bg-red-50 text-red-600 font-bold px-2 py-0.5 rounded-lg border border-red-200">{overdueCount} متأخرة</span>}
                    {todayCount > 0 && <span className="bg-orange-50 text-orange-600 font-bold px-2 py-0.5 rounded-lg border border-orange-200">{todayCount} اليوم</span>}
                    <span className="text-gray-400">{paid}/{total}</span>
                    <ChevronDown size={14} className={`text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                {expanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-gray-100">
                    {plans.map(plan => {
                      const course = courses.find(c => c.id === plan.courseId);
                      const planTotal = plan.entries.reduce((s, e) => s + e.amount, 0);
                      const planPaid = plan.entries.filter(e => e.paidAt).reduce((s, e) => s + (e.paidAmount ?? e.amount), 0);
                      return (
                        <div key={plan.id} className="bg-gray-50 rounded-xl p-3">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <p className="text-sm font-bold text-gray-800">{plan.courseTitle || course?.title || 'كورس'}</p>
                              <p className="text-xs text-gray-400">{plan.entries.length} قسط · المجموع {plan.totalAmount.toLocaleString()} {plan.currency}</p>
                            </div>
                            <span className="text-xs font-bold text-indigo-600">{Math.round(planPaid / planTotal * 100)}% مدفوع</span>
                          </div>
                          <div className="h-1.5 bg-gray-200 rounded-full mb-2">
                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.round(planPaid / planTotal * 100)}%` }} />
                          </div>
                          <div className="space-y-1">
                            {plan.entries.map(entry => {
                              const paid2 = !!entry.paidAt;
                              const days = Math.round((new Date(entry.dueDate).getTime() - new Date(TODAY).getTime()) / 86400000);
                              const isOvd = !paid2 && days < 0;
                              return (
                                <div key={entry.id} className={`flex items-center justify-between py-1 px-2 rounded-lg text-xs ${paid2 ? 'bg-green-50' : isOvd ? 'bg-red-50' : days === 0 ? 'bg-orange-50' : 'bg-white'}`}>
                                  <span className={paid2 ? 'text-green-700' : isOvd ? 'text-red-600 font-bold' : 'text-gray-600'}>
                                    {paid2 ? '✅' : isOvd ? '🔴' : days === 0 ? '⏰' : '📅'} {entry.dueDate}
                                  </span>
                                  <span className={`font-bold ${paid2 ? 'text-green-700' : isOvd ? 'text-red-600' : 'text-gray-700'}`}>
                                    {entry.amount.toLocaleString()} {plan.currency}
                                    {paid2 && entry.paidAmount && entry.paidAmount !== entry.amount && <span className="text-gray-400 font-normal"> (دفع {entry.paidAmount.toLocaleString()})</span>}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Flat entries list */
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="font-bold text-gray-700">{filtered.length} قسط</h3>
          </div>
          {filtered.length === 0 ? (
            <div className="py-16 text-center text-gray-400">
              <CreditCard size={40} className="mx-auto mb-3 opacity-20" />
              <p>لا نتائج</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {filtered.map(({ entry, plan, subscriber, status }) => {
                const cfg = statusConfig[status];
                const days = Math.abs(Math.round((new Date(entry.dueDate).getTime() - new Date(TODAY).getTime()) / 86400000));
                return (
                  <div key={entry.id} className={`px-4 py-3 flex flex-wrap items-center gap-3 ${status === 'overdue' ? 'bg-red-50/40' : status === 'due_today' ? 'bg-orange-50/40' : ''}`}>
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${cfg.dot}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-800">{subscriber.name}</p>
                      <p className="text-xs text-gray-400">{plan.courseTitle || 'كورس'} · {subscriber.phone}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs shrink-0">
                      <span className={`px-2 py-0.5 rounded-full border font-medium ${cfg.bg} ${cfg.color}`}>
                        {cfg.icon} {cfg.label}
                        {status === 'overdue' && ` (${days} يوم)`}
                        {status === 'upcoming' && ` (${days} يوم)`}
                      </span>
                      <span className="font-black text-gray-800">{entry.amount.toLocaleString()} {plan.currency}</span>
                      <span className="text-gray-400">{entry.dueDate}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default InstallmentPlansTab;
