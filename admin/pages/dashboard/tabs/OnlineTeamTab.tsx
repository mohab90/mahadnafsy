import React, { useMemo, useState, useEffect } from 'react';
import {
  Monitor, Users, CreditCard, AlertCircle, TrendingUp,
  BarChart3, Target, Calendar, Phone, 
  Wallet, Receipt, Trophy, Edit2, Save, X,
  Award, Headphones,
} from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type TimeRange = 'today' | '7d' | '30d' | 'month' | 'all';
type SubTab = 'overview' | 'online' | 'collection' | 'targets';

interface Props { notify: NotifyFn; }

const today = () => new Date().toISOString().slice(0, 10);
const month = () => new Date().toISOString().slice(0, 7);
const isOnlineBranch = (branch?: string) => ['ONLINE_EGYPT', 'ONLINE_SAUDI', 'ONLINE_ABROAD'].includes(String(branch || '').toUpperCase());

function getRangeStart(range: TimeRange): string {
  const d = new Date();
  if (range === 'today') return today();
  if (range === '7d') return new Date(+d - 7 * 86400000).toISOString().slice(0, 10);
  if (range === '30d') return new Date(+d - 30 * 86400000).toISOString().slice(0, 10);
  if (range === 'month') return `${month()}-01`;
  return '2000-01-01';
}

function inRange(dateStr: string | undefined, range: TimeRange): boolean {
  if (range === 'all') return true;
  const d = (dateStr || '').slice(0, 10);
  return d >= getRangeStart(range);
}

function pct(val: number, total: number) {
  return total === 0 ? 0 : Math.min(100, Math.round((val / total) * 100));
}

