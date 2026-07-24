import { useState, useEffect } from 'react';
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2, Inbox, ArrowLeft } from 'lucide-react';

interface Item { key: string; label: string; count: number; severity: 'high' | 'warn' | 'ok'; link: string; }
interface Proof { id: string; amount: number; currency: string; submitted_at: string; subscriber_name: string | null; }
interface Data { items: Item[]; totalActions: number; pendingProofs: Proof[]; generatedAt: string; }

const SEV: Record<string, string> = {
  high: 'bg-red-50 border-red-200 text-red-700',
  warn: 'bg-amber-50 border-amber-200 text-amber-700',
  ok: 'bg-gray-50 border-gray-100 text-gray-400',
};

// Team mission-control: everything that needs action right now.
export default function ActionCenter({ onNavigate }: { onNavigate?: (link: string) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch('/api/admin/action-center', { credentials: 'include' })
      .then(r => r.json()).then(setData).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (loading) return <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center justify-center h-28"><Loader2 className="animate-spin text-indigo-500" size={22} /></div>;
  if (!data) return null;

  const active = data.items.filter(i => i.count > 0);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-extrabold text-gray-800 flex items-center gap-2">
          <Inbox size={18} className="text-indigo-600" /> مركز المهام
          {data.totalActions > 0
            ? <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{data.totalActions}</span>
            : <CheckCircle2 size={18} className="text-green-500" />}
        </h2>
        <button onClick={load} className="text-xs text-indigo-600 hover:underline flex items-center gap-1"><RefreshCw size={12} /> تحديث</button>
      </div>

      {active.length === 0 ? (
        <div className="text-center py-6 text-gray-400">
          <CheckCircle2 size={36} className="mx-auto mb-2 text-green-300" />
          <p className="text-sm">كل حاجة تمام — مفيش مهام عالقة 🎉</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {active.map(i => (
            <button key={i.key} onClick={() => onNavigate?.(i.link)}
              className={`text-right p-3 rounded-xl border transition hover:shadow-md ${SEV[i.severity]}`}>
              <div className="flex items-center justify-between">
                <span className="text-2xl font-extrabold">{i.count}</span>
                {i.severity === 'high' && <AlertTriangle size={15} />}
              </div>
              <p className="text-xs font-semibold mt-0.5 leading-snug">{i.label}</p>
              {onNavigate && <span className="text-[10px] opacity-70 flex items-center gap-0.5 mt-1">اذهب <ArrowLeft size={10} /></span>}
            </button>
          ))}
        </div>
      )}

      {data.pendingProofs.length > 0 && (
        <div className="mt-4 border-t border-gray-50 pt-3">
          <p className="text-[11px] font-bold text-gray-400 uppercase mb-2">إيصالات تنتظر المراجعة</p>
          <div className="space-y-1">
            {data.pendingProofs.slice(0, 5).map(p => (
              <div key={p.id} className="flex items-center justify-between text-xs text-gray-600 py-1 border-b border-gray-50 last:border-0">
                <span className="font-semibold">{p.subscriber_name || '—'}</span>
                <span className="text-emerald-700 font-bold">{Number(p.amount).toLocaleString()} {p.currency === 'EGP' ? 'ج.م' : p.currency}</span>
                <span className="text-gray-400">{String(p.submitted_at).slice(0, 10)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
