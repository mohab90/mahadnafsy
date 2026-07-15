import { RefreshCw, Star, Users } from 'lucide-react';
import type { NavigateFunction } from 'react-router-dom';

import type { LeadItem, LeadStatus, SalesTarget, StaffMember } from '../../../../types';
import type { NotifyFn } from '../CrmSettingsModal';
import { calcLeadScore } from '../leadUtils';
import { LEAD_STATUS_CFG, ScoreBadge, crmStatusLabels } from './LeadSubcomponents';

type SalesPerformanceRow = {
  rep: StaffMember;
  leads: number;
  converted: number;
  convPct: number;
  revenue: number;
  avgScore: number;
  targetEGP: number;
};

type WeeklyScorecardRow = {
  rep: StaffMember;
  calls: number;
  wa: number;
  meetings: number;
  totalComms: number;
  followupsDone: number;
  newLeadsThisWeek: number;
  overdueOwn: number;
};

type SmartRedistributionCandidate = {
  lead: LeadItem;
  daysSilent: number;
  currentRep?: StaffMember;
  suggestedRep?: StaffMember;
};

type ScoredLead = LeadItem & { _score: number };

type LeadPerformanceOverviewProps = {
  targetMonth: string;
  setTargetMonth: (value: string) => void;
  salesReps: StaffMember[];
  handleDistribute: () => void | Promise<void>;
  distributing: boolean;
  leads: LeadItem[];
  salesPerformance: SalesPerformanceRow[];
  salesTargets: SalesTarget[];
  saveSalesTargets: (targets: SalesTarget[]) => void;
  weeklyScorecard: WeeklyScorecardRow[];
  smartIdleDays: number;
  setSmartIdleDays: (value: number) => void;
  smartRedistCandidates: SmartRedistributionCandidate[];
  updateLead: (lead: LeadItem) => void | Promise<void>;
  notify: NotifyFn;
  navigate: NavigateFunction;
  scoredLeads: ScoredLead[];
  totalConverted: number;
  overdueLeads: LeadItem[];
};

