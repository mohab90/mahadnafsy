import React, { useMemo, useState } from 'react';
import { Star, TrendingUp, TrendingDown, Users, ThumbsUp, ThumbsDown, Minus, BarChart3, Award, MessageSquare, RefreshCw } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }

// NPS Score from subscriber status distribution
// Active/paid = promoters (score 9-10), late/paused = passives (7-8), blocked/refunded = detractors (0-6)
function calcNPS(promoters: number, passives: number, detractors: number) {
  const total = promoters + passives + detractors;
  if (total === 0) return 0;
  return Math.round(((promoters - detractors) / total) * 100);
}

const NpsDashboardTab: React.FC<Props> = ({ notify }) => {
  const { subscribers, orders, courses } = useSiteData();
  const [selectedCourse, setSelectedCourse] = useState<string>('all');
  const [period, setPeriod] = useState<'month' | 'quarter' | 'year'>('month');

  const NOW = Date.now();
  const periodMs = period === 'month' ? 30 : period === 'quarter' ? 90 : 365;
  const cutoff = new Date(NOW - periodMs * 86400000).toISOString();

  const { nps, promoters, passives, detractors, total, courseBreakdown, trend } = useMemo(() => {
    let filtered = subscribers.filter(s => s.createdAt >= cutoff);
    if (selectedCourse !== 'all') filtered = filtered.filter(s => s.enrolledCourseIds.includes(selectedCourse));

    const pro = filtered.filter(s => s.status === 'active_paid' || s.status === 'finished').length;
    const pas = filtered.filter(s => s.status === 'active' || s.status === 'active_new' || s.status === 'active_late' || s.status === 'paused').length;
    const det = filtered.filter(s => s.status === 'blocked' || s.status === 'refunded').length;
    const tot = pro + pas + det;

    // Course breakdown
    const breakdown = courses.slice(0, 8).map(c => {
      const csubs = subscribers.filter(s => s.enrolledCourseIds.includes(c.id) && s.createdAt >= cutoff);
      const cp = csubs.filter(s => s.status === 'active_paid' || s.status === 'finished').length;
      const ca = csubs.filter(s => ['active', 'active_new', 'active_late', 'paused'].includes(s.status)).length;
      const cd = csubs.filter(s => s.status === 'blocked' || s.status === 'refunded').length;
      return { course: c, nps: calcNPS(cp, ca, cd), count: csubs.length, promoters: cp, detractors: cd };
    }).filter(b => b.count > 0).sort((a, b) => b.nps - a.nps);

    // 6-month trend (simulated from cohorts)
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(NOW - (5 - i) * 30 * 86400000);
      const label = `${d.getMonth() + 1}/${d.getFullYear().toString().slice(2)}`;
      const start = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString();
      const msubs = subscribers.filter(s => s.createdAt >= start && s.createdAt <= end);
      const mp = msubs.filter(s => s.status === 'active_paid' || s.status === 'finished').length;
      const ma = msubs.filter(s => ['active', 'active_new', 'active_late', 'paused'].includes(s.status)).length;
      const md = msubs.filter(s => s.status === 'blocked' || s.status === 'refunded').length;
      return { label, nps: calcNPS(mp, ma, md), count: msubs.length };
    });

    return { nps: calcNPS(pro, pas, det), promoters: pro, passives: pas, detractors: det, total: tot, courseBreakdown: breakdown, trend: months };
  }, [subscribers, courses, selectedCourse, period, cutoff]);

  const npsColor = nps >= 50 ? 'text-green-600' : nps >= 20 ? 'text-yellow-600' : nps >= 0 ? 'text-orange-600' : 'text-red-600';
  const npsBg = nps >= 50 ? 'from-green-600 to-emerald-500' : nps >= 20 ? 'from-yellow-600 to-amber-500' : nps >= 0 ? 'from-orange-600 to-amber-500' : 'from-red-700 to-rose-600';
  const npsLabel = nps >= 70 ? 'ممتاز' : nps >= 50 ? 'جيد جداً' : nps >= 30 ? 'جيد' : nps >= 0 ? 'مقبول' : 'يحتاج تحسين';

  const trendMax = Math.max(...trend.map(t => Math.abs(t.nps)), 1);

  // Satisfaction score (0-5)
  const satisfaction = total > 0 ? +(((promoters * 5 + passives * 3.5 + detractors * 1.5) / total)).toFixed(1) : 0;

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className={`bg-gradient-to-l ${npsBg} rounded-2xl p-5 text-white`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><Star size={22} /> لوحة NPS - رضا العملاء</h2>
            <p className="text-white/80 text-sm mt-0.5">Net Promoter Score — مؤشر ولاء العملاء</p>
          </div>
          <div className="text-center bg-white/20 rounded-2xl px-8 py-3">
            <div className="text-6xl font-black">{nps}</div>
            <div className="text-sm text-white/80 mt-1">NPS Score</div>
            <div className="text-xs bg-white/20 rounded-full px-3 py-0.5 mt-1">{npsLabel}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4">
          {[
            { label: 'Promoters (محبون)', value: promoters, pct: total ? Math.round(promoters/total*100) : 0, icon: '😍', bg: 'bg-green-500/30' },
            { label: 'Passives (محايدون)', value: passives, pct: total ? Math.round(passives/total*100) : 0, icon: '😐', bg: 'bg-yellow-500/30' },
            { label: 'Detractors (ناقدون)', value: detractors, pct: total ? Math.round(detractors/total*100) : 0, icon: '😞', bg: 'bg-red-500/30' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
              <div className="text-2xl font-black">{s.value} <span className="text-base font-bold">({s.pct}%)</span></div>
              <div className="text-xs text-white/80">{s.icon} {s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* NPS Scale */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
        <h3 className="font-bold text-gray-800 mb-3">مقياس NPS</h3>
        <div className="relative h-8 rounded-full overflow-hidden flex">
          <div className="bg-red-400" style={{ width: '30%' }} />
          <div className="bg-orange-300" style={{ width: '20%' }} />
          <div className="bg-yellow-300" style={{ width: '20%' }} />
          <div className="bg-lime-400" style={{ width: '15%' }} />
          <div className="bg-green-500" style={{ width: '15%' }} />
        </div>
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>-100</span><span className="text-red-500 font-bold">-50</span><span>0</span><span className="text-yellow-600 font-bold">30</span><span className="text-green-600 font-bold">50</span><span>100</span>
        </div>
        {/* Indicator */}
        <div className="relative mt-1" style={{ height: '16px' }}>
          <div className="absolute transform -translate-x-1/2" style={{ left: `${Math.min(Math.max((nps + 100) / 2, 2), 98)}%`, top: 0 }}>
            <div className="w-0 h-0 border-l-4 border-r-4 border-b-8 border-l-transparent border-r-transparent border-b-gray-800 mx-auto" />
            <div className={`text-xs font-black text-center mt-0.5 ${npsColor}`}>{nps}</div>
          </div>
        </div>
        <div className="flex justify-between text-xs text-gray-400 mt-2">
          <span className="text-red-500">سيء جداً</span>
          <span className="text-orange-500">سيء</span>
          <span className="text-yellow-600">مقبول</span>
          <span className="text-lime-600">جيد</span>
          <span className="text-green-600">ممتاز</span>
        </div>
      </div>

      {/* Filters + Stats */}
      <div className="flex flex-wrap gap-3 items-center">
        <select value={period} onChange={e => setPeriod(e.target.value as any)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
          <option value="month">آخر 30 يوم</option>
          <option value="quarter">آخر 3 أشهر</option>
          <option value="year">آخر سنة</option>
        </select>
        <select value={selectedCourse} onChange={e => setSelectedCourse(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
          <option value="all">كل الكورسات</option>
          {courses.slice(0, 20).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <div className="mr-auto flex items-center gap-2 text-sm text-gray-500">
          <Users size={14} /> {total} مشترك محلل
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 6-Month Trend */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><TrendingUp size={16} className="text-indigo-500" /> اتجاه NPS (6 أشهر)</h3>
          <div className="flex items-end gap-2" style={{ height: 120 }}>
            {trend.map((t, i) => {
              const height = Math.abs(t.nps) / trendMax * 100;
              const isPositive = t.nps >= 0;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="text-xs font-bold" style={{ color: isPositive ? '#22c55e' : '#ef4444' }}>{t.nps}</div>
                  <div className="w-full rounded-t relative" style={{ height: `${Math.max(height, 4)}%`, background: isPositive ? '#22c55e' : '#ef4444', minHeight: 4 }} />
                  <div className="text-xs text-gray-400">{t.label}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Satisfaction breakdown */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><Star size={16} className="text-amber-500" /> معدل الرضا: {satisfaction}/5</h3>
          <div className="flex items-center gap-2 mb-4">
            {[1,2,3,4,5].map(s => (
              <Star key={s} size={28} fill={s <= satisfaction ? '#f59e0b' : 'none'} color={s <= satisfaction ? '#f59e0b' : '#d1d5db'} />
            ))}
            <span className="text-2xl font-black text-amber-600 mr-1">{satisfaction}</span>
          </div>
          <div className="space-y-2">
            {[
              { label: 'Promoters', value: promoters, total, color: 'bg-green-500', textColor: 'text-green-700' },
              { label: 'Passives', value: passives, total, color: 'bg-yellow-400', textColor: 'text-yellow-700' },
              { label: 'Detractors', value: detractors, total, color: 'bg-red-400', textColor: 'text-red-700' },
            ].map(row => (
              <div key={row.label} className="flex items-center gap-2">
                <span className="text-xs w-20 text-gray-500">{row.label}</span>
                <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${row.color}`} style={{ width: row.total > 0 ? `${Math.round(row.value / row.total * 100)}%` : '0%' }} />
                </div>
                <span className={`text-xs font-bold w-16 text-right ${row.textColor}`}>
                  {row.value} ({row.total > 0 ? Math.round(row.value / row.total * 100) : 0}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* By Course */}
      {courseBreakdown.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Award size={16} className="text-indigo-500" /> NPS حسب الكورس</h3>
          <div className="space-y-3">
            {courseBreakdown.map((b, i) => {
              const npsCol = b.nps >= 50 ? '#22c55e' : b.nps >= 20 ? '#eab308' : b.nps >= 0 ? '#f97316' : '#ef4444';
              return (
                <div key={b.course.id} className="flex items-center gap-3">
                  <span className="text-sm font-bold text-gray-400 w-5">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between mb-0.5">
                      <span className="text-sm font-medium text-gray-800 truncate">{b.course.title}</span>
                      <span className="text-xs text-gray-400 shrink-0 mr-2">{b.count} مشترك</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(Math.max((b.nps + 100) / 2, 0), 100)}%`, background: npsCol }} />
                    </div>
                  </div>
                  <span className="text-sm font-black w-10 text-right" style={{ color: npsCol }}>{b.nps}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Benchmarks */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4">
        <h3 className="font-bold text-indigo-800 mb-3 text-sm">🏆 معايير NPS العالمية (قطاع التعليم)</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-sm">
          {[
            { range: '> 70', label: 'ممتاز', color: 'text-green-700' },
            { range: '50-70', label: 'جيد جداً', color: 'text-lime-700' },
            { range: '30-50', label: 'جيد', color: 'text-yellow-700' },
            { range: '< 30', label: 'يحتاج تحسين', color: 'text-red-600' },
          ].map(b => (
            <div key={b.range} className="bg-white rounded-xl p-2 shadow-sm">
              <div className={`text-lg font-black ${b.color}`}>{b.range}</div>
              <div className="text-xs text-gray-500">{b.label}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-indigo-600 mt-3">💡 متوسط NPS في قطاع التعليم الإلكتروني عالمياً: 45-55. الأفضل في الفئة: +70</p>
      </div>
    </div>
  );
};

export default NpsDashboardTab;
