import React, { useState, useMemo } from 'react';
import {
  Bell, Phone, MessageSquare, Clock, 
  User, 
  BarChart3,
} from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import type { LeadItem, LeadStatus } from '../../../types';
import { toDialable } from '../../../lib/whatsappLink';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }
type FollowupSort = 'date' | 'name';

const STATUS_LABELS: Partial<Record<LeadStatus, string>> = {
  new: 'جديد', contacted: 'تم التواصل', interested: 'مهتم',
  interested_followup: 'مهتم - متابعة', interested_booking: 'مهتم - حجز',
  no_answer: 'لا يرد', no_answer_wa: 'لا يرد واتساب',
  postpone_month: 'مؤجل', with_colleague: 'مع زميل', other: 'أخرى',
};

const STATUS_COLORS: Partial<Record<LeadStatus, string>> = {
  new: 'bg-blue-50 text-blue-700', interested: 'bg-green-50 text-green-700',
  interested_followup: 'bg-emerald-50 text-emerald-700',
  interested_booking: 'bg-teal-50 text-teal-700',
  contacted: 'bg-sky-50 text-sky-700', no_answer: 'bg-gray-50 text-gray-600',
  no_answer_wa: 'bg-gray-50 text-gray-600', postpone_month: 'bg-amber-50 text-amber-700',
  with_colleague: 'bg-purple-50 text-purple-700',
};

const TODAY = new Date().toISOString().slice(0, 10);
const TOMORROW = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const WEEK = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

function bucket(lead: LeadItem): 'overdue' | 'today' | 'tomorrow' | 'week' | null {
  const d = lead.nextFollowUpDate;
  if (!d) return null;
  if (d < TODAY) return 'overdue';
  if (d === TODAY) return 'today';
  if (d === TOMORROW) return 'tomorrow';
  if (d <= WEEK) return 'week';
  return null;
}