export function LeadPerformanceOverview({
  targetMonth,
  setTargetMonth,
  salesReps,
  handleDistribute,
  distributing,
  leads,
  salesPerformance,
  salesTargets,
  saveSalesTargets,
  weeklyScorecard,
  smartIdleDays,
  setSmartIdleDays,
  smartRedistCandidates,
  updateLead,
  notify,
  navigate,
  scoredLeads,
  totalConverted,
  overdueLeads,
}: LeadPerformanceOverviewProps) {
  return (
    <div className="space-y-6">
      {/* ── Header row: month filter + distribute ── */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-bold text-gray-700">الشهر:</label>
        <input type="month" value={targetMonth} onChange={e => setTargetMonth(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm" />
        {salesReps.length > 0 && (
          <button onClick={handleDistribute} disabled={distributing}
            className="mr-auto flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-60">
            {distributing
              ? <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              : <Users size={15} />}
            توزيع الليدز غير المعيّنة
          </button>
        )}
      </div>

      {/* ═══ CONVERSION FUNNEL ═══ */}
      <section className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg">🔽</span>
          <h3 className="font-extrabold text-gray-800">قمع التحويل — كل الليدز</h3>
        </div>
        {(() => {
          const allActive = leads.filter(l => !l.hidden);
          const stages = [
            { key: 'new',                  label: 'جديد',          color: 'bg-slate-400',   textColor: 'text-slate-700' },
            { key: 'contacted',            label: 'تم التواصل',    color: 'bg-blue-400',    textColor: 'text-blue-700' },
            { key: 'interested_followup',  label: 'مهتم/متابعة',  color: 'bg-indigo-400',  textColor: 'text-indigo-700' },
            { key: 'interested_booking',   label: 'حجز موعد',      color: 'bg-violet-400',  textColor: 'text-violet-700' },
            { key: 'converted',            label: 'محوّل',         color: 'bg-emerald-500', textColor: 'text-emerald-700' },
          ];
          const counts = stages.map(s => ({
            ...s,
            count: allActive.filter(l => l.status === s.key || (s.key === 'interested_followup' && ['interested_followup','interested_booking','negotiating','proposal_sent'].includes(l.status))).length,
          }));
          const maxCount = Math.max(...counts.map(s => s.count), 1);
          return (
            <div className="space-y-2">
              {counts.map((s, i) => {
                const pct = Math.round((s.count / (counts[0].count || 1)) * 100);
                const barW = Math.round((s.count / maxCount) * 100);
                const dropPct = i > 0 && counts[i - 1].count > 0
                  ? Math.round((1 - s.count / counts[i - 1].count) * 100)
                  : null;
                return (
                  <div key={s.key} className="flex items-center gap-3">
                    <span className={`text-xs font-bold w-24 text-right flex-shrink-0 ${s.textColor}`}>{s.label}</span>
                    <div className="flex-1 h-8 bg-gray-100 rounded-xl overflow-hidden relative">
                      <div className={`h-full ${s.color} rounded-xl transition-all duration-700 flex items-center px-3`}
                        style={{ width: `${barW}%`, minWidth: s.count > 0 ? '40px' : '0' }}>
                        <span className="text-white font-extrabold text-xs">{s.count > 0 ? s.count : ''}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 w-24">
                      <span className={`text-xs font-bold ${s.textColor}`}>{pct}%</span>
                      {dropPct !== null && dropPct > 0 && (
                        <span className="text-[10px] text-red-500 font-bold">↓{dropPct}%</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </section>

      {/* ═══ PER-REP CONVERSION BAR CHART ═══ */}
      {salesReps.length > 0 && (
        <section className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">📊</span>
            <h3 className="font-extrabold text-gray-800">نسبة التحويل لكل مندوب</h3>
            <span className="text-xs text-gray-400 mr-auto">كل الوقت</span>
          </div>
          <div className="space-y-3">
            {salesPerformance
              .slice()
              .sort((a, b) => b.convPct - a.convPct)
              .map(({ rep, leads: rl, converted, convPct, revenue }, idx) => {
                const medals = ['🥇', '🥈', '🥉'];
                const medal = idx < 3 ? medals[idx] : `#${idx + 1}`;
                const barColor = convPct >= 30 ? 'bg-emerald-500' : convPct >= 15 ? 'bg-amber-500' : 'bg-red-400';
                return (
                  <div key={rep.id} className="flex items-center gap-3">
                    <span className="text-base w-7 text-center flex-shrink-0">{medal}</span>
                    <span className="text-xs font-bold text-gray-800 w-24 flex-shrink-0 truncate">{rep.name.split(' ')[0]}</span>
                    <div className="flex-1 h-6 bg-gray-100 rounded-xl overflow-hidden">
                      <div className={`h-full ${barColor} rounded-xl transition-all duration-700 flex items-center px-2`}
                        style={{ width: `${Math.max(convPct, 2)}%`, maxWidth: '100%' }}>
                        <span className="text-white text-[10px] font-extrabold whitespace-nowrap">{convPct > 8 ? `${convPct}%` : ''}</span>
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-right w-28 text-xs text-gray-500">
                      <span className={`font-extrabold ${convPct >= 30 ? 'text-emerald-600' : convPct >= 15 ? 'text-amber-600' : 'text-red-500'}`}>{convPct}%</span>
                      <span className="text-gray-400"> ({converted}/{rl})</span>
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      )}

      {/* ═══ FEATURE 1: لوحة أهداف شهرية ═══ */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🎯</span>
          <h3 className="font-extrabold text-gray-800">لوحة الأهداف الشهرية — {targetMonth}</h3>
          <span className="text-xs text-gray-400 mr-auto">الهدف بالجنيه المصري · اضغط لتعديله</span>
        </div>
        {salesPerformance.length === 0
          ? <p className="text-gray-400 text-sm text-center py-8">لا يوجد مندوبو مبيعات مسجلون</p>
          : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {[...salesPerformance].sort((a, b) => b.revenue - a.revenue).map(({ rep, leads: rl, converted, convPct, revenue, avgScore, targetEGP }, rankIdx) => {
              const rankBadge = rankIdx === 0 ? '🥇' : rankIdx === 1 ? '🥈' : rankIdx === 2 ? '🥉' : `#${rankIdx + 1}`;
              const achPct = targetEGP > 0 ? Math.min(Math.round((revenue / targetEGP) * 100), 150) : null;
              const barGrad = achPct === null ? 'bg-gray-200'
                : achPct >= 100 ? 'bg-gradient-to-r from-emerald-400 to-emerald-600'
                : achPct >= 60  ? 'bg-gradient-to-r from-amber-400 to-orange-500'
                :                 'bg-gradient-to-r from-red-400 to-red-600';
              const statusColor = achPct === null ? 'text-gray-400'
                : achPct >= 100 ? 'text-emerald-700' : achPct >= 60 ? 'text-amber-700' : 'text-red-600';
              const statusLabel = achPct === null ? 'لا هدف' : achPct >= 100 ? '🏆 تجاوز الهدف!' : achPct >= 60 ? '⚡ على المسار' : '⚠️ دون الهدف';
              return (
                <div key={rep.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden hover:shadow-md transition">
                  {/* Card header */}
                  <div className={`h-1.5 w-full ${barGrad}`} />
                  <div className="p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-extrabold text-sm flex-shrink-0 relative">
                        {rep.name.charAt(0)}
                        <span className="absolute -top-1 -right-1 text-sm leading-none">{rankBadge}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-extrabold text-gray-900 text-sm truncate">{rep.name}</p>
                        <p className={`text-xs font-bold ${statusColor}`}>{statusLabel}</p>
                      </div>
                      {achPct !== null && (
                        <div className={`text-2xl font-extrabold ${statusColor} flex-shrink-0`}>{achPct}%</div>
                      )}
                    </div>

                    {/* Progress bar */}
                    <div className="mb-3">
                      <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-700 ${barGrad}`}
                          style={{ width: `${Math.min(achPct ?? 0, 100)}%` }} />
                      </div>
                      <div className="flex justify-between mt-1 text-[10px] text-gray-400">
                        <span>{revenue.toLocaleString()} ج.م محصّل</span>
                        <span>الهدف: {targetEGP > 0 ? targetEGP.toLocaleString() : '—'} ج.م</span>
                      </div>
                    </div>

                    {/* Stat grid */}
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {[
                        { label: 'الليدز', val: rl, icon: '👥' },
                        { label: 'محوّل', val: converted, icon: '✅' },
                        { label: 'نسبة التحويل', val: `${convPct}%`, icon: '📈' },
                      ].map(s => (
                        <div key={s.label} className="bg-gray-50 rounded-xl p-2 text-center">
                          <div className="text-base leading-none mb-0.5">{s.icon}</div>
                          <div className="text-sm font-extrabold text-gray-800">{s.val}</div>
                          <div className="text-[9px] text-gray-400">{s.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Target edit (admin) */}
                    <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                      <span className="text-[10px] text-gray-400 flex-shrink-0">🎯 الهدف:</span>
                      <input type="number" min={0} step={1000}
                        value={targetEGP || ''}
                        onChange={e => {
                          const val = +e.target.value;
                          const next = salesTargets.filter(t => !(t.staffId === rep.id && t.month === targetMonth));
                          if (val > 0) next.push({ staffId: rep.id, month: targetMonth, targetEGP: val });
                          saveSalesTargets(next);
                        }}
                        className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:border-primary-400 focus:outline-none"
                        placeholder="اكتب الهدف..." />
                      <span className="text-[10px] text-gray-400">ج.م</span>
                      <ScoreBadge score={avgScore} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ═══ FEATURE 3: سكوركارد أسبوعي ═══ */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">📊</span>
          <h3 className="font-extrabold text-gray-800">السكوركارد الأسبوعي — آخر 7 أيام</h3>
        </div>
        {weeklyScorecard.length === 0
          ? <p className="text-gray-400 text-sm text-center py-6">لا يوجد مندوبون</p>
          : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
              <thead>
                <tr className="bg-gradient-to-l from-indigo-50 to-white border-b border-gray-100 text-right">
                  <th className="py-3 px-4 font-bold text-gray-700 text-sm">المندوب</th>
                  <th className="py-3 px-3 font-bold text-gray-700 text-center text-xs">📞 مكالمات</th>
                  <th className="py-3 px-3 font-bold text-gray-700 text-center text-xs">💬 واتساب</th>
                  <th className="py-3 px-3 font-bold text-gray-700 text-center text-xs">🤝 لقاءات</th>
                  <th className="py-3 px-3 font-bold text-gray-700 text-center text-xs">📋 إجمالي تواصلات</th>
                  <th className="py-3 px-3 font-bold text-gray-700 text-center text-xs">✅ متابعات منجزة</th>
                  <th className="py-3 px-3 font-bold text-gray-700 text-center text-xs">🆕 ليدز جديدة</th>
                  <th className="py-3 px-3 font-bold text-gray-700 text-center text-xs">⚠️ متأخرة</th>
                </tr>
              </thead>
              <tbody>
                {weeklyScorecard.map(({ rep, calls, wa, meetings, totalComms, followupsDone, newLeadsThisWeek, overdueOwn }) => {
                  const activityScore = totalComms + followupsDone * 2;
                  const activityColor = activityScore >= 20 ? 'bg-emerald-100 text-emerald-800'
                    : activityScore >= 10 ? 'bg-amber-100 text-amber-800'
                    : 'bg-red-100 text-red-700';
                  return (
                    <tr key={rep.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                            {rep.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-bold text-gray-900 text-xs">{rep.name}</p>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${activityColor}`}>
                              نشاط: {activityScore} نقطة
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center"><span className="font-bold text-blue-700 text-sm">{calls}</span></td>
                      <td className="py-3 px-3 text-center"><span className="font-bold text-emerald-700 text-sm">{wa}</span></td>
                      <td className="py-3 px-3 text-center"><span className="font-bold text-orange-700 text-sm">{meetings}</span></td>
                      <td className="py-3 px-3 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${activityColor}`}>
                          {totalComms}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className={`font-bold text-sm ${followupsDone > 0 ? 'text-emerald-600' : 'text-gray-300'}`}>{followupsDone}</span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className={`font-bold text-sm ${newLeadsThisWeek > 0 ? 'text-indigo-600' : 'text-gray-300'}`}>{newLeadsThisWeek}</span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className={`font-bold text-sm ${overdueOwn > 0 ? 'text-red-600' : 'text-gray-300'}`}>{overdueOwn || '—'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ═══ FEATURE 4: إعادة توزيع ذكي ═══ */}
      <section>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <span className="text-lg">🔄</span>
          <h3 className="font-extrabold text-gray-800">مقترحات إعادة التوزيع الذكي</h3>
          <div className="flex items-center gap-2 mr-auto">
            <span className="text-xs text-gray-500">الليدز خاملة أكتر من</span>
            <input type="number" min={1} max={90} value={smartIdleDays}
              onChange={e => setSmartIdleDays(Math.max(1, +e.target.value))}
              className="w-14 border border-gray-200 rounded-lg px-2 py-1 text-xs text-center" />
            <span className="text-xs text-gray-500">يوم</span>
          </div>
          {smartRedistCandidates.length > 0 && (
            <span className="bg-orange-100 text-orange-700 border border-orange-200 text-xs font-bold px-2.5 py-1 rounded-full">
              {smartRedistCandidates.length} ليد تحتاج إعادة توزيع
            </span>
          )}
        </div>

        {smartRedistCandidates.length === 0 ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center">
            <div className="text-3xl mb-2">✅</div>
            <p className="text-emerald-700 font-bold text-sm">ممتاز! لا توجد ليدز خاملة تتجاوز {smartIdleDays} يوم</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-orange-50 border-b border-orange-100 text-right">
                    <th className="py-3 px-4 font-bold text-gray-700 text-xs">العميل المحتمل</th>
                    <th className="py-3 px-3 font-bold text-gray-700 text-xs">المندوب الحالي</th>
                    <th className="py-3 px-3 font-bold text-gray-700 text-xs text-center">أيام بدون تواصل</th>
                    <th className="py-3 px-3 font-bold text-gray-700 text-xs">المقترح</th>
                    <th className="py-3 px-3 font-bold text-gray-700 text-xs">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {smartRedistCandidates.map(({ lead, daysSilent, currentRep, suggestedRep }) => (
                    <tr key={lead.id} className="border-b border-gray-50 hover:bg-orange-50/30 transition">
                      <td className="py-2.5 px-4">
                        <p className="font-bold text-gray-900 text-xs">{lead.name}</p>
                        <p className="text-[10px] text-gray-400 font-mono">{lead.phone}</p>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${LEAD_STATUS_CFG[lead.status as LeadStatus]?.color || 'bg-gray-100 text-gray-500'}`}>
                          {crmStatusLabels[lead.status] || lead.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-xs text-gray-600 font-bold">{currentRep?.name || lead.assignedSalesName || '—'}</span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${
                          daysSilent >= 30 ? 'bg-red-100 text-red-700 border border-red-200'
                          : daysSilent >= 14 ? 'bg-orange-100 text-orange-700 border border-orange-200'
                          : 'bg-amber-100 text-amber-700 border border-amber-200'
                        }`}>
                          {daysSilent >= 30 ? '🔴' : daysSilent >= 14 ? '🟠' : '🟡'} {daysSilent} يوم
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        {suggestedRep
                          ? <span className="text-xs text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                              ⬇️ {suggestedRep.name}
                            </span>
                          : <span className="text-xs text-gray-400">—</span>
                        }
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5">
                          {suggestedRep && (
                            <button
                              onClick={() => {
                                updateLead({ ...lead, assignedSalesId: suggestedRep.id, assignedSalesName: suggestedRep.name });
                                notify('success', `تم تحويل ${lead.name} إلى ${suggestedRep.name}`);
                              }}
                              className="text-[10px] font-bold px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition flex items-center gap-1">
                              <RefreshCw size={10} /> تحويل
                            </button>
                          )}
                          <button
                            onClick={() => navigate(`/client/${lead.clientCode || lead.id}`)}
                            className="text-[10px] font-bold px-2.5 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition">
                            عرض
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* ── Score distribution (kept) ── */}
      <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
          <Star size={16} className="text-amber-500" />توزيع سكور الليدز النشطة
        </h4>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'سكور عالي (70+)', count: scoredLeads.filter(l => l._score >= 70 && !['converted','lost'].includes(l.status)).length, color: 'bg-emerald-500' },
            { label: 'متوسط (40–69)',   count: scoredLeads.filter(l => l._score >= 40 && l._score < 70 && !['converted','lost'].includes(l.status)).length, color: 'bg-amber-500' },
            { label: 'منخفض (<40)',     count: scoredLeads.filter(l => l._score < 40 && !['converted','lost'].includes(l.status)).length, color: 'bg-gray-400' },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className={`${s.color} text-white text-3xl font-extrabold rounded-2xl py-5 mb-2`}>{s.count}</div>
              <p className="text-xs text-gray-600 font-medium">{s.label}</p>
            </div>
          ))}
        </div>
      </article>

      {/* KPI overview cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'ليدز نشطة', val: leads.filter(l => !['converted','lost'].includes(l.status) && !l.hidden).length, color: 'bg-blue-50 text-blue-700 border-blue-200' },
          { label: 'محوّل لمشترك',  val: totalConverted, color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
          { label: 'تذكيرات متأخرة', val: overdueLeads.length, color: 'bg-red-50 text-red-700 border-red-200' },
          {
            label: 'متوسط السكور',
            val: leads.filter(l => !l.hidden).length > 0
              ? Math.round(leads.filter(l => !l.hidden).reduce((s, l) => s + calcLeadScore(l), 0) / leads.filter(l => !l.hidden).length)
              : 0,
            color: 'bg-violet-50 text-violet-700 border-violet-200',
          },
        ].map(c => (
          <div key={c.label} className={`${c.color} rounded-2xl p-4 border`}>
            <p className="text-xs opacity-70 mb-1">{c.label}</p>
            <p className="text-2xl font-extrabold">{c.val}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
