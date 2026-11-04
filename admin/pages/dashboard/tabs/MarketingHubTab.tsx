import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Megaphone, Zap, BarChart3, Tag, CheckCircle, X, Hash, Copy, Layers, Award, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import { SegmentationTab } from './marketing-hub-sections/SegmentationTab';
import { SiteOffersPanel } from './marketing-hub-sections/SiteOffersPanel';
import { MarketingOverview } from './marketing-hub-sections/MarketingOverview';
import AutomationTab from './AutomationTab';
import { useSiteData } from '../../../context/SiteDataContext';
import { isTabKey } from '../navigation';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type SubTab = 'overview' | 'discounts' | 'automation' | 'segmentation';

interface Props { notify: NotifyFn; }

/**
 * مركز التسويق: four sections, each with a job (4 Nov 2026, «سيب فقط نظرة عامة، الخصومات، الأتوميشن، الشرائح — الباقي شيله»). The leads list, the campaigns, the
 * notifications and the performance tabs are gone: the leads have their own screens, the campaigns and the inbox have theirs, and the performance tab drew what the overview
 * now draws from the server. The automation section is the real automation page — it was a switch panel that sent nothing.
 */
function pct(val: number, total: number) {
  return total === 0 ? 0 : Math.min(100, Math.round((val / total) * 100));
}

// ── ProgressBar Component ──────────────────────────────────────────────────
const ProgressBar: React.FC<{ value: number; max: number; color?: string; height?: string }> = ({
  value, max, color = 'bg-rose-400', height = 'h-2',
}) => {
  const p = pct(value, max);
  const c = p >= 100 ? 'bg-green-500' : p >= 60 ? color : p >= 30 ? 'bg-yellow-400' : 'bg-red-400';
  return (
    <div className={`w-full ${height} bg-gray-100 rounded-full overflow-hidden`}>
      <div className={`${c} h-full rounded-full transition-all duration-500`} style={{ width: `${p}%` }} />
    </div>
  );
};