function fmtMoney(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}م` : n >= 1000 ? `${(n / 1000).toFixed(1)}ك` : String(n);
}

type CurrencyAmounts = Record<'EGP' | 'SAR' | 'USD', number>;
const emptyCurrencyAmounts = (): CurrencyAmounts => ({ EGP: 0, SAR: 0, USD: 0 });
const addCurrencyAmount = (amounts: CurrencyAmounts, currency: unknown, amount: unknown) => {
  const code = String(currency || 'EGP').toUpperCase() as keyof CurrencyAmounts;
  if (code in amounts) amounts[code] += Number(amount) || 0;
};
const formatCurrencyAmounts = (amounts: CurrencyAmounts) =>
  (Object.entries(amounts) as [keyof CurrencyAmounts, number][])
    .filter(([, amount]) => amount > 0)
    .map(([currency, amount]) => `${fmtMoney(amount)} ${currency}`)
    .join(' · ') || '—';

function getLast7Days() {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

const MOTIVATE_ONLINE = [
  'كل عميل راضٍ هو إنجاز حقيقي 💪',
  'خدمتك للعملاء تبني المعهد حجرة حجرة',
  'الاستجابة السريعة تفرق مع كل عميل',
  'اليوم فرصة جديدة لمساعدة عملاء أكثر',
];
const MOTIVATE_COLLECTION = [
  'كل قسط محصل هو نجاح للفريق كله 🎯',
  'المتابعة الجيدة هي سر التحصيل المثالي',
  'ثقتهم بك تزيد باستمرارك معهم',
  'التنظيم والتركيز يحققان النتائج',
];

interface StaffTargets { [staffId: string]: number }
type OnlinePayment = {
  subscriberId?: string | null;
  amount: number;
  amountEgp: number;
  at: string;
  branch?: string;
  isInstallment?: boolean;
  staffId?: string | null;
  status?: string;
};

// ── Progress Bar Component ────────────────────────────────────────────────
const ProgressBar: React.FC<{
  value: number; max: number; color?: string; height?: string; showPct?: boolean;
}> = ({ value, max, color = 'bg-teal-400', height = 'h-2.5', showPct = false }) => {
  const p = pct(value, max);
  const barColor = p >= 100 ? 'bg-green-500' : p >= 60 ? color : p >= 30 ? 'bg-yellow-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2 w-full">
      <div className={`flex-1 ${height} bg-gray-100 rounded-full overflow-hidden`}>
        <div
          className={`${barColor} h-full rounded-full transition-all duration-500`}
          style={{ width: `${p}%` }}
        />
      </div>
      {showPct && <span className="text-xs font-bold text-gray-500 w-8 text-left">{p}%</span>}
    </div>
  );
};

// ── Mini Bar Chart Component ──────────────────────────────────────────────
const MiniBarChart: React.FC<{
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
}> = ({ data, color = 'bg-teal-400', height = 40 }) => {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="flex items-end gap-1 w-full" style={{ height }}>
      {data.map((d, i) => {
        const h = Math.max(2, Math.round((d.value / max) * height));
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`${d.label}: ${d.value}`}>
            <div className={`w-full rounded-t-sm ${color} opacity-80 transition-all`} style={{ height: h }} />
          </div>
        );
      })}
    </div>
  );
};

// ── Staff Avatar ──────────────────────────────────────────────────────────

// ── Main Component ─────────────────────────────────────────────────────────
const OnlineTeamTab: React.FC<Props> = ({ notify }) => {
  const { staffMembers, subscribers } = useSiteData();
  const onlineSubscribers = useMemo(() => subscribers.filter(subscriber => isOnlineBranch(subscriber.branch)), [subscribers]);
  const [payments, setPayments] = useState<OnlinePayment[]>([]);

  const [timeRange, setTimeRange] = useState<TimeRange>('month');
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('overview');
  const [expandedStaff, setExpandedStaff] = useState<string | null>(null);
  const [targets, setTargets] = useState<StaffTargets>({});
  const [editingTargets, setEditingTargets] = useState<StaffTargets>({});
  const [editMode, setEditMode] = useState(false);

  // ── Teams ──────────────────────────────────────────────────────────────
  const onlineTeam = useMemo(() =>
    staffMembers.filter(s => s.role === 'support' && s.status === 'active'), [staffMembers]);
  const collectionTeam = useMemo(() =>
    staffMembers.filter(s => s.role === 'collection' && s.status === 'active'), [staffMembers]);

  useEffect(() => {
    mysqlAdmin.listSalesTargets(month()).then((rows) => {
      const next: StaffTargets = {};
      rows.forEach((row) => {
        const staffId = String(row.staffId || '');
        const role = staffMembers.find((staff) => staff.id === staffId)?.role;
        next[staffId] = Number(role === 'collection' ? row.revenueTarget : row.leadsTarget) || 0;
      });
      setTargets(next);
    }).catch(() => notify('error', 'تعذر تحميل أهداف فريق الأونلاين والتحصيل'));
  }, [staffMembers, notify]);
  useEffect(() => {
    const start = timeRange === 'all' ? undefined : getRangeStart(timeRange);
    mysqlAdmin.getPayments(start, today()).then(rows => {
      setPayments(rows.map(row => ({
        subscriberId: row.subscriberId ? String(row.subscriberId) : row.subscriber_id ? String(row.subscriber_id) : null,
        amount: Number(row.amount || 0),
        amountEgp: Number(row.amountEgp ?? row.amount_egp ?? 0),
        at: String(row.at || ''),
        branch: String(row.branch || ''),
        isInstallment: Boolean(row.isInstallment ?? row.is_installment),
        staffId: row.staffId ? String(row.staffId) : row.staff_id ? String(row.staff_id) : null,
        status: String(row.status || 'paid'),
      })));
    }).catch(() => notify('error', 'تعذر تحميل حركة التحصيل الموحّدة'));
  }, [notify, timeRange]);

  // ── Filtered data ──────────────────────────────────────────────────────
  const filteredPayments = useMemo(() =>
    payments.filter(payment =>
      payment.status === 'paid' && isOnlineBranch(payment.branch) && inRange(payment.at, timeRange)
    ),
    [payments, timeRange]);

  const paidThisPeriod = filteredPayments.reduce((sum, payment) => sum + payment.amountEgp, 0);

  // ── Overdue installments ───────────────────────────────────────────────
  const { overdueInstallments, overdueByCurrency } = useMemo(() => {
    let overdueCount = 0;
    const overdue = emptyCurrencyAmounts();
    onlineSubscribers.forEach(s => {
      (s.installmentPlans || []).forEach(p => {
        (p.entries || []).forEach(e => {
          if (!e.paidAt && e.dueDate < today()) {
            overdueCount++;
            addCurrencyAmount(overdue, e.currency || p.currency, e.amount);
          }
        });
      });
    });
    return { overdueInstallments: overdueCount, overdueByCurrency: overdue };
  }, [onlineSubscribers]);

  // ── Weekly revenue chart ───────────────────────────────────────────────
  const last7Days = useMemo(() => getLast7Days(), []);
  const weeklyChartData = useMemo(() => last7Days.map(day => ({
    label: day.slice(5),
    value: payments.filter(payment =>
      payment.status === 'paid' && isOnlineBranch(payment.branch) && payment.at.slice(0, 10) === day
    ).reduce((sum, payment) => sum + payment.amountEgp, 0),
  })), [payments, last7Days]);

  const collectionChartData = useMemo(() => last7Days.map(day => ({
    label: day.slice(5),
    value: payments.filter(payment =>
      payment.status === 'paid' && payment.isInstallment && isOnlineBranch(payment.branch)
      && payment.at.slice(0, 10) === day
    ).reduce((sum, payment) => sum + payment.amountEgp, 0),
  })), [payments, last7Days]);

  // ── Per-online-staff stats ─────────────────────────────────────────────
  const onlineStats = useMemo(() =>
    onlineTeam.map(s => {
      const mySubs = onlineSubscribers.filter(sub => sub.assignedCsId === s.id || sub.assignedSalesId === s.id);
      const mySubscriberIds = new Set(mySubs.map(sub => sub.id));
      const myPayments = filteredPayments.filter(payment =>
        payment.subscriberId ? mySubscriberIds.has(payment.subscriberId) : payment.staffId === s.id
      );
      const revenue = myPayments.reduce((sum, payment) => sum + payment.amountEgp, 0);
      const myTarget = targets[s.id] || 0;
      return { staff: s, paymentsCount: myPayments.length, revenue, subsCount: mySubs.length, target: myTarget };
    }).sort((a, b) => b.subsCount - a.subsCount),
    [onlineTeam, filteredPayments, onlineSubscribers, targets]);

  // ── Per-collection-staff stats ────────────────────────────────────────
  const collectionStats = useMemo(() =>
    collectionTeam.map(s => {
      const mySubs = onlineSubscribers.filter(sub => sub.assignedCsId === s.id);
      const myOverdueEntries = mySubs.flatMap(sub =>
        (sub.installmentPlans || []).flatMap(p =>
          (p.entries || [])
            .filter(e => !e.paidAt && e.dueDate < today())
            .map(entry => ({ entry, currency: entry.currency || p.currency }))));
      const myOverdueByCurrency = emptyCurrencyAmounts();
      myOverdueEntries.forEach(({ entry, currency }) => addCurrencyAmount(myOverdueByCurrency, currency, entry.amount));
      const myCollected = filteredPayments.filter(payment => payment.staffId === s.id)
        .reduce((sum, payment) => sum + payment.amountEgp, 0);
      const myTarget = targets[s.id] || 0;
      const commissionEarned = myTarget > 0 ? Math.round(myCollected * ((s.commissionRate || 0) / 100)) : 0;
      return {
        staff: s, subsCount: mySubs.length,
        overdueCount: myOverdueEntries.length, overdueByCurrency: myOverdueByCurrency,
        collected: myCollected, target: myTarget, commissionEarned,
      };
    }).sort((a, b) => b.collected - a.collected),
    [collectionTeam, onlineSubscribers, filteredPayments, targets]);

  // ── Handlers ───────────────────────────────────────────────────────────
  const startEdit = () => {
    const init: StaffTargets = {};
    [...onlineTeam, ...collectionTeam].forEach(s => { init[s.id] = targets[s.id] || 0; });
    setEditingTargets(init);
    setEditMode(true);
  };
  const saveEdit = async () => {
    try {
      await Promise.all([
        ...onlineTeam.map((staff) => mysqlAdmin.saveSalesTarget({
          staffId: staff.id, period: month(), leadsTarget: editingTargets[staff.id] || 0,
        })),
        ...collectionTeam.map((staff) => mysqlAdmin.saveSalesTarget({
          staffId: staff.id, period: month(), revenueTarget: editingTargets[staff.id] || 0,
        })),
      ]);
      setTargets(editingTargets);
      setEditMode(false);
      notify('success', 'تم حفظ الأهداف في قاعدة البيانات');
    } catch {
      notify('error', 'تعذر حفظ بعض أهداف الفريق');
    }
  };
  const cancelEdit = () => setEditMode(false);

  const RANGE_OPTIONS: { key: TimeRange; label: string }[] = [
    { key: 'today', label: 'اليوم' },
    { key: '7d', label: '٧ أيام' },
    { key: 'month', label: 'الشهر' },
    { key: '30d', label: '٣٠ يوم' },
    { key: 'all', label: 'الكل' },
  ];

  const SUB_TABS: { key: SubTab; label: string; icon: React.ElementType }[] = [
    { key: 'overview', label: 'نظرة عامة', icon: BarChart3 },
    { key: 'online', label: 'فريق الأونلاين', icon: Monitor },
    { key: 'collection', label: 'فريق التحصيل', icon: Wallet },
    { key: 'targets', label: 'الأهداف', icon: Target },
  ];

  // ── Rank medal helper ──────────────────────────────────────────────────
  const medal = (i: number) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;

  return (
    <div className="space-y-5" dir="rtl">

      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="bg-gradient-to-l from-teal-700 to-cyan-600 rounded-2xl p-5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Headphones size={22} /> مركز الأونلاين والتحصيل
            </h2>
            <p className="text-teal-200 text-sm mt-0.5">
              الأونلاين ({onlineTeam.length}) · التحصيل ({collectionTeam.length}) · {month()}
            </p>
          </div>
          <div className="flex bg-white/10 rounded-xl overflow-hidden">
            {RANGE_OPTIONS.map(opt => (
              <button key={opt.key} onClick={() => setTimeRange(opt.key)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${timeRange === opt.key ? 'bg-white text-teal-700' : 'text-teal-100 hover:bg-white/10'}`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* KPI grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {[
            { label: 'فريق الأونلاين', value: onlineTeam.length, icon: Monitor, bg: 'bg-teal-500/30' },
            { label: 'فريق التحصيل', value: collectionTeam.length, icon: Wallet, bg: 'bg-cyan-500/30' },
            { label: 'أقساط متأخرة', value: overdueInstallments, icon: AlertCircle, bg: overdueInstallments > 0 ? 'bg-red-500/30' : 'bg-green-500/30' },
            { label: 'متحصل هذه الفترة', value: `${fmtMoney(paidThisPeriod)} ج`, icon: TrendingUp, bg: 'bg-white/15' },
          ].map(stat => (
            <div key={stat.label} className={`${stat.bg} rounded-xl p-3 flex items-center gap-2.5`}>
              <stat.icon size={18} className="opacity-80 shrink-0" />
              <div>
                <div className="text-lg font-bold leading-none">{stat.value}</div>
                <div className="text-xs text-teal-200 mt-0.5">{stat.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Sub-tabs nav ──────────────────────────────────────────── */}
      <div className="flex gap-2 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        {SUB_TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setActiveSubTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              activeSubTab === key ? 'bg-white shadow-sm text-teal-700 font-bold' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {/* ════════════════════ OVERVIEW ════════════════════ */}
      {activeSubTab === 'overview' && (
        <div className="space-y-5">

          {/* Stats cards row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'إجمالي محصل', value: fmtMoney(paidThisPeriod), sub: 'ج.م مكافئ — هذه الفترة', icon: Receipt, color: 'text-green-600', bg: 'bg-green-50' },
              { label: 'أقساط متأخرة', value: overdueInstallments, sub: formatCurrencyAmounts(overdueByCurrency), icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50' },
              { label: 'حركات تحصيل', value: filteredPayments.length, sub: 'دفعات مؤكدة', icon: CreditCard, color: 'text-cyan-600', bg: 'bg-cyan-50' },
              { label: 'عملاء نشطون', value: onlineSubscribers.filter(s => s.status === 'active').length, sub: 'أونلاين', icon: Users, color: 'text-teal-600', bg: 'bg-teal-50' },
            ].map(c => (
              <div key={c.label} className={`${c.bg} rounded-2xl p-4`}>
                <div className="flex items-start justify-between mb-1">
                  <c.icon size={18} className={`${c.color} opacity-70`} />
                </div>
                <div className={`text-2xl font-black ${c.color}`}>{c.value}</div>
                <div className="text-xs text-gray-500 mt-0.5">{c.label}</div>
                <div className="text-xs text-gray-400">{c.sub}</div>
              </div>
            ))}
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Weekly revenue chart */}
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-800 flex items-center gap-1.5">
                  <BarChart3 size={16} className="text-teal-500" /> إيرادات آخر ٧ أيام
                </h3>
                <span className="text-xs text-gray-400">{fmtMoney(weeklyChartData.reduce((s, d) => s + d.value, 0))} ج</span>
              </div>
              <MiniBarChart data={weeklyChartData} color="bg-teal-400" height={60} />
              <div className="flex justify-between mt-1.5">
                {weeklyChartData.map((d, i) => (
                  <div key={i} className="text-center" style={{ flex: 1 }}>
                    <div className="text-xs text-gray-400">{d.label.split('-')[1]}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Collection chart */}
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-800 flex items-center gap-1.5">
                  <CreditCard size={16} className="text-cyan-500" /> تحصيل أقساط آخر ٧ أيام
                </h3>
                <span className="text-xs text-gray-400">{fmtMoney(collectionChartData.reduce((s, d) => s + d.value, 0))} ج</span>
              </div>
              <MiniBarChart data={collectionChartData} color="bg-cyan-400" height={60} />
              <div className="flex justify-between mt-1.5">
                {collectionChartData.map((d, i) => (
                  <div key={i} className="text-center" style={{ flex: 1 }}>
                    <div className="text-xs text-gray-400">{d.label.split('-')[1]}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Quick team cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                <Monitor size={16} className="text-teal-500" />
                <span className="font-bold text-gray-800">فريق الأونلاين</span>
                <span className="mr-auto text-xs bg-teal-100 text-teal-600 px-2 py-0.5 rounded-full">{onlineTeam.length} موظف</span>
              </div>
              <div className="divide-y divide-gray-50">
                {onlineTeam.length === 0
                  ? <p className="p-6 text-center text-gray-400 text-sm">لا يوجد فريق أونلاين نشط</p>
                  : onlineStats.map((stat, idx) => {
                    return (
                      <div key={stat.staff.id} className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-mono text-gray-400 w-4">{medal(idx)}</span>
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-cyan-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
                            {stat.staff.name.slice(0, 2)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm text-gray-800">{stat.staff.name}</div>
                            {stat.target > 0 && (
                              <div className="mt-1 w-full">
                                <ProgressBar value={stat.subsCount} max={stat.target} color="bg-teal-400" showPct />
                              </div>
                            )}
                          </div>
                          <div className="text-right text-xs">
                            <span className="font-bold text-teal-600">{stat.subsCount}</span>
                            <span className="text-gray-400"> عميل</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                <Wallet size={16} className="text-cyan-500" />
                <span className="font-bold text-gray-800">فريق التحصيل</span>
                <span className="mr-auto text-xs bg-cyan-100 text-cyan-600 px-2 py-0.5 rounded-full">{collectionTeam.length} موظف</span>
              </div>
              <div className="divide-y divide-gray-50">
                {collectionTeam.length === 0
                  ? <p className="p-6 text-center text-gray-400 text-sm">لا يوجد فريق تحصيل نشط</p>
                  : collectionStats.map((stat, idx) => (
                    <div key={stat.staff.id} className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono text-gray-400 w-4">{medal(idx)}</span>
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
                          {stat.staff.name.slice(0, 2)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm text-gray-800">{stat.staff.name}</div>
                          {stat.target > 0 && (
                            <div className="mt-1 w-full">
                              <ProgressBar value={stat.collected} max={stat.target} color="bg-cyan-400" showPct />
                            </div>
                          )}
                        </div>
                        <div className="text-right text-xs">
                          <span className="font-bold text-cyan-600">{fmtMoney(stat.collected)}</span>
                          <span className="text-gray-400"> ج</span>
                          {stat.overdueCount > 0 && <div className="text-red-400">{stat.overdueCount} متأخر</div>}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          {/* Installment overview — currencies stay separate to avoid false totals. */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <Receipt size={17} className="text-amber-500" />
              <h3 className="font-bold text-gray-800">ملخص التحصيل والمتأخرات</h3>
            </div>
            <div className="flex flex-wrap justify-between gap-3 text-sm">
              <span className="text-green-600 font-medium">محصل: {fmtMoney(paidThisPeriod)} ج.م مكافئ</span>
              <span className="text-red-500 font-medium">متأخر: {formatCurrencyAmounts(overdueByCurrency)}</span>
            </div>
            <p className="text-xs text-gray-400 mt-2">المتأخرات معروضة بكل عملة منفصلة؛ لا يتم جمع عملات مختلفة في نسبة مضللة.</p>
          </div>
        </div>
      )}

      {/* ════════════════════ ONLINE TEAM ════════════════════ */}
      {activeSubTab === 'online' && (
        <div className="space-y-4">
          {/* Team summary bar */}
          <div className="bg-teal-50 border border-teal-200 rounded-2xl p-4 flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <Monitor size={18} className="text-teal-600" />
              <span className="font-bold text-teal-700">فريق الأونلاين ({onlineTeam.length})</span>
            </div>
            <div className="flex gap-4 text-sm text-gray-600">
              <span>إجمالي الدفعات: <strong>{onlineStats.reduce((s, x) => s + x.paymentsCount, 0)}</strong></span>
              <span>إجمالي العملاء: <strong>{onlineStats.reduce((s, x) => s + x.subsCount, 0)}</strong></span>
              <span>إجمالي الإيراد: <strong>{fmtMoney(onlineStats.reduce((s, x) => s + x.revenue, 0))} ج</strong></span>
            </div>
            <p className="text-xs text-teal-600 italic mr-auto hidden sm:block">
              {MOTIVATE_ONLINE[new Date().getDay() % MOTIVATE_ONLINE.length]}
            </p>
          </div>

          {onlineStats.length === 0 ? (
            <div className="py-16 text-center text-gray-400">
              <Monitor size={48} className="mx-auto mb-3 opacity-30" />
              <p>لا يوجد موظفين بدور "خدمة عملاء" نشطين</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {onlineStats.map((stat, idx) => {
                const hasTarget = stat.target > 0;
                const progress = hasTarget ? pct(stat.subsCount, stat.target) : 0;
                const achieved = hasTarget && progress >= 100;
                return (
                  <div key={stat.staff.id}
                    className={`bg-white border rounded-2xl shadow-sm overflow-hidden transition-all ${achieved ? 'border-green-300' : 'border-gray-200'}`}>
                    {achieved && (
                      <div className="bg-green-500 text-white text-xs font-bold py-1 text-center flex items-center justify-center gap-1">
                        <Trophy size={11} /> حقق الهدف! 🎉
                      </div>
                    )}
                    <div className="p-4">
                      <div className="flex items-start gap-3">
                        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${idx === 0 ? 'from-yellow-400 to-amber-500' : idx === 1 ? 'from-gray-300 to-gray-400' : 'from-teal-500 to-cyan-500'} text-white flex items-center justify-center font-bold text-base shrink-0`}>
                          {stat.staff.name.slice(0, 2)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-gray-800">{stat.staff.name}</span>
                            <span className="text-base">{medal(idx)}</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            <span className="text-xs bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full">خدمة عملاء</span>
                            {stat.staff.phone && (
                              <a href={`tel:${stat.staff.phone}`} className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full flex items-center gap-0.5 hover:bg-gray-200">
                                <Phone size={9} /> {stat.staff.phone}
                              </a>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* KPI grid */}
                      <div className="grid grid-cols-3 gap-2 mt-4">
                        <div className="bg-teal-50 rounded-xl p-2 text-center">
                          <div className="text-lg font-black text-teal-600">{stat.paymentsCount}</div>
                          <div className="text-xs text-teal-400">دفعات</div>
                        </div>
                        <div className="bg-cyan-50 rounded-xl p-2 text-center">
                          <div className="text-lg font-black text-cyan-600">{stat.subsCount}</div>
                          <div className="text-xs text-cyan-400">عملاء</div>
                        </div>
                        <div className="bg-indigo-50 rounded-xl p-2 text-center">
                          <div className="text-sm font-black text-indigo-600">{fmtMoney(stat.revenue)}</div>
                          <div className="text-xs text-indigo-400">ج</div>
                        </div>
                      </div>

                      {/* Target progress */}
                      {hasTarget && (
                        <div className="mt-3">
                          <div className="flex justify-between text-xs text-gray-500 mb-1">
                            <span>الهدف الشهري: {stat.target} عميل</span>
                            <span className={progress >= 100 ? 'text-green-600 font-bold' : progress >= 60 ? 'text-yellow-600' : 'text-red-500'}>
                              {progress}%
                            </span>
                          </div>
                          <ProgressBar value={stat.subsCount} max={stat.target} color="bg-teal-400" height="h-3" />
                          <div className="text-xs text-gray-400 mt-0.5 text-left">
                            {stat.target - stat.subsCount > 0 ? `متبقي ${stat.target - stat.subsCount} عميل` : 'تجاوز الهدف!'}
                          </div>
                        </div>
                      )}

                      {/* Join date */}
                      {stat.staff.joinedAt && (
                        <div className="mt-2 text-xs text-gray-400 flex items-center gap-1">
                          <Calendar size={10} /> انضم: {stat.staff.joinedAt}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ════════════════════ COLLECTION TEAM ════════════════════ */}
      {activeSubTab === 'collection' && (
        <div className="space-y-4">
          {/* Urgent alert */}
          {overdueInstallments > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
              <AlertCircle size={20} className="text-red-500 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-red-700">{overdueInstallments} قسط متأخر يحتاج متابعة</div>
                <div className="text-sm text-red-500 mt-0.5">
                  المبالغ المتأخرة حسب العملة: <strong>{formatCurrencyAmounts(overdueByCurrency)}</strong>
                </div>
              </div>
            </div>
          )}

          {/* Team summary bar */}
          <div className="bg-cyan-50 border border-cyan-200 rounded-2xl p-4 flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <Wallet size={18} className="text-cyan-600" />
              <span className="font-bold text-cyan-700">فريق التحصيل ({collectionTeam.length})</span>
            </div>
            <div className="flex gap-4 text-sm text-gray-600">
              <span>محصل: <strong className="text-green-600">{fmtMoney(collectionStats.reduce((s, x) => s + x.collected, 0))} ج</strong></span>
              <span>متأخر مجمل: <strong className="text-red-500">{collectionStats.reduce((s, x) => s + x.overdueCount, 0)}</strong></span>
            </div>
            <p className="text-xs text-cyan-600 italic mr-auto hidden sm:block">
              {MOTIVATE_COLLECTION[new Date().getDay() % MOTIVATE_COLLECTION.length]}
            </p>
          </div>

          {collectionStats.length === 0 ? (
            <div className="py-16 text-center text-gray-400">
              <Wallet size={48} className="mx-auto mb-3 opacity-30" />
              <p>لا يوجد موظفين بدور "تحصيل" نشطين</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {collectionStats.map((stat, idx) => {
                const hasTarget = stat.target > 0;
                const progress = hasTarget ? pct(stat.collected, stat.target) : 0;
                const achieved = hasTarget && progress >= 100;
                return (
                  <div key={stat.staff.id}
                    className={`bg-white border rounded-2xl shadow-sm overflow-hidden transition-all ${achieved ? 'border-green-300' : stat.overdueCount > 0 ? 'border-amber-200' : 'border-gray-200'}`}>
                    {achieved && (
                      <div className="bg-green-500 text-white text-xs font-bold py-1 text-center flex items-center justify-center gap-1">
                        <Trophy size={11} /> حقق الهدف! 🎉
                      </div>
                    )}
                    {!achieved && stat.overdueCount > 0 && (
                      <div className="bg-amber-400 text-white text-xs font-bold py-1 text-center">
                        ⚠️ {stat.overdueCount} قسط متأخر
                      </div>
                    )}
                    <div className="p-4">
                      <div className="flex items-start gap-3">
                        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${idx === 0 ? 'from-yellow-400 to-amber-500' : idx === 1 ? 'from-gray-300 to-gray-400' : 'from-cyan-500 to-blue-500'} text-white flex items-center justify-center font-bold text-base shrink-0`}>
                          {stat.staff.name.slice(0, 2)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-gray-800">{stat.staff.name}</span>
                            <span className="text-base">{medal(idx)}</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            <span className="text-xs bg-cyan-100 text-cyan-700 px-2 py-0.5 rounded-full">تحصيل</span>
                            {stat.staff.commissionRate && (
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{stat.staff.commissionRate}% عمولة</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* KPI grid */}
                      <div className="grid grid-cols-3 gap-2 mt-4">
                        <div className="bg-cyan-50 rounded-xl p-2 text-center">
                          <div className="text-lg font-black text-cyan-600">{stat.subsCount}</div>
                          <div className="text-xs text-cyan-400">عملاء</div>
                        </div>
                        <div className={`rounded-xl p-2 text-center ${stat.overdueCount > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
                          <div className={`text-lg font-black ${stat.overdueCount > 0 ? 'text-red-600' : 'text-green-600'}`}>{stat.overdueCount}</div>
                          <div className="text-xs text-gray-400">متأخر</div>
                        </div>
                        <div className="bg-green-50 rounded-xl p-2 text-center">
                          <div className="text-sm font-black text-green-600">{fmtMoney(stat.collected)}</div>
                          <div className="text-xs text-green-400">ج محصل</div>
                        </div>
                      </div>

                      {/* Target progress */}
                      {hasTarget && (
                        <div className="mt-3">
                          <div className="flex justify-between text-xs text-gray-500 mb-1">
                            <span>الهدف: {fmtMoney(stat.target)} ج</span>
                            <span className={progress >= 100 ? 'text-green-600 font-bold' : progress >= 60 ? 'text-yellow-600' : 'text-red-500'}>
                              {progress}%
                            </span>
                          </div>
                          <ProgressBar value={stat.collected} max={stat.target} color="bg-cyan-400" height="h-3" />
                          {stat.staff.commissionRate && stat.commissionEarned > 0 && (
                            <div className="text-xs text-green-600 mt-0.5 flex items-center gap-1">
                              <Award size={10} /> عمولة متوقعة: {fmtMoney(stat.commissionEarned)} ج
                            </div>
                          )}
                        </div>
                      )}

                      {/* Overdue amount */}
                      {stat.overdueCount > 0 && (
                        <div className="mt-2 bg-red-50 rounded-xl px-3 py-2 text-xs text-red-600 flex items-center justify-between">
                          <span className="flex items-center gap-1"><AlertCircle size={10} /> مبلغ متأخر</span>
                          <strong>{formatCurrencyAmounts(stat.overdueByCurrency)}</strong>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ════════════════════ TARGETS ════════════════════ */}
      {activeSubTab === 'targets' && (
        <div className="space-y-5">
          {/* Header with edit toggle */}
          <div className="bg-gradient-to-l from-teal-50 to-cyan-50 border border-teal-200 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <Target size={18} className="text-teal-600" /> الأهداف الشهرية — {month()}
              </h3>
              {!editMode ? (
                <button onClick={startEdit}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 transition-colors">
                  <Edit2 size={13} /> تعديل الأهداف
                </button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={saveEdit}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition-colors">
                    <Save size={13} /> حفظ
                  </button>
                  <button onClick={cancelEdit}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-300 transition-colors">
                    <X size={13} /> إلغاء
                  </button>
                </div>
              )}
            </div>
            <p className="text-xs text-gray-400">
              اضبط الأهداف الشهرية لكل موظف — تُحفظ لكل مؤسسة في قاعدة البيانات
            </p>
          </div>

          {/* Online team targets */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <Monitor size={16} className="text-teal-500" />
              <h4 className="font-bold text-gray-700">فريق الأونلاين — هدف: عدد العملاء المسؤول عنهم</h4>
            </div>
            <div className="divide-y divide-gray-50">
              {onlineStats.length === 0
                ? <p className="p-6 text-center text-gray-400 text-sm">لا يوجد أعضاء</p>
                : onlineStats.map((stat, idx) => {
                  const progress = stat.target > 0 ? pct(stat.subsCount, stat.target) : 0;
                  const achieved = stat.target > 0 && progress >= 100;
                  return (
                    <div key={stat.staff.id} className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <span className="text-sm w-5 text-center">{medal(idx)}</span>
                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-teal-500 to-cyan-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
                          {stat.staff.name.slice(0, 2)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium text-gray-800 text-sm">{stat.staff.name}</span>
                            {achieved && <span className="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-full flex items-center gap-0.5"><Trophy size={9} /> أنجز</span>}
                          </div>
                          {editMode ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="number" min={0}
                                value={editingTargets[stat.staff.id] || ''}
                                onChange={e => setEditingTargets(prev => ({ ...prev, [stat.staff.id]: Number(e.target.value) }))}
                                placeholder="الهدف (عميل)"
                                className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-teal-500"
                              />
                              <span className="text-xs text-gray-400">عميل / شهر</span>
                            </div>
                          ) : (
                            <>
                              <ProgressBar value={stat.subsCount} max={stat.target || 1} color="bg-teal-400" height="h-2.5" />
                              <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                                <span>{stat.subsCount} عميل</span>
                                <span>هدف: {stat.target || '—'}</span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Collection team targets */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <Wallet size={16} className="text-cyan-500" />
              <h4 className="font-bold text-gray-700">فريق التحصيل — هدف: مبلغ التحصيل (ج)</h4>
            </div>
            <div className="divide-y divide-gray-50">
              {collectionStats.length === 0
                ? <p className="p-6 text-center text-gray-400 text-sm">لا يوجد أعضاء</p>
                : collectionStats.map((stat, idx) => {
                  const progress = stat.target > 0 ? pct(stat.collected, stat.target) : 0;
                  const achieved = stat.target > 0 && progress >= 100;
                  return (
                    <div key={stat.staff.id} className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <span className="text-sm w-5 text-center">{medal(idx)}</span>
                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
                          {stat.staff.name.slice(0, 2)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium text-gray-800 text-sm">{stat.staff.name}</span>
                            <div className="flex items-center gap-2">
                              {achieved && <span className="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-full flex items-center gap-0.5"><Trophy size={9} /> أنجز</span>}
                              {stat.staff.commissionRate && <span className="text-xs text-gray-400">{stat.staff.commissionRate}% عمولة</span>}
                            </div>
                          </div>
                          {editMode ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="number" min={0}
                                value={editingTargets[stat.staff.id] || ''}
                                onChange={e => setEditingTargets(prev => ({ ...prev, [stat.staff.id]: Number(e.target.value) }))}
                                placeholder="الهدف (ج)"
                                className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                              />
                              <span className="text-xs text-gray-400">جنيه / شهر</span>
                            </div>
                          ) : (
                            <>
                              <ProgressBar value={stat.collected} max={stat.target || 1} color="bg-cyan-400" height="h-2.5" />
                              <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                                <span className="text-green-600">{fmtMoney(stat.collected)} ج محصل</span>
                                <span>هدف: {stat.target ? fmtMoney(stat.target) : '—'} ج</span>
                              </div>
                              {stat.staff.commissionRate && stat.target > 0 && (
                                <div className="text-xs text-green-600 mt-0.5">
                                  عمولة متوقعة: {fmtMoney(Math.round(stat.collected * (stat.staff.commissionRate / 100)))} ج
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Team totals */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-teal-50 border border-teal-200 rounded-2xl p-4 text-center">
              <div className="text-3xl font-black text-teal-700">{onlineStats.reduce((s, x) => s + x.subsCount, 0)}</div>
              <div className="text-sm text-teal-500 mt-1">إجمالي عملاء فريق الأونلاين</div>
              <div className="text-xs text-gray-400">من {onlineStats.reduce((s, x) => s + (x.target || 0), 0) || '—'} هدف</div>
            </div>
            <div className="bg-cyan-50 border border-cyan-200 rounded-2xl p-4 text-center">
              <div className="text-3xl font-black text-cyan-700">{fmtMoney(collectionStats.reduce((s, x) => s + x.collected, 0))} ج</div>
              <div className="text-sm text-cyan-500 mt-1">إجمالي تحصيل الفريق</div>
              <div className="text-xs text-gray-400">من {collectionStats.reduce((s, x) => s + (x.target || 0), 0) ? fmtMoney(collectionStats.reduce((s, x) => s + (x.target || 0), 0)) + ' ج' : '—'} هدف</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OnlineTeamTab;
