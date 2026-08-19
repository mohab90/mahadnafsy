import React, { useMemo, useState, useEffect } from 'react';
import {
  TrendingUp, Users, Target, Award, Phone, Mail, Calendar, ChevronRight,
  BarChart3, Star, Clock, CheckCircle, AlertCircle, 
  Filter, UserPlus, CreditCard, MessageCircle, Trophy,
  ThumbsUp, Send, Flame, 
  ChevronDown, ChevronUp, X, Briefcase,
} from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import type { SalesTarget } from '../../../types';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type TimeRange = 'today' | '7d' | '30d' | 'month' | 'all';

interface Props {
  notify: NotifyFn;
  salesTargets: SalesTarget[];
  onOpenStaffProfile?: (staffId: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const MONTH = new Date().toISOString().slice(0, 7);
const TODAY = new Date().toISOString().slice(0, 10);

function getRangeStart(range: TimeRange): string {
  const d = new Date();
  if (range === 'today') return TODAY;
  if (range === '7d') return new Date(+d - 7 * 86400000).toISOString().slice(0, 10);
  if (range === '30d') return new Date(+d - 30 * 86400000).toISOString().slice(0, 10);
  if (range === 'month') return `${MONTH}-01`;
  return '2000-01-01';
}

function inRange(dateStr: string | undefined, range: TimeRange): boolean {
  if (range === 'all') return true;
  const d = (dateStr || '').slice(0, 10);
  return d >= getRangeStart(range);
}

const ROLE_LABEL: Record<string, string> = {
  sales: 'سيلز',
  collection: 'تحصيل',
  support: 'خدمة عملاء',
  manager: 'مدير',
};

const STATUS_COLOR: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-indigo-100 text-indigo-700',
  interested: 'bg-yellow-100 text-yellow-700',
  converted: 'bg-green-100 text-green-700',
  lost: 'bg-red-100 text-red-700',
};

const RANK_COLORS = ['text-yellow-500', 'text-gray-400', 'text-amber-600'];
const RANK_ICONS = [Trophy, Award, Star];

function percent(val: number, total: number) {
  return total === 0 ? 0 : Math.min(100, Math.round((val / total) * 100));
}

// ── Motivational Post Types ───────────────────────────────────────────────
interface MotivPost {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  emoji: string;
  createdAt: string;
  likes: string[];
}

// ── Main Component ─────────────────────────────────────────────────────────
const SalesHubTab: React.FC<Props> = ({ notify, salesTargets, onOpenStaffProfile }) => {
  const { staffMembers, leads, orders } = useSiteData();

  // Only sales-role staff
  const salesTeam = useMemo(() =>
    staffMembers.filter(s => s.role === 'sales' && s.status === 'active'),
    [staffMembers]
  );

  const [timeRange, setTimeRange] = useState<TimeRange>('month');
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'team' | 'leads' | 'targets' | 'posts'>('overview');
  const [expandedStaff, setExpandedStaff] = useState<string | null>(null);
  const [postText, setPostText] = useState('');
  const [postEmoji, setPostEmoji] = useState('🔥');
  const [posts, setPosts] = useState<MotivPost[]>([]);

  useEffect(() => {
    mysqlAdmin.adminGet<{ ok: boolean; data: MotivPost[] | null }>('/admin/kv/sales_motiv_posts')
      .then(res => { if (res.data) setPosts(res.data); })
      .catch(() => notify('error', 'تعذر تحميل رسائل الفريق من السيرفر'));
  }, [notify]);

  // ── Per-staff stats ────────────────────────────────────────────────────
  const staffStats = useMemo(() => {
    return salesTeam.map(s => {
      const myLeads = leads.filter(l => !l.hidden && l.assignedSalesId === s.id && inRange(l.createdAt, timeRange));
      const converted = myLeads.filter(l => l.status === 'converted');
      const lost = myLeads.filter(l => l.status === 'lost');
      const active = myLeads.filter(l => !['converted', 'lost'].includes(l.status || ''));
      const convRate = percent(converted.length, myLeads.length);

      // Revenue from orders attributed to this staff
      const myOrders = orders.filter(o =>
        o.status === 'paid' &&
        o.staffId === s.id &&
        inRange(o.paidAt || o.createdAt, timeRange)
      );
      const revenue = myOrders.reduce((sum, o) => sum + (o.amount || 0), 0);

      // Monthly target
      const target = salesTargets.find(t => t.staffId === s.id && t.month === MONTH);
      const targetAmt = target?.targetEGP || 0;
      const targetPct = percent(revenue, targetAmt);

      // Follow-ups due today
      const followUpsToday = leads.filter(l =>
        !l.hidden &&
        l.assignedSalesId === s.id &&
        l.nextFollowUpDate === TODAY &&
        !['converted', 'lost'].includes(l.status || '')
      ).length;

      return {
        staff: s,
        totalLeads: myLeads.length,
        converted: converted.length,
        lost: lost.length,
        active: active.length,
        convRate,
        revenue,
        targetAmt,
        targetPct,
        followUpsToday,
        myOrders: myOrders.length,
      };
    }).sort((a, b) => b.converted - a.converted);
  }, [salesTeam, leads, orders, salesTargets, timeRange]);

  // ── Overall stats ──────────────────────────────────────────────────────
  const totals = useMemo(() => {
    return staffStats.reduce((acc, s) => ({
      leads: acc.leads + s.totalLeads,
      converted: acc.converted + s.converted,
      revenue: acc.revenue + s.revenue,
      followUps: acc.followUps + s.followUpsToday,
    }), { leads: 0, converted: 0, revenue: 0, followUps: 0 });
  }, [staffStats]);

  // ── Motivational Posts ─────────────────────────────────────────────────
  const persistPosts = async (updated: MotivPost[]) => {
    try {
      await mysqlAdmin.adminPut('/admin/kv/sales_motiv_posts', updated);
      setPosts(updated);
      return true;
    } catch {
      notify('error', 'فشل حفظ رسائل الفريق على السيرفر');
      return false;
    }
  };

  const addPost = async () => {
    if (!postText.trim()) return;
    const newPost: MotivPost = {
      id: `mp-${Date.now()}`,
      authorId: 'admin',
      authorName: 'الإدارة',
      text: postText.trim(),
      emoji: postEmoji,
      createdAt: new Date().toISOString(),
      likes: [],
    };
    const updated = [newPost, ...posts];
    if (await persistPosts(updated)) {
      setPostText('');
      notify('success', 'تم نشر الرسالة التحفيزية ✨');
    }
  };

  const toggleLike = async (postId: string) => {
    const updated = posts.map(p =>
      p.id === postId
        ? { ...p, likes: p.likes.includes('admin') ? p.likes.filter(x => x !== 'admin') : [...p.likes, 'admin'] }
        : p
    );
    await persistPosts(updated);
  };

  const deletePost = async (postId: string) => {
    await persistPosts(posts.filter(p => p.id !== postId));
  };

  const RANGE_OPTIONS: { key: TimeRange; label: string }[] = [
    { key: 'today', label: 'اليوم' },
    { key: '7d', label: '٧ أيام' },
    { key: 'month', label: 'الشهر' },
    { key: '30d', label: '٣٠ يوم' },
    { key: 'all', label: 'الكل' },
  ];

  const SUB_TABS = [
    { key: 'overview', label: 'نظرة عامة', icon: BarChart3 },
    { key: 'team', label: 'الفريق', icon: Users },
    { key: 'leads', label: 'المتابعات', icon: UserPlus },
    { key: 'targets', label: 'الأهداف', icon: Target },
    { key: 'posts', label: 'التحفيز', icon: Flame },
  ] as const;

  return (
    <div className="space-y-5" dir="rtl">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="bg-gradient-to-l from-violet-600 to-indigo-700 rounded-2xl p-5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <TrendingUp size={22} /> مركز المبيعات
            </h2>
            <p className="text-indigo-200 text-sm mt-0.5">فريق المبيعات · الأهداف · الأداء والإحصائيات</p>
          </div>
          {/* Time range selector */}
          <div className="flex bg-white/10 rounded-xl overflow-hidden">
            {RANGE_OPTIONS.map(opt => (
              <button
                key={opt.key}
                onClick={() => setTimeRange(opt.key)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${timeRange === opt.key ? 'bg-white text-indigo-700' : 'text-indigo-100 hover:bg-white/10'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Quick KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {[
            { label: 'إجمالي اللييدات', value: totals.leads, icon: UserPlus, color: 'bg-white/15' },
            { label: 'تحويلات مكتملة', value: totals.converted, icon: CheckCircle, color: 'bg-white/15' },
            { label: 'إيراد السيلز', value: `${totals.revenue.toLocaleString()} ج`, icon: CreditCard, color: 'bg-white/15' },
            { label: 'متابعات اليوم', value: totals.followUps, icon: Clock, color: 'bg-white/15' },
          ].map(stat => (
            <div key={stat.label} className={`${stat.color} rounded-xl p-3 flex items-center gap-2.5`}>
              <stat.icon size={18} className="opacity-80" />
              <div>
                <div className="text-lg font-bold leading-none">{stat.value}</div>
                <div className="text-xs text-indigo-200 mt-0.5">{stat.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Sub-tabs ──────────────────────────────────────────────── */}
      <div className="flex gap-2 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        {SUB_TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveSubTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              activeSubTab === key
                ? 'bg-white shadow-sm text-indigo-700 font-bold'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* ══════════════ OVERVIEW TAB ══════════════ */}
      {activeSubTab === 'overview' && (
        <div className="space-y-4">
          {/* Leaderboard */}
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-gray-100 flex items-center gap-2">
              <Trophy size={18} className="text-yellow-500" />
              <h3 className="font-bold text-gray-800">ترتيب الفريق</h3>
              <span className="text-xs text-gray-400 mr-auto">{timeRange === 'month' ? 'الشهر الحالي' : timeRange === 'today' ? 'اليوم' : 'الفترة المحددة'}</span>
            </div>
            <div className="divide-y divide-gray-50">
              {staffStats.length === 0 ? (
                <div className="p-8 text-center text-gray-400">لا يوجد سيلز نشطين</div>
              ) : staffStats.map((stat, idx) => {
                const RankIcon = RANK_ICONS[idx] || Star;
                return (
                  <div
                    key={stat.staff.id}
                    className="p-4 flex items-center gap-4 hover:bg-gray-50 cursor-pointer group transition-colors"
                    onClick={() => onOpenStaffProfile?.(stat.staff.id)}
                  >
                    {/* Rank */}
                    <div className={`text-2xl font-black w-8 text-center ${RANK_COLORS[idx] || 'text-gray-400'}`}>
                      {idx < 3 ? <RankIcon size={22} className={RANK_COLORS[idx]} fill="currentColor" /> : `#${idx + 1}`}
                    </div>

                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm shrink-0">
                      {stat.staff.name.slice(0, 2)}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-800 group-hover:text-indigo-600 transition-colors">{stat.staff.name}</span>
                        {stat.staff.commissionRate && (
                          <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">{stat.staff.commissionRate}% عمولة</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-gray-500">
                        <span className="flex items-center gap-1"><UserPlus size={11} /> {stat.totalLeads} ليد</span>
                        <span className="flex items-center gap-1 text-green-600"><CheckCircle size={11} /> {stat.converted} تحويل</span>
                        <span className="flex items-center gap-1 text-blue-600"><CreditCard size={11} /> {stat.revenue.toLocaleString()} ج</span>
                        {stat.followUpsToday > 0 && (
                          <span className="flex items-center gap-1 text-orange-500"><Clock size={11} /> {stat.followUpsToday} متابعة اليوم</span>
                        )}
                      </div>
                    </div>

                    {/* Conversion rate */}
                    <div className="text-right shrink-0">
                      <div className="text-lg font-bold text-indigo-600">{stat.convRate}%</div>
                      <div className="text-xs text-gray-400">معدل تحويل</div>
                    </div>

                    <ChevronRight size={16} className="text-gray-300 group-hover:text-indigo-400 transition-colors" />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Conversion funnel mini chart */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
            <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-4">
              <Filter size={16} /> مسار التحويل
            </h3>
            <div className="space-y-2.5">
              {[
                { label: 'إجمالي الليدات', value: totals.leads, color: 'bg-blue-500', max: totals.leads },
                { label: 'تحويلات', value: totals.converted, color: 'bg-green-500', max: totals.leads },
                { label: 'متابعات اليوم', value: totals.followUps, color: 'bg-orange-400', max: totals.leads },
              ].map(row => (
                <div key={row.label} className="flex items-center gap-3">
                  <div className="w-28 text-sm text-gray-600 text-left">{row.label}</div>
                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`${row.color} h-full rounded-full transition-all duration-500`}
                      style={{ width: `${percent(row.value, row.max)}%` }}
                    />
                  </div>
                  <div className="w-12 text-sm font-bold text-gray-700 text-right">{row.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ TEAM TAB ══════════════ */}
      {activeSubTab === 'team' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {staffStats.length === 0 ? (
            <div className="col-span-full py-16 text-center text-gray-400">
              <Users size={40} className="mx-auto mb-3 opacity-40" />
              <p>لا يوجد سيلز نشطين حالياً</p>
            </div>
          ) : staffStats.map((stat, idx) => {
            const isExpanded = expandedStaff === stat.staff.id;
            const RankIcon = RANK_ICONS[idx];
            return (
              <div
                key={stat.staff.id}
                className={`bg-white border rounded-2xl shadow-sm overflow-hidden transition-all ${
                  isExpanded ? 'border-indigo-300 ring-1 ring-indigo-200' : 'border-gray-200'
                }`}
              >
                {/* Card Header */}
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="relative">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white flex items-center justify-center font-bold text-sm">
                        {stat.staff.name.slice(0, 2)}
                      </div>
                      {idx < 3 && RankIcon && (
                        <div className={`absolute -top-1 -right-1 ${RANK_COLORS[idx]}`}>
                          <RankIcon size={14} fill="currentColor" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <button
                        className="font-bold text-gray-800 hover:text-indigo-600 transition-colors text-right"
                        onClick={() => onOpenStaffProfile?.(stat.staff.id)}
                      >
                        {stat.staff.name}
                      </button>
                      <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                        <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">{ROLE_LABEL[stat.staff.role] || stat.staff.role}</span>
                        {stat.staff.commissionRate && (
                          <span className="bg-green-50 text-green-600 px-2 py-0.5 rounded-full">{stat.staff.commissionRate}% عمولة</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => setExpandedStaff(isExpanded ? null : stat.staff.id)}
                      className="text-gray-400 hover:text-indigo-500 transition-colors"
                    >
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>

                  {/* Key stats row */}
                  <div className="grid grid-cols-3 gap-2 mt-4">
                    <div className="bg-blue-50 rounded-xl p-2 text-center">
                      <div className="text-lg font-bold text-blue-600">{stat.totalLeads}</div>
                      <div className="text-xs text-blue-400">ليد</div>
                    </div>
                    <div className="bg-green-50 rounded-xl p-2 text-center">
                      <div className="text-lg font-bold text-green-600">{stat.converted}</div>
                      <div className="text-xs text-green-400">تحويل</div>
                    </div>
                    <div className="bg-violet-50 rounded-xl p-2 text-center">
                      <div className="text-lg font-bold text-violet-600">{stat.convRate}%</div>
                      <div className="text-xs text-violet-400">تحويل%</div>
                    </div>
                  </div>

                  {/* Target progress */}
                  {stat.targetAmt > 0 && (
                    <div className="mt-3">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>الهدف الشهري</span>
                        <span className="font-semibold">{stat.targetPct}%</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${
                            stat.targetPct >= 100 ? 'bg-green-500' : stat.targetPct >= 60 ? 'bg-yellow-400' : 'bg-red-400'
                          }`}
                          style={{ width: `${stat.targetPct}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-xs mt-1">
                        <span className="text-indigo-600 font-medium">{stat.revenue.toLocaleString()} ج</span>
                        <span className="text-gray-400">{stat.targetAmt.toLocaleString()} ج هدف</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t border-gray-100 p-4 bg-gray-50/50 space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Phone size={13} className="text-gray-400" />
                        <span className="text-gray-600">{stat.staff.phone || '—'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Mail size={13} className="text-gray-400" />
                        <span className="text-gray-600 truncate">{stat.staff.email || '—'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar size={13} className="text-gray-400" />
                        <span className="text-gray-600">انضم {stat.staff.joinedAt}</span>
                      </div>
                      {stat.followUpsToday > 0 && (
                        <div className="flex items-center gap-2">
                          <AlertCircle size={13} className="text-orange-400" />
                          <span className="text-orange-600">{stat.followUpsToday} متابعة مستحقة</span>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="bg-white rounded-xl p-2.5 border border-gray-100 text-center">
                        <div className="font-bold text-red-500">{stat.lost}</div>
                        <div className="text-xs text-gray-400">مفقود</div>
                      </div>
                      <div className="bg-white rounded-xl p-2.5 border border-gray-100 text-center">
                        <div className="font-bold text-amber-500">{stat.active}</div>
                        <div className="text-xs text-gray-400">نشط</div>
                      </div>
                    </div>
                    <button
                      onClick={() => onOpenStaffProfile?.(stat.staff.id)}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-2 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Briefcase size={14} /> عرض الملف الكامل
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ══════════════ LEADS TAB ══════════════ */}
      {activeSubTab === 'leads' && (
        <div className="space-y-4">
          {staffStats.map(stat => {
            const myLeads = leads.filter(l => !l.hidden && l.assignedSalesId === stat.staff.id && inRange(l.createdAt, timeRange));
            if (myLeads.length === 0) return null;
            return (
              <div key={stat.staff.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="p-4 border-b border-gray-100 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-bold">
                    {stat.staff.name.slice(0, 2)}
                  </div>
                  <span className="font-semibold text-gray-800">{stat.staff.name}</span>
                  <span className="text-xs text-gray-400">({myLeads.length} ليد)</span>
                </div>
                <div className="divide-y divide-gray-50 max-h-60 overflow-y-auto">
                  {myLeads.map(lead => (
                    <div key={lead.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[lead.status || 'new'] || 'bg-gray-100 text-gray-600'}`}>
                        {lead.status === 'new' ? 'جديد' : lead.status === 'contacted' ? 'تم تواصل' : lead.status === 'interested' ? 'مهتم' : lead.status === 'converted' ? 'محول' : lead.status === 'lost' ? 'مفقود' : lead.status}
                      </span>
                      <span className="font-medium text-gray-700 flex-1">{lead.name}</span>
                      <span className="text-gray-400 text-xs">{lead.phone}</span>
                      {lead.nextFollowUpDate === TODAY && (
                        <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Clock size={10} /> اليوم
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ══════════════ TARGETS TAB ══════════════ */}
      {activeSubTab === 'targets' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <Target size={17} className="text-indigo-500" /> أهداف الشهر الحالي
              </h3>
              <span className="text-sm text-gray-400">{MONTH}</span>
            </div>
            <div className="divide-y divide-gray-50">
              {staffStats.map((stat) => (
                <div key={stat.staff.id} className="p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-bold shrink-0">
                      {stat.staff.name.slice(0, 2)}
                    </div>
                    <span className="font-semibold text-gray-800 flex-1">{stat.staff.name}</span>
                    <div className="text-right">
                      <span className={`text-sm font-bold ${stat.targetPct >= 100 ? 'text-green-600' : stat.targetPct >= 60 ? 'text-yellow-600' : 'text-red-500'}`}>
                        {stat.targetPct}%
                      </span>
                    </div>
                  </div>
                  {stat.targetAmt > 0 ? (
                    <>
                      <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${
                            stat.targetPct >= 100 ? 'bg-green-500' :
                            stat.targetPct >= 75 ? 'bg-blue-500' :
                            stat.targetPct >= 50 ? 'bg-yellow-400' : 'bg-red-400'
                          }`}
                          style={{ width: `${Math.min(100, stat.targetPct)}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-xs mt-1.5 text-gray-400">
                        <span>حقق: <strong className="text-gray-700">{stat.revenue.toLocaleString()} ج</strong></span>
                        <span>الهدف: <strong className="text-gray-700">{stat.targetAmt.toLocaleString()} ج</strong></span>
                      </div>
                      {stat.targetPct >= 100 && (
                        <div className="mt-1.5 text-xs text-green-600 font-medium flex items-center gap-1">
                          <Trophy size={11} /> تحقق الهدف! زيادة {(stat.revenue - stat.targetAmt).toLocaleString()} ج
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-gray-400 mt-1">لم يُحدد هدف بعد لهذا الشهر</p>
                  )}
                </div>
              ))}
              {staffStats.length === 0 && (
                <div className="p-8 text-center text-gray-400">لا يوجد سيلز لعرض أهدافهم</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ POSTS TAB (تحفيزي) ══════════════ */}
      {activeSubTab === 'posts' && (
        <div className="space-y-4">
          {/* New post form */}
          <div className="bg-gradient-to-l from-violet-50 to-indigo-50 border border-indigo-200 rounded-2xl p-4">
            <h3 className="font-bold text-indigo-800 mb-3 flex items-center gap-2">
              <Flame size={17} className="text-orange-500" /> رسالة تحفيزية للفريق
            </h3>
            <div className="flex gap-2 mb-3">
              {['🔥', '💪', '🏆', '🚀', '⭐', '🎯', '💡', '👏'].map(e => (
                <button
                  key={e}
                  onClick={() => setPostEmoji(e)}
                  className={`text-xl p-1.5 rounded-lg transition-all ${postEmoji === e ? 'bg-indigo-100 ring-2 ring-indigo-400 scale-110' : 'hover:bg-white'}`}
                >
                  {e}
                </button>
              ))}
            </div>
            <textarea
              value={postText}
              onChange={(e) => setPostText(e.target.value)}
              placeholder="اكتب رسالة تحفيزية للفريق..."
              className="w-full border border-indigo-200 rounded-xl px-4 py-3 text-sm resize-none h-24 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
            />
            <button
              onClick={addPost}
              disabled={!postText.trim()}
              className="mt-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl px-5 py-2.5 text-sm font-bold flex items-center gap-1.5 transition-colors"
            >
              <Send size={14} /> نشر للفريق
            </button>
          </div>

          {/* Posts list */}
          <div className="space-y-3">
            {posts.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <MessageCircle size={36} className="mx-auto mb-2 opacity-40" />
                <p>لم يُنشر أي رسالة تحفيزية بعد</p>
              </div>
            ) : posts.map(post => (
              <div key={post.id} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="text-3xl">{post.emoji}</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-gray-800 text-sm">{post.authorName}</span>
                      <span className="text-xs text-gray-400">{new Date(post.createdAt).toLocaleDateString('ar-EG-u-nu-latn')}</span>
                    </div>
                    <p className="text-gray-700 text-sm leading-relaxed">{post.text}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <button
                        onClick={() => toggleLike(post.id)}
                        className={`flex items-center gap-1 text-xs transition-colors ${
                          post.likes.includes('admin') ? 'text-indigo-600' : 'text-gray-400 hover:text-indigo-500'
                        }`}
                      >
                        <ThumbsUp size={13} fill={post.likes.includes('admin') ? 'currentColor' : 'none'} />
                        {post.likes.length > 0 && post.likes.length}
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => deletePost(post.id)}
                    className="text-gray-300 hover:text-red-400 transition-colors"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SalesHubTab;
