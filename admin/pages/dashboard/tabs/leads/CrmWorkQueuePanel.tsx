import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Clock3, PhoneCall, RefreshCw, Sparkles } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type Band = 'critical' | 'high' | 'medium' | 'low';

interface WorkItem {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  assigned_sales_name: string | null;
  next_follow_up_date: string | null;
  priorityScore: number;
  priorityBand: Band;
  nextAction: string;
  reasons: string[];
}

interface WorkQueue {
  generatedAt: string;
  summary: Record<Band, number> & { total: number; slaBreached: number };
  items: WorkItem[];
}

const BAND_STYLE: Record<Band, string> = {
  critical: 'border-red-200 bg-red-50 text-red-800',
  high: 'border-orange-200 bg-orange-50 text-orange-800',
  medium: 'border-amber-200 bg-amber-50 text-amber-800',
  low: 'border-gray-200 bg-gray-50 text-gray-700',
};
const ACTION_LABEL: Record<string, string> = {
  contact_now: 'تواصل الآن',
  contact_today: 'تواصل اليوم',
  first_contact: 'أول تواصل',
  prepare_follow_up: 'جهّز المتابعة',
  schedule_follow_up: 'حدد متابعة',
};

export function CrmWorkQueuePanel({ onOpenLead }: { onOpenLead: (leadId: string) => void }) {
  const [queue, setQueue] = useState<WorkQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setQueue(await mysqlAdmin.adminGet<WorkQueue>('/admin/crm/work-queue?limit=100'));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'تعذّر تحميل قائمة العمل');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="space-y-3 rounded-2xl border border-indigo-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-gray-900">
            <Sparkles size={16} className="text-indigo-600" />قائمة عمل السيلز حسب الأولوية
          </h3>
          <p className="text-xs text-gray-500">ترتيب قابل للتفسير حسب SLA والمتابعة والاهتمام والقيمة المتوقعة.</p>
        </div>
        <button type="button" onClick={() => { void load(); }} disabled={loading}
          className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 disabled:opacity-50">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />تحديث
        </button>
      </div>

      {queue && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {[
            ['حرج', queue.summary.critical, 'text-red-700 bg-red-50'],
            ['مرتفع', queue.summary.high, 'text-orange-700 bg-orange-50'],
            ['متوسط', queue.summary.medium, 'text-amber-700 bg-amber-50'],
            ['منخفض', queue.summary.low, 'text-gray-600 bg-gray-50'],
            ['SLA مكسور', queue.summary.slaBreached, 'text-violet-700 bg-violet-50'],
          ].map(([label, value, style]) => (
            <div key={String(label)} className={`rounded-xl p-2 text-center ${style}`}>
              <strong className="block text-lg">{value}</strong><span className="text-[11px]">{label}</span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <button type="button" onClick={() => { void load(); }}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-50 p-3 text-xs text-red-700">
          <AlertTriangle size={14} />{error} — إعادة المحاولة
        </button>
      )}
      {loading && !queue && <div className="p-6 text-center text-xs text-gray-400">جاري حساب الأولويات...</div>}
      {queue?.items.slice(0, 20).map(item => (
        <button type="button" key={item.id} onClick={() => onOpenLead(item.id)}
          className="flex w-full items-center gap-3 rounded-xl border border-gray-100 p-3 text-right transition hover:border-indigo-200 hover:bg-indigo-50/30">
          <span className={`min-w-16 rounded-lg border px-2 py-1 text-center text-xs font-extrabold ${BAND_STYLE[item.priorityBand]}`}>
            {item.priorityScore}
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-sm text-gray-900">{item.name}</strong>
            <span className="block truncate text-[11px] text-gray-500">
              {item.assigned_sales_name || 'غير معيّن'} · {item.reasons.slice(0, 2).join(' · ')}
            </span>
          </span>
          <span className="text-left">
            <span className="flex items-center gap-1 text-xs font-bold text-indigo-700">
              <PhoneCall size={12} />{ACTION_LABEL[item.nextAction] || item.nextAction}
            </span>
            {item.next_follow_up_date && (
              <span className="mt-1 flex items-center gap-1 text-[10px] text-gray-500">
                <Clock3 size={10} />{item.next_follow_up_date.slice(0, 10)}
              </span>
            )}
          </span>
        </button>
      ))}
      {queue && !queue.items.length && <div className="p-6 text-center text-sm text-emerald-700">لا توجد أعمال متابعة مفتوحة.</div>}
      {queue && queue.items.length > 20 && <p className="text-center text-xs text-gray-400">يعرض أعلى 20 من {queue.items.length}</p>}
    </section>
  );
}
