import React from 'react';
import {
  UserPlus, Percent, Users, CreditCard, CheckCircle, Globe, Filter, Tag, Bell,
} from 'lucide-react';
import type { DiscountRule, NotificationBroadcast } from '../../../../types';

import {
  StatCard, MiniBarChart, ProgressBar, SOURCE_ICONS, SOURCE_COLORS, fmtK,
  type SourceBreakdownRow, type FunnelStep,
} from './shared';

interface Props {
  filteredLeadsCount: number;
  convRate: number;
  convertedLeads: number;
  filteredSubsCount: number;
  totalRevenue: number;
  filteredOrdersCount: number;
  leadsChartData: { label: string; value: number }[];
  revenueChartData: { label: string; value: number }[];
  convChartData: { label: string; value: number }[];
  sourceBreakdown: SourceBreakdownRow[];
  funnel: FunnelStep[];
  activeDiscounts: DiscountRule[];
  notifications: NotificationBroadcast[];
}

export function OverviewSection({
  filteredLeadsCount, convRate, convertedLeads, filteredSubsCount, totalRevenue, filteredOrdersCount,
  leadsChartData, revenueChartData, convChartData, sourceBreakdown, funnel, activeDiscounts, notifications,
}: Props) {
  return (
    <div className="space-y-5">

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="ليدات جديدة" value={filteredLeadsCount} sub="هذه الفترة" icon={UserPlus} color="text-rose-600" bg="bg-rose-50" />
        <StatCard label="معدل التحويل" value={`${convRate}%`} sub={`${convertedLeads} تحويل`} icon={Percent} color="text-green-600" bg="bg-green-50" />
        <StatCard label="مشتركين جدد" value={filteredSubsCount} sub="في الفترة" icon={Users} color="text-indigo-600" bg="bg-indigo-50" />
        <StatCard label="إجمالي إيراد" value={`${fmtK(totalRevenue)} ج`} sub={`${filteredOrdersCount} طلب`} icon={CreditCard} color="text-teal-600" bg="bg-teal-50" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Leads chart */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-gray-800 flex items-center gap-1.5 text-sm">
              <UserPlus size={15} className="text-rose-500" /> ليدات آخر ٧ أيام
            </h3>
            <span className="text-xs text-gray-400 font-bold">{leadsChartData.reduce((s,d)=>s+d.value,0)}</span>
          </div>
          <MiniBarChart data={leadsChartData} color="bg-rose-400" height={55} showLabels />
        </div>

        {/* Revenue chart */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-gray-800 flex items-center gap-1.5 text-sm">
              <CreditCard size={15} className="text-teal-500" /> إيراد آخر ٧ أيام
            </h3>
            <span className="text-xs text-gray-400 font-bold">{fmtK(revenueChartData.reduce((s,d)=>s+d.value,0))} ج</span>
          </div>
          <MiniBarChart data={revenueChartData} color="bg-teal-400" height={55} showLabels />
        </div>

        {/* Conversion chart */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-gray-800 flex items-center gap-1.5 text-sm">
              <CheckCircle size={15} className="text-green-500" /> تحويلات آخر ٧ أيام
            </h3>
            <span className="text-xs text-gray-400 font-bold">{convChartData.reduce((s,d)=>s+d.value,0)}</span>
          </div>
          <MiniBarChart data={convChartData} color="bg-green-400" height={55} showLabels />
        </div>
      </div>

      {/* Sources + Funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Source breakdown */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <Globe size={16} className="text-rose-500" />
            <h3 className="font-bold text-gray-800">أفضل مصادر الليدات</h3>
          </div>
          <div className="p-4 space-y-3">
            {sourceBreakdown.length === 0
              ? <p className="text-center text-gray-400 py-6 text-sm">لا بيانات في هذه الفترة</p>
              : sourceBreakdown.slice(0, 6).map(src => (
                <div key={src.source}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{SOURCE_ICONS[src.source] || '❓'}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${SOURCE_COLORS[src.source] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                        {src.source}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 flex items-center gap-2">
                      <span className="font-bold text-gray-700">{src.total}</span>
                      <span className={`font-semibold ${src.convRate >= 30 ? 'text-green-600' : src.convRate >= 15 ? 'text-yellow-600' : 'text-gray-400'}`}>
                        {src.convRate}% ✓
                      </span>
                    </div>
                  </div>
                  <ProgressBar value={src.total} max={sourceBreakdown[0]?.total || 1} color="bg-rose-400" />
                </div>
              ))}
          </div>
        </div>

        {/* Conversion funnel */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <Filter size={16} className="text-rose-500" />
            <h3 className="font-bold text-gray-800">مسار التحويل</h3>
          </div>
          <div className="p-4 space-y-3">
            {funnel.map((step, idx) => (
              <div key={step.label}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm text-gray-600 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-rose-100 text-rose-600 text-xs flex items-center justify-center font-bold">{idx+1}</span>
                    {step.label}
                  </span>
                  <span className="text-sm font-bold text-gray-800">{step.value}</span>
                </div>
                <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`${step.color} h-full rounded-full flex items-center justify-end pr-2 text-white text-xs font-medium transition-all duration-700`}
                    style={{ width: `${step.w}%` }}>
                    {step.w > 15 ? `${step.w}%` : ''}
                  </div>
                </div>
              </div>
            ))}
            <div className="mt-2 p-3 bg-green-50 rounded-xl border border-green-100 flex items-center justify-between">
              <span className="text-sm text-green-700 font-semibold">معدل التحويل الإجمالي</span>
              <span className="text-xl font-black text-green-700">{funnel[3]?.w || 0}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Active discounts + recent notifications */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tag size={16} className="text-rose-500" />
              <h3 className="font-bold text-gray-800">الكوبونات النشطة</h3>
            </div>
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{activeDiscounts.length} نشط</span>
          </div>
          <div className="divide-y divide-gray-50">
            {activeDiscounts.length === 0
              ? <p className="p-6 text-center text-gray-400 text-sm">لا كوبونات نشطة</p>
              : activeDiscounts.slice(0, 5).map(d => (
                <div key={d.id} className="px-4 py-2.5 flex items-center gap-3">
                  <span className="font-mono font-bold text-indigo-600 text-sm">{d.code}</span>
                  <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">
                    {d.type === 'percent' ? `${d.value}%` : `${d.value} ج`}
                  </span>
                  <span className="mr-auto text-xs text-gray-400">{d.usageCount || 0} استخدام{d.usageLimit ? ` / ${d.usageLimit}` : ''}</span>
                  <div className="w-16">
                    <ProgressBar value={d.usageCount || 0} max={d.usageLimit || Math.max(d.usageCount || 1, 1)} color="bg-indigo-400" height="h-1.5" />
                  </div>
                </div>
              ))}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <Bell size={16} className="text-rose-500" />
            <h3 className="font-bold text-gray-800">آخر الإشعارات المرسلة</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {notifications.length === 0
              ? <p className="p-6 text-center text-gray-400 text-sm">لم يُرسل أي إشعار</p>
              : notifications.slice(0, 5).map(n => (
                <div key={n.id} className="px-4 py-2.5 flex items-start gap-3">
                  <Bell size={13} className="text-indigo-400 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{n.title}</p>
                    <p className="text-xs text-gray-400 truncate">{n.body}</p>
                  </div>
                  <span className="text-xs text-gray-300 shrink-0">{(n.sentAt || n.createdAt || '').slice(5, 10)}</span>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