// ── StatCard Component ─────────────────────────────────────────────────────
const StatCard: React.FC<{
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string; bg: string;
  trend?: number;
}> = ({ label, value, sub, icon: Icon, color, bg, trend }) => (
  <div className={`${bg} rounded-2xl p-4`}>
    <div className="flex items-start justify-between mb-2">
      <Icon size={18} className={`${color} opacity-70`} />
      {trend !== undefined && (
        <span className={`text-xs font-bold flex items-center gap-0.5 ${trend >= 0 ? 'text-green-600' : 'text-red-500'}`}>
          {trend >= 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
          {Math.abs(trend)}%
        </span>
      )}
    </div>
    <div className={`text-2xl font-black ${color}`}>{value}</div>
    <div className="text-xs font-medium text-gray-700 mt-0.5">{label}</div>
    {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
  </div>
);

const SUB_TABS: { key: SubTab; label: string; icon: React.ElementType }[] = [
  { key: 'overview', label: 'نظرة عامة', icon: BarChart3 },
  { key: 'discounts', label: 'الخصومات', icon: Tag },
  { key: 'automation', label: 'الأتوميشن', icon: Zap },
  { key: 'segmentation', label: 'الشرائح', icon: Layers },
];

const MarketingHubTab: React.FC<Props> = ({ notify }) => {
  const { leads, subscribers, discounts } = useSiteData();
  const navigate = useNavigate();
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('overview');

  const activeDiscounts = useMemo(() => discounts.filter(d => d.isActive), [discounts]);
  const totalDiscountUsage = discounts.reduce((s, d) => s + (d.usageCount || 0), 0);
  const discountAnalytics = useMemo(() => ({
    topUsed: [...discounts].sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0)).slice(0, 5),
  }), [discounts]);

  return (
    <div className="space-y-5" dir="rtl">

      <div className="bg-gradient-to-l from-rose-700 to-pink-600 rounded-2xl p-5 text-white">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Megaphone size={22} /> مركز التسويق الشامل
        </h2>
        <p className="text-rose-200 text-sm mt-0.5">نظرة عامة · الخصومات · الأتوميشن · الشرائح</p>
      </div>

      <div className="flex gap-2 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        {SUB_TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setActiveSubTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              activeSubTab === key ? 'bg-white shadow-sm text-rose-700 font-bold' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {activeSubTab === 'overview' && <MarketingOverview notify={notify} />}

      {/* ════════════════════ DISCOUNTS ════════════════════ */}
      {activeSubTab === 'discounts' && (
        <div className="space-y-5">

          <SiteOffersPanel notify={notify} />

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="إجمالي الكوبونات" value={discounts.length} icon={Tag} color="text-rose-600" bg="bg-rose-50" />
            <StatCard label="كوبونات نشطة" value={activeDiscounts.length} icon={CheckCircle} color="text-green-600" bg="bg-green-50" />
            <StatCard label="إجمالي الاستخدامات" value={totalDiscountUsage} icon={Hash} color="text-indigo-600" bg="bg-indigo-50" />
            <StatCard label="متوقف" value={discounts.filter(d => !d.isActive).length} icon={X} color="text-gray-500" bg="bg-gray-50" />
          </div>

          {/* Top used discounts chart */}
          {discountAnalytics.topUsed.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
              <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-1.5">
                <Award size={16} className="text-amber-500" /> أكثر الكوبونات استخداماً
              </h3>
              <div className="space-y-3">
                {discountAnalytics.topUsed.map((d, idx) => (
                  <div key={d.id} className="flex items-center gap-3">
                    <span className="text-sm font-mono text-gray-400 w-4">{idx + 1}.</span>
                    <span className="font-mono font-bold text-indigo-600 w-28">{d.code}</span>
                    <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded w-16 text-center">
                      {d.type === 'percent' ? `${d.value}%` : `${d.value} ج`}
                    </span>
                    <div className="flex-1">
                      <ProgressBar value={d.usageCount || 0} max={discountAnalytics.topUsed[0]?.usageCount || 1} color="bg-rose-400" height="h-2.5" />
                    </div>
                    <span className="text-sm font-bold text-gray-700 w-12 text-left">{d.usageCount || 0}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Full discounts table */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <Tag size={16} className="text-rose-500" /> جميع الخصومات والكوبونات
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-green-600 font-semibold">{activeDiscounts.length} نشط</span>
                <span className="text-xs text-gray-400">/ {discounts.length} إجمالي</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs">
                  <tr>
                    <th className="text-right p-3 font-medium">الكود</th>
                    <th className="text-center p-3 font-medium">النوع</th>
                    <th className="text-center p-3 font-medium">القيمة</th>
                    <th className="text-center p-3 font-medium">الاستخدامات</th>
                    <th className="text-center p-3 font-medium">الحد الأقصى</th>
                    <th className="text-center p-3 font-medium">الاستخدام</th>
                    <th className="text-center p-3 font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {discounts.length === 0 ? (
                    <tr><td colSpan={7} className="p-8 text-center text-gray-400">لا كوبونات مضافة بعد</td></tr>
                  ) : discounts.map(d => {
                    const usagePct = d.usageLimit ? pct(d.usageCount || 0, d.usageLimit) : 0;
                    return (
                      <tr key={d.id} className={`hover:bg-gray-50 transition-colors ${!d.isActive ? 'opacity-60' : ''}`}>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-indigo-600">{d.code}</span>
                            <button onClick={() => { navigator.clipboard?.writeText(d.code || ''); notify('success', 'تم نسخ الكود'); }}
                              className="text-gray-400 hover:text-gray-600">
                              <Copy size={12} />
                            </button>
                          </div>
                        </td>
                        <td className="p-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${d.type === 'percent' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                            {d.type === 'percent' ? 'نسبة' : 'مبلغ'}
                          </span>
                        </td>
                        <td className="p-3 text-center font-semibold">
                          {d.type === 'percent' ? `${d.value}%` : `${d.value} ج`}
                        </td>
                        <td className="p-3 text-center font-bold">{d.usageCount ?? 0}</td>
                        <td className="p-3 text-center text-gray-500">{d.usageLimit ?? '∞'}</td>
                        <td className="p-3 text-center w-24">
                          {d.usageLimit ? (
                            <div className="space-y-0.5">
                              <ProgressBar value={d.usageCount || 0} max={d.usageLimit} color="bg-indigo-400" height="h-1.5" />
                              <span className="text-xs text-gray-400">{usagePct}%</span>
                            </div>
                          ) : <span className="text-xs text-gray-300">غير محدود</span>}
                        </td>
                        <td className="p-3 text-center">
                          {d.isActive
                            ? <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full font-medium">نشط</span>
                            : <span className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">متوقف</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeSubTab === 'automation' && (
        <AutomationTab notify={notify} setActiveTab={tab => { if (isTabKey(tab)) navigate(`/dashboard/${tab}`); }} />
      )}

      {activeSubTab === 'segmentation' && (
        <SegmentationTab leads={leads} subscribers={subscribers} notify={notify} />
      )}
    </div>
  );
};

export default MarketingHubTab;
