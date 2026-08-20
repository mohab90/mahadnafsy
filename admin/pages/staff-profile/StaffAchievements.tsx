import React, { useMemo } from 'react';
import { Award } from 'lucide-react';
import { fmtMoney, fmtNum, monthLabel, type StaffProfileData } from './types';

/**
 * "نجاحاته" — achievements derived from real recorded data, never stored or
 * hand-awarded, so the list can't drift from what actually happened. Each badge
 * states the evidence behind it.
 */
export default function StaffAchievements({ data }: { data: StaffProfileData }) {
  const badges = useMemo(() => {
    const { lifetime, timeline, rank, staff, today } = data;
    const out: { icon: string; title: string; detail: string; tone: string }[] = [];

    if (lifetime.firstSaleAt) {
      out.push({
        icon: '🎉', tone: 'bg-emerald-50 border-emerald-200 text-emerald-800',
        title: 'أول عملية بيع',
        detail: String(lifetime.firstSaleAt).slice(0, 10),
      });
    }
    if (lifetime.biggestSale > 0) {
      out.push({
        icon: '💎', tone: 'bg-violet-50 border-violet-200 text-violet-800',
        title: 'أكبر عملية بيع',
        detail: fmtMoney(lifetime.biggestSale),
      });
    }
    if (lifetime.bestMonth) {
      out.push({
        icon: '📈', tone: 'bg-indigo-50 border-indigo-200 text-indigo-800',
        title: 'أفضل شهر',
        detail: `${monthLabel(lifetime.bestMonth.ym)} — ${fmtMoney(lifetime.bestMonth.revenue)}`,
      });
    }
    if (rank.position === 1) {
      out.push({
        icon: '👑', tone: 'bg-amber-50 border-amber-200 text-amber-800',
        title: 'الأول على الفريق',
        detail: 'صاحب أعلى إيراد هذا الشهر',
      });
    } else if (rank.position && rank.position <= 3) {
      out.push({
        icon: '🏅', tone: 'bg-amber-50 border-amber-200 text-amber-800',
        title: `من أفضل 3 بالفريق`,
        detail: `المركز ${fmtNum(rank.position)} من ${fmtNum(rank.outOf)}`,
      });
    }

    // Target hit in the current month, using the same rule the HR report uses.
    const current = timeline[timeline.length - 1];
    if (current && staff.monthlyTarget > 0) {
      const progress = staff.monthlyTargetType === 'clients' ? current.converted : current.revenue;
      if (progress >= staff.monthlyTarget) {
        out.push({
          icon: '🎯', tone: 'bg-emerald-50 border-emerald-200 text-emerald-800',
          title: 'حقق تارجت الشهر',
          detail: staff.monthlyTargetType === 'clients'
            ? `${fmtNum(progress)} عميل من ${fmtNum(staff.monthlyTarget)}`
            : `${fmtMoney(progress)} من ${fmtMoney(staff.monthlyTarget)}`,
        });
      }
    }

    // Volume milestones — highest crossed threshold only, so the list stays short.
    const callTier = [5000, 2000, 1000, 500, 100].find(t => lifetime.calls >= t);
    if (callTier) {
      out.push({
        icon: '📞', tone: 'bg-cyan-50 border-cyan-200 text-cyan-800',
        title: `${fmtNum(callTier)}+ مكالمة`,
        detail: `${fmtNum(lifetime.calls)} مكالمة مسجلة`,
      });
    }
    const bookingTier = [500, 200, 100, 50, 10].find(t => lifetime.bookings >= t);
    if (bookingTier) {
      out.push({
        icon: '🧾', tone: 'bg-blue-50 border-blue-200 text-blue-800',
        title: `${fmtNum(bookingTier)}+ حجز`,
        detail: `${fmtNum(lifetime.bookings)} حجز إجمالي`,
      });
    }
    const revTier = [1000000, 500000, 250000, 100000, 50000].find(t => lifetime.revenue >= t);
    if (revTier) {
      out.push({
        icon: '💰', tone: 'bg-emerald-50 border-emerald-200 text-emerald-800',
        title: `تجاوز ${fmtMoney(revTier)}`,
        detail: `${fmtMoney(lifetime.revenue)} إجمالي محقق`,
      });
    }
    const convRate = lifetime.leads > 0 ? Math.round((lifetime.converted / lifetime.leads) * 100) : 0;
    if (convRate >= 20 && lifetime.leads >= 20) {
      out.push({
        icon: '⚡', tone: 'bg-rose-50 border-rose-200 text-rose-800',
        title: 'معدل تحويل مرتفع',
        detail: `${convRate}% من ${fmtNum(lifetime.leads)} ليد`,
      });
    }
    // Months with zero gaps since joining — consistency is worth surfacing.
    const activeMonths = timeline.filter(p => p.revenue > 0 || p.calls > 0 || p.bookings > 0).length;
    if (timeline.length >= 6 && activeMonths === timeline.length) {
      out.push({
        icon: '🔥', tone: 'bg-orange-50 border-orange-200 text-orange-800',
        title: 'نشاط متصل بدون توقف',
        detail: `${fmtNum(timeline.length)} شهر متتالٍ`,
      });
    }
    if (today.calls >= 20) {
      out.push({
        icon: '🚀', tone: 'bg-sky-50 border-sky-200 text-sky-800',
        title: 'يوم مكالمات قوي',
        detail: `${fmtNum(today.calls)} مكالمة اليوم`,
      });
    }
    return out;
  }, [data]);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 flex items-center gap-2 text-base font-bold text-gray-800">
        <Award size={17} className="text-emerald-600" /> النجاحات والإنجازات
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">{badges.length}</span>
      </h3>
      {badges.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">
          لا توجد إنجازات مسجّلة بعد — تظهر تلقائيًا مع أول عملية بيع أو نشاط مسجّل.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {badges.map(badge => (
            <div key={badge.title} className={`flex items-start gap-3 rounded-xl border p-3 ${badge.tone}`}>
              <span className="text-xl leading-none">{badge.icon}</span>
              <div className="min-w-0">
                <p className="text-sm font-bold leading-tight">{badge.title}</p>
                <p className="mt-0.5 text-[11px] opacity-80">{badge.detail}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