const FollowupRemindersTab: React.FC<Props> = () => {
  const { leads, staffMembers } = useSiteData();
  const [filterSales, setFilterSales] = useState<string>('all');
  const [showBucket, setShowBucket] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'date' | 'name'>('date');

  const salesTeam = useMemo(() =>
    staffMembers.filter(s => s.role === 'sales' && s.status === 'active'),
    [staffMembers]
  );

  const reminders = useMemo(() => {
    return leads
      .filter(l => {
        if (l.status === 'converted' || l.status === 'lost' || l.status === 'not_interested' || l.status === 'not_interested_hidden') return false;
        if (!bucket(l)) return false;
        if (filterSales !== 'all' && l.assignedSalesId !== filterSales) return false;
        if (showBucket !== 'all' && bucket(l) !== showBucket) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'date') return (a.nextFollowUpDate || '') < (b.nextFollowUpDate || '') ? -1 : 1;
        return a.name.localeCompare(b.name, 'ar');
      });
  }, [leads, filterSales, showBucket, sortBy]);

  const overdue = reminders.filter(l => bucket(l) === 'overdue');
  const todayList = reminders.filter(l => bucket(l) === 'today');

  const buckets = [
    { key: 'overdue',  label: 'متأخرة',  count: leads.filter(l => bucket(l) === 'overdue').length,   icon: '🔴', bg: 'bg-red-50 border-red-200', header: 'bg-red-100 text-red-800' },
    { key: 'today',    label: 'اليوم',    count: leads.filter(l => bucket(l) === 'today').length,    icon: '🟠', bg: 'bg-orange-50 border-orange-200', header: 'bg-orange-100 text-orange-800' },
    { key: 'tomorrow', label: 'غداً',     count: leads.filter(l => bucket(l) === 'tomorrow').length, icon: '🟡', bg: 'bg-yellow-50 border-yellow-200', header: 'bg-yellow-100 text-yellow-800' },
    { key: 'week',     label: 'هذا الأسبوع', count: leads.filter(l => bucket(l) === 'week').length, icon: '🟢', bg: 'bg-green-50 border-green-200', header: 'bg-green-100 text-green-800' },
  ];

  const totalActionable = overdue.length + todayList.length;

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-rose-600 to-orange-500 rounded-2xl p-5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><Bell size={22} /> تذكيرات المتابعة</h2>
            <p className="text-rose-100 text-sm mt-0.5">ليدات تحتاج متابعة اليوم أو متأخرة</p>
          </div>
          {totalActionable > 0 && (
            <div className="bg-white/20 rounded-xl px-4 py-2 text-center">
              <div className="text-3xl font-black">{totalActionable}</div>
              <div className="text-xs text-rose-100">تحتاج تصرف فوري</div>
            </div>
          )}
        </div>
        <div className="grid grid-cols-4 gap-3 mt-4">
          {buckets.map(b => (
            <button key={b.key} onClick={() => setShowBucket(showBucket === b.key ? 'all' : b.key)}
              className={`rounded-xl p-2 text-center transition-all ${showBucket === b.key ? 'bg-white text-gray-800 scale-105 shadow' : 'bg-white/15 hover:bg-white/25'}`}>
              <div className="text-xl font-black">{b.count}</div>
              <div className="text-xs opacity-80">{b.icon} {b.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <select value={filterSales} onChange={e => setFilterSales(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400">
          <option value="all">كل المبيعات</option>
          {salesTeam.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as FollowupSort)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400">
          <option value="date">ترتيب: حسب التاريخ</option>
          <option value="name">ترتيب: حسب الاسم</option>
        </select>
        <span className="text-sm text-gray-500 mr-auto">{reminders.length} متابعة</span>
      </div>

      {/* Sales Performance Summary */}
      {filterSales === 'all' && salesTeam.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><BarChart3 size={16} className="text-rose-500" /> متابعات اليوم حسب الموظف</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {salesTeam.map(s => {
              const overdueCount = leads.filter(l => l.assignedSalesId === s.id && bucket(l) === 'overdue').length;
              const todayCount = leads.filter(l => l.assignedSalesId === s.id && bucket(l) === 'today').length;
              const total = overdueCount + todayCount;
              return (
                <div key={s.id} onClick={() => setFilterSales(s.id)}
                  className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-rose-200 hover:bg-rose-50 cursor-pointer transition-colors">
                  <div className="w-9 h-9 rounded-full bg-rose-100 flex items-center justify-center text-rose-700 font-bold text-sm shrink-0">
                    {s.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{s.name}</p>
                    <p className="text-xs text-gray-400">
                      {overdueCount > 0 && <span className="text-red-500 font-bold">{overdueCount} متأخرة</span>}
                      {overdueCount > 0 && todayCount > 0 && ' · '}
                      {todayCount > 0 && <span className="text-orange-500">{todayCount} اليوم</span>}
                      {total === 0 && <span className="text-green-500">✓ لا متابعات معلقة</span>}
                    </p>
                  </div>
                  {total > 0 && (
                    <span className={`text-sm font-black w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${overdueCount > 0 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                      {total}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Lead Cards */}
      {reminders.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Bell size={48} className="mx-auto mb-4 opacity-20" />
          <p className="text-lg font-medium">لا توجد متابعات معلقة</p>
          <p className="text-sm mt-1">رائع! جميع المتابعات إما تم تنفيذها أو ليست مستحقة الآن</p>
        </div>
      ) : (
        <div className="space-y-2">
          {reminders.map(lead => {
            const b = bucket(lead)!;
            const assignee = staffMembers.find(s => s.id === lead.assignedSalesId);
            const daysDiff = Math.round((new Date(TODAY).getTime() - new Date(lead.nextFollowUpDate!).getTime()) / 86400000);
            const daysLabel = b === 'overdue'
              ? `متأخرة ${daysDiff} يوم`
              : b === 'today' ? 'اليوم'
              : b === 'tomorrow' ? 'غداً'
              : `خلال ${Math.round((new Date(lead.nextFollowUpDate!).getTime() - new Date(TODAY).getTime()) / 86400000)} أيام`;
            const statusLabel = STATUS_LABELS[lead.status] || lead.status;
            const statusColor = STATUS_COLORS[lead.status] || 'bg-gray-50 text-gray-600';

            return (
              <div key={lead.id} className={`bg-white border rounded-xl p-4 flex flex-wrap items-center gap-3 shadow-sm hover:shadow-md transition-shadow ${b === 'overdue' ? 'border-red-200' : b === 'today' ? 'border-orange-200' : 'border-gray-200'}`}>
                <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm ${b === 'overdue' ? 'bg-red-500' : b === 'today' ? 'bg-orange-500' : 'bg-amber-400'}`}>
                  {lead.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-gray-800 text-sm">{lead.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor}`}>{statusLabel}</span>
                    {lead.source && <span className="text-xs text-gray-400">📍 {lead.source}</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-gray-400">
                    <span><Phone size={10} className="inline ml-0.5" />{lead.phone}</span>
                    {assignee && <span><User size={10} className="inline ml-0.5" />{assignee.name}</span>}
                    {lead.lastContactNote && <span className="truncate max-w-[200px]">📝 {lead.lastContactNote}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs font-bold px-2 py-1 rounded-lg flex items-center gap-1 ${b === 'overdue' ? 'bg-red-50 text-red-600 border border-red-200' : b === 'today' ? 'bg-orange-50 text-orange-600 border border-orange-200' : 'bg-gray-50 text-gray-500 border border-gray-200'}`}>
                    <Clock size={11} /> {daysLabel}
                  </span>
                  <a href={`https://wa.me/${toDialable(lead.phone)}`} target="_blank" rel="noopener noreferrer"
                    className="bg-green-500 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-green-600 font-medium flex items-center gap-1">
                    <MessageSquare size={12} /> واتساب
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default FollowupRemindersTab;
