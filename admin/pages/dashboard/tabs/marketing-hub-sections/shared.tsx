import React from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

export type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
export type TimeRange = 'today' | '7d' | '30d' | 'month' | 'all';
export type SubTab = 'overview' | 'leads' | 'discounts' | 'campaigns' | 'notifications_tab' | 'automation' | 'performance' | 'segmentation' | 'abandoned';
export type AbandonedCart = { id: string; type: string; item_title: string; amount: number; currency: string; customer_name: string; customer_email: string | null; customer_phone: string | null; created_at: string };
export type SourceBreakdownRow = { source: string; total: number; converted: number; revenue: number; convRate: number };
export type FunnelStep = { label: string; value: number; color: string; w: number };

export const TODAY = new Date().toISOString().slice(0, 10);
export const MONTH = new Date().toISOString().slice(0, 7);

export function getRangeStart(range: TimeRange): string {
  const d = new Date();
  if (range === 'today') return TODAY;
  if (range === '7d') return new Date(+d - 7 * 86400000).toISOString().slice(0, 10);
  if (range === '30d') return new Date(+d - 30 * 86400000).toISOString().slice(0, 10);
  if (range === 'month') return `${MONTH}-01`;
  return '2000-01-01';
}
export function inRange(dateStr: string | undefined, range: TimeRange): boolean {
  if (range === 'all') return true;
  return (dateStr || '').slice(0, 10) >= getRangeStart(range);
}
export function pct(val: number, total: number) {
  return total === 0 ? 0 : Math.min(100, Math.round((val / total) * 100));
}
export function fmtK(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}م` : n >= 1000 ? `${(n / 1000).toFixed(1)}ك` : String(n);
}
export function getLast7Days() {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

export const SOURCE_ICONS: Record<string, string> = {
  Facebook: '📘', Instagram: '📸', WhatsApp: '💬', TikTok: '🎵',
  YouTube: '▶️', Google: '🔍', Manual: '✍️', Referral: '🤝',
  Website: '🌐', Email: '📧', Other: '❓',
};
export const SOURCE_COLORS: Record<string, string> = {
  Facebook: 'bg-blue-100 text-blue-700 border-blue-200',
  Instagram: 'bg-pink-100 text-pink-700 border-pink-200',
  WhatsApp: 'bg-green-100 text-green-700 border-green-200',
  TikTok: 'bg-gray-100 text-gray-800 border-gray-200',
  YouTube: 'bg-red-100 text-red-700 border-red-200',
  Google: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  Manual: 'bg-purple-100 text-purple-700 border-purple-200',
  Referral: 'bg-teal-100 text-teal-700 border-teal-200',
  Website: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  Email: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  Other: 'bg-gray-100 text-gray-600 border-gray-200',
};

export const ProgressBar: React.FC<{ value: number; max: number; color?: string; height?: string }> = ({
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

export const MiniBarChart: React.FC<{
  data: { label: string; value: number }[];
  color?: string; height?: number; showLabels?: boolean;
}> = ({ data, color = 'bg-rose-400', height = 50, showLabels = false }) => {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="w-full">
      <div className="flex items-end gap-1 w-full" style={{ height }}>
        {data.map((d, i) => {
          const h = Math.max(2, Math.round((d.value / max) * height));
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative" title={`${d.label}: ${d.value}`}>
              <div className={`w-full rounded-t-sm ${color} opacity-80 hover:opacity-100 transition-all cursor-default`} style={{ height: h }} />
              {d.value > 0 && (
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10">
                  {d.value}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {showLabels && (
        <div className="flex gap-1 mt-1">
          {data.map((d, i) => (
            <div key={i} className="flex-1 text-center text-xs text-gray-400">{d.label.slice(-2)}</div>
          ))}
        </div>
      )}
    </div>
  );
};

export const StatCard: React.FC<{
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
