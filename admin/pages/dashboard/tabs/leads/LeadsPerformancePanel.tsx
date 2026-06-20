import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, BarChart2, Phone, RefreshCw, Star, TrendingUp, Users,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, PieChart, Pie, Cell,
} from 'recharts';
import { useSiteData } from '../../../../context/SiteDataContext';
import type { LeadStatus, SalesTarget } from '../../../../types';
import { ScoreBadge, crmStatusLabels, LEAD_STATUS_CFG } from './LeadSubcomponents';
import { calcLeadScore, PIE_COLORS } from '../leadUtils';
import type { NotifyFn } from '../CrmSettingsModal';

interface Props {
  notify: NotifyFn;
}

export function LeadsPerformancePanel({ notify }: Props) {
  const { leads, staffMembers, subscribers, updateLead } = useSiteData();
  const navigate = useNavigate();

  const salesReps = useMemo(() =>
    staffMembers.filter(s => (s.role || '').toLowerCase() === 'sales' && s.status === 'active'),
    [staffMembers]
  );

  const [targetMonth, setTargetMonth] = useState(new Date().toISOString().slice(0, 7));
  const [salesTargets, setSalesTargets] = useState<SalesTarget[]>(() => {
    try { return JSON.parse(localStorage.getItem('crm.salesTargets') || '[]'); } catch { return []; }
  });
  const [smartIdleDays, setSmartIdleDays] = useState(7);
  const [distributing, setDistributing] = useState(false);

  const saveSalesTargets = (targets: SalesTarget[]) => {
    setSalesTargets(targets);
    localStorage.setItem('crm.salesTargets', JSON.stringify(targets));
  };

  const today = new Date().toISOString().slice(0, 10);
  const totalConverted = leads.filter(l => l.status === 'converted').length;
  const overdueLeads = leads.filter(l => !l.hidden && l.nextFollowUpDate && l.nextFollowUpDate <= today && !['converted', 'lost'].includes(l.status));
  const scoredLeads = leads.filter(l => !l.hidden && !['converted','lost'].includes(l.status)).map(l => ({ ...l, _score: calcLeadScore(l) }));

  const weeklyScorecard = useMemo(() => {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);
    return salesReps.map(rep => {
      const repLeads = leads.filter(l => l.assignedSalesId === rep.id);
      const weekComms = repLeads.flatMap(l =>
        (l.communications || []).filter(c => (c.date || '').slice(0, 10) >= weekAgo)
      );
      const calls    = weekComms.filter(c => c.type === 'call').length;
      const wa       = weekComms.filter(c => c.type === 'whatsapp').length;
      const meetings = weekComms.filter(c => c.type === 'meeting').length;
      const totalComms = weekComms.length;
      // Follow-ups completed: leads whose nextFollowUpDate fell in the last 7 days and have a comm in that period
      const followupsDone = repLeads.filter(l => {
        const nfd = l.nextFollowUpDate || '';
        if (!nfd || nfd < weekAgo || nfd > todayStr) return false;
        return (l.communications || []).some(c => (c.date || '').slice(0, 10) >= nfd);
      }).length;
      // New leads this week
      const newLeadsThisWeek = repLeads.filter(l => (l.createdAt || '').slice(0, 10) >= weekAgo).length;
      // Overdue (not contacted & follow-up date passed)
      const overdueOwn = repLeads.filter(l =>
        l.nextFollowUpDate && l.nextFollowUpDate < todayStr && !['converted','lost'].includes(l.status)
      ).length;
      return { rep, calls, wa, meetings, totalComms, followupsDone, newLeadsThisWeek, overdueOwn };
    });
  }, [salesReps, leads]);
  const smartRedistCandidates = useMemo(() => {
    const repLoadMap = new Map(
      salesReps.map(r => [
        r.id,
        leads.filter(l => l.assignedSalesId === r.id && !['converted','lost','not_interested_hidden'].includes(l.status)).length,
      ])
    );
    return leads
      .filter(l =>
        !l.hidden &&
        l.assignedSalesId &&
        !['converted','lost','not_interested_hidden','wrong_number'].includes(l.status)
      )
      .map(l => {
        const sorted = [...(l.communications || [])].sort((a, b) => b.date.localeCompare(a.date));
        const lastDate = (sorted[0]?.date || l.createdAt || '').slice(0, 10);
        const daysSilent = lastDate
          ? Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000)
          : 999;
        return { lead: l, daysSilent, lastDate };
      })
      .filter(x => x.daysSilent >= smartIdleDays)
      .map(x => {
        const currentRepId = x.lead.assignedSalesId!;
        const currentRep   = salesReps.find(r => r.id === currentRepId);
        // Suggest least-loaded OTHER rep
        const suggestedRep = salesReps
          .filter(r => r.id !== currentRepId)
          .sort((a, b) => (repLoadMap.get(a.id) || 0) - (repLoadMap.get(b.id) || 0))[0];
        return { ...x, currentRep, suggestedRep };
      })
      .sort((a, b) => b.daysSilent - a.daysSilent)
      .slice(0, 50);
  }, [leads, salesReps, smartIdleDays]);
  const salesPerformance = useMemo(() => salesReps.map(rep => {
    const repLeads = leads.filter(l => l.assignedSalesId === rep.id);
    const converted = repLeads.filter(l => l.status === 'converted').length;
    const convPct = repLeads.length > 0 ? Math.round((converted / repLeads.length) * 100) : 0;
    const repSubs = subscribers.filter(s => s.assignedSalesId === rep.id);
    const toEGP = (amt: number, cur: string) => cur === 'EGP' ? amt : cur === 'SAR' ? amt * 13 : amt * 50;
    const revenue = repSubs
      .flatMap(s => s.paymentHistory || [])
      .filter(p => p.at.startsWith(targetMonth))
      .reduce((sum, p) => sum + toEGP(p.amount, p.currency), 0);
    const avgScore = repLeads.length > 0
      ? Math.round(repLeads.reduce((s, l) => s + calcLeadScore(l), 0) / repLeads.length)
      : 0;
    const target = salesTargets.find(t => t.staffId === rep.id && t.month === targetMonth);
    return { rep, leads: repLeads.length, converted, convPct, revenue, avgScore, targetEGP: target?.targetEGP || 0 };
  }), [salesReps, leads, subscribers, salesTargets, targetMonth]);
  const monthlyTrend = useMemo(() => {
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      months.push(d.toISOString().slice(0, 7));
    }
    return months.map(m => ({
      month: m.slice(5) + '/' + m.slice(2, 4),
      'ليدز': leads.filter(l => (l.createdAt || '').slice(0, 7) === m).length,
      'محوّل': leads.filter(l => (l.createdAt || '').slice(0, 7) === m && l.status === 'converted').length,
    }));
  }, [leads]);
  const funnelData = useMemo(() => [
    { name: 'وارد جديد',  value: leads.filter(l => l.status === 'new' && !l.hidden).length,          color: '#6366f1' },
    { name: 'تم التواصل', value: leads.filter(l => l.status === 'contacted' && !l.hidden).length,    color: '#8b5cf6' },
    { name: 'مهتم',       value: leads.filter(l => l.status === 'interested' && !l.hidden).length,   color: '#a78bfa' },
    { name: 'مغلق/لا يرد', value: leads.filter(l => ['closed', 'no_answer'].includes(l.status) && !l.hidden).length, color: '#f59e0b' },
    { name: 'محوّل',     value: leads.filter(l => l.status === 'converted').length,                  color: '#10b981' },
  ], [leads]);
  const sourcesData = useMemo(() => {
    const counts: Record<string, number> = {};
    leads.filter(l => !l.hidden).forEach(l => {
      const s = l.source || 'غير محدد';
      counts[s] = (counts[s] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [leads]);
  const commsByRep = useMemo(() => salesReps.map(rep => {
    const comms = leads.filter(l => l.assignedSalesId === rep.id).flatMap(l => l.communications || []);
    return {
      name: rep.name.split(' ')[0],
      'مكالمة': comms.filter(c => c.type === 'call').length,
      'واتساب': comms.filter(c => c.type === 'whatsapp').length,
      'اجتماع': comms.filter(c => c.type === 'meeting').length,
    };
  }), [salesReps, leads]);
  const handleDistribute = async () => {
    if (salesReps.length === 0) return notify('error', 'لا يوجد مندوبو مبيعات');
    setDistributing(true);
    try {
      const validRepIds = new Set(salesReps.map(r => r.id));
      // Include unassigned leads AND leads assigned to reps no longer active
      const toAssign = leads.filter(l =>
        !l.hidden && !['converted', 'lost'].includes(l.status) &&
        (!l.assignedSalesId || !validRepIds.has(l.assignedSalesId))
      );
      if (toAssign.length === 0) return notify('info', 'جميع الليدز النشطة لديها مندوب مُعيَّن');
      const updates = toAssign.map((lead, i) => {
        const rep = salesReps[i % salesReps.length];
        return { ...lead, assignedSalesId: rep.id, assignedSalesName: rep.name };
      });
      for (const u of updates) await updateLead(u);
      notify('success', `تم توزيع ${toAssign.length} ليد على ${salesReps.length} مندوب بالتساوي`);
    } finally {
      setDistributing(false);
    }
  };
  return (
    <>
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
        <div className="space-y-5">
          {/* ── Section Divider: Analytics ── */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="flex items-center gap-1.5 text-sm font-bold text-gray-500 px-2">
              <BarChart2 size={14} className="text-violet-500" />
              الرسوم والإحصائيات
            </span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'إجمالي الليدز', val: leads.filter(l => !l.hidden).length, sub: 'نشط', accent: 'bg-indigo-500' },
              { label: 'معدل التحويل', val: leads.filter(l => !l.hidden).length > 0 ? `${Math.round(totalConverted / leads.filter(l => !l.hidden).length * 100)}%` : '0%', sub: `${totalConverted} محوّل`, accent: 'bg-emerald-500' },
              { label: 'إجمالي التواصلات', val: leads.reduce((s, l) => s + (l.communications?.length || 0), 0), sub: 'مكالمة + واتساب + لقاء', accent: 'bg-violet-500' },
              { label: 'ليدز هذا الشهر', val: leads.filter(l => (l.createdAt || '').startsWith(new Date().toISOString().slice(0, 7))).length, sub: 'جديدة هذا الشهر', accent: 'bg-amber-500' },
            ].map(c => (
              <div key={c.label} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                <div className={`w-8 h-1 ${c.accent} rounded-full mb-3`} />
                <p className="text-2xl font-extrabold text-gray-900">{c.val}</p>
                <p className="text-sm font-bold text-gray-700 mt-0.5">{c.label}</p>
                <p className="text-xs text-gray-400">{c.sub}</p>
              </div>
            ))}
          </div>

          {/* Monthly trend + Funnel */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                <BarChart2 size={16} className="text-indigo-600" /> ليدز شهرياً (آخر 6 أشهر)
              </h4>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={monthlyTrend} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="ليدز" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={32} />
                  <Bar dataKey="محوّل" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={32} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                <TrendingUp size={16} className="text-violet-600" /> قمع المبيعات
              </h4>
              <div className="space-y-2.5">
                {funnelData.map(item => {
                  const maxVal = Math.max(...funnelData.map(d => d.value), 1);
                  const pct = Math.round((item.value / maxVal) * 100);
                  return (
                    <div key={item.name} className="flex items-center gap-3">
                      <span className="text-xs text-gray-600 font-bold w-24 text-left flex-shrink-0">{item.name}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-7 overflow-hidden">
                        <div className="h-full rounded-full flex items-center justify-end px-2.5 transition-all duration-500"
                          style={{ width: `${Math.max(pct, 8)}%`, backgroundColor: item.color }}>
                          <span className="text-white text-[10px] font-bold">{item.value}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Sources + Comms by rep */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                <Activity size={16} className="text-amber-600" /> مصادر الليدز
              </h4>
              {sourcesData.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-16">لا توجد بيانات</p>
              ) : (
                <ResponsiveContainer width="100%" height={210}>
                  <PieChart>
                    <Pie data={sourcesData} cx="50%" cy="50%" outerRadius={72} innerRadius={32}
                      dataKey="value" label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                      labelLine={false}>
                      {sourcesData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                <Phone size={16} className="text-blue-600" /> تواصلات الفريق (نوع × مندوب)
              </h4>
              {commsByRep.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-16">لا يوجد بيانات</p>
              ) : (
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={commsByRep} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="مكالمة" stackId="a" fill="#6366f1" maxBarSize={36} />
                    <Bar dataKey="واتساب" stackId="a" fill="#10b981" maxBarSize={36} />
                    <Bar dataKey="اجتماع" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
    </>
  );
}
