import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, TrendingDown, Users, DollarSign, RefreshCw } from 'lucide-react';
import { BRANCHES, BRANCH_LABELS_AR } from '../../../constants/branches';

interface Stage { key: string; label: string; value: number; pctOfTop: number; stepPct: number; dropoff: number; }
interface FunnelData {
  stages: Stage[]; subscribers: number; converted: number; revenueEGP: number;
  biggestLeak: { from: string; to: string; stepPct: number; dropoff: number } | null;
  generatedAt: string;
}

const BAR = ['bg-indigo-500', 'bg-blue-500', 'bg-sky-500', 'bg-emerald-500', 'bg-teal-500', 'bg-amber-500'];

export default function FunnelTab() {
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [branch, setBranch] = useState('all');

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (branch && branch !== 'all') qs.set('branch', branch);
    fetch(`/api/admin/funnel?${qs.toString()}`, { credentials: 'include' })
      .then(r => r.json()).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [from, to, branch]);
  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-indigo-500" size={28} /></div>;
  if (!data) return <p className="text-gray-400 text-sm text-center py-10">تعذّر تحميل القمع</p>;

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <h3 className="font-extrabold text-gray-800 text-base">قمع التحويل — رحلة العميل بالأرقام</h3>
        <button onClick={load} className="text-xs text-indigo-600 hover:underline flex items-center gap-1"><RefreshCw size={12} /> تحديث</button>
      </div>

      {/* Filters: date range + branch */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-gray-500">من</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5" />
        <span className="text-gray-500">إلى</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5" />
        <select value={branch} onChange={e => setBranch(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5">
          <option value="all">كل الفروع</option>
          {BRANCHES.map(b => <option key={b} value={b}>{BRANCH_LABELS_AR[b]}</option>)}
        </select>
        {(from || to || branch !== 'all') && (
          <button onClick={() => { setFrom(''); setTo(''); setBranch('all'); }} className="text-indigo-600 hover:underline">مسح</button>
        )}
        {loading && <Loader2 size={13} className="animate-spin text-indigo-500" />}
      </div>

      {/* Headline cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
          <p className="text-[11px] text-gray-500 mb-1 flex items-center gap-1"><Users size={12} /> مشتركون</p>
          <p className="text-2xl font-extrabold text-indigo-700">{data.subscribers.toLocaleString()}</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
          <p className="text-[11px] text-gray-500 mb-1 flex items-center gap-1"><DollarSign size={12} /> إيراد (ج.م)</p>
          <p className="text-2xl font-extrabold text-emerald-700">{Math.round(data.revenueEGP).toLocaleString()}</p>
        </div>
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
          <p className="text-[11px] text-gray-500 mb-1">تحويل lead→دفع</p>
          <p className="text-2xl font-extrabold text-blue-700">
            {data.stages[0]?.value ? Math.round(((data.stages.find(s => s.key === 'paying')?.value || 0) / data.stages[0].value) * 100) : 0}%
          </p>
        </div>
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
          <p className="text-[11px] text-gray-500 mb-1 flex items-center gap-1"><TrendingDown size={12} /> أكبر تسريب</p>
          <p className="text-sm font-extrabold text-amber-700">{data.biggestLeak ? `${data.biggestLeak.from} → ${data.biggestLeak.to}` : '—'}</p>
          {data.biggestLeak && <p className="text-[11px] text-amber-600">يكمل {data.biggestLeak.stepPct}% فقط · يتسرّب {data.biggestLeak.dropoff.toLocaleString()}</p>}
        </div>
      </div>

      {/* Funnel bars */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
        {data.stages.map((s, i) => (
          <div key={s.key}>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="font-bold text-gray-700">{s.label}</span>
              <span className="text-gray-500">{s.value.toLocaleString()}
                <span className="text-gray-400 text-xs"> · {s.pctOfTop}% من البداية</span>
                {i > 0 && <span className={`text-xs mr-2 ${s.stepPct < 50 ? 'text-red-500 font-bold' : 'text-gray-400'}`}>({s.stepPct}% من السابق)</span>}
              </span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-7 overflow-hidden">
              <div className={`h-7 ${BAR[i % BAR.length]} rounded-full flex items-center justify-end px-2 transition-all`}
                style={{ width: `${Math.max(s.pctOfTop, 3)}%` }}>
                {s.pctOfTop >= 12 && <span className="text-white text-[11px] font-bold">{s.value.toLocaleString()}</span>}
              </div>
            </div>
            {i > 0 && s.dropoff > 0 && (
              <p className="text-[11px] text-red-400 mt-0.5 flex items-center gap-1"><TrendingDown size={11} /> تسرّب {s.dropoff.toLocaleString()} من {data.stages[i - 1].label}</p>
            )}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-400 text-center">آخر تحديث: {new Date(data.generatedAt).toLocaleString('ar-EG-u-nu-latn')} · يُحدَّث كل 5 دقائق</p>
    </div>
  );
}
