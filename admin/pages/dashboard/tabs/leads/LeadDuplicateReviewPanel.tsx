import { useCallback, useEffect, useState } from 'react';
import { GitMerge, RefreshCw, RotateCcw } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { NotifyFn } from '../CrmSettingsModal';

interface DuplicateLead {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  status?: string;
  score?: number;
  client_code?: string;
  created_at?: string;
}

interface DuplicateGroup {
  targetId: string;
  leads: DuplicateLead[];
}

interface MergeHistory {
  id: string;
  targetId: string;
  sourceId: string;
  targetName?: string;
  sourceName?: string;
  actor?: string;
  createdAt?: string;
  revertedAt?: string | null;
}

export function LeadDuplicateReviewPanel({
  notify,
  onChanged,
}: {
  notify: NotifyFn;
  onChanged: () => void;
}) {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [history, setHistory] = useState<MergeHistory[]>([]);
  const [targets, setTargets] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [duplicates, mergeHistory] = await Promise.all([
        mysqlAdmin.listLeadDuplicates(),
        mysqlAdmin.listLeadMergeHistory(),
      ]);
      const nextGroups = (duplicates.groups || []) as unknown as DuplicateGroup[];
      setGroups(nextGroups);
      setTargets(Object.fromEntries(nextGroups.map((group, index) => [index, group.targetId])));
      setHistory(mergeHistory as unknown as MergeHistory[]);
    } catch {
      notify('error', 'تعذر تحميل مراجعة التكرار');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  const merge = async (group: DuplicateGroup, index: number) => {
    const targetId = targets[index] || group.targetId;
    const sourceIds = group.leads.map(lead => lead.id).filter(id => id !== targetId);
    const target = group.leads.find(lead => lead.id === targetId);
    if (!sourceIds.length || !window.confirm(
      `سيتم دمج ${sourceIds.length} سجل داخل "${target?.name || targetId}". يمكن فك الدمج لاحقًا. هل تؤكد؟`
    )) return;
    setBusyId(`merge-${index}`);
    try {
      await mysqlAdmin.mergeLeads(targetId, sourceIds);
      notify('success', `تم دمج ${sourceIds.length} سجل مع الاحتفاظ بسجل استرجاع`);
      onChanged();
      await load();
    } catch {
      notify('error', 'فشل الدمج؛ لم يتم تغيير السجلات');
    } finally {
      setBusyId('');
    }
  };

  const unmerge = async (row: MergeHistory) => {
    if (!window.confirm(`فك دمج "${row.sourceName || row.sourceId}" وإعادته كسجل مستقل؟`)) return;
    setBusyId(`unmerge-${row.id}`);
    try {
      await mysqlAdmin.unmergeLead(row.sourceId);
      notify('success', 'تم فك الدمج واستعادة الروابط الأصلية');
      onChanged();
      await load();
    } catch {
      notify('error', 'تعذر فك الدمج؛ راجع حالة السجل والروابط');
    } finally {
      setBusyId('');
    }
  };

  if (loading) {
    return <div className="rounded-2xl border border-gray-100 bg-white py-12 text-center text-sm text-gray-500">جاري فحص التكرار...</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-100 bg-amber-50 p-4">
        <div>
          <h3 className="font-bold text-gray-900">مراجعة التكرار قبل الدمج</h3>
          <p className="mt-1 text-xs text-gray-600">لا يتم حذف أي Lead تلقائيًا. اختر السجل الرئيسي وراجع البيانات ثم أكد الدمج.</p>
        </div>
        <button onClick={() => void load()} className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-bold text-gray-700 shadow-sm">
          <RefreshCw size={14} /> تحديث
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 py-10 text-center font-bold text-emerald-700">لا توجد مجموعات مكررة تحتاج مراجعة</div>
      ) : groups.map((group, index) => (
        <section key={group.leads.map(lead => lead.id).join('-')} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3">
            <span className="text-sm font-bold text-gray-800">مجموعة #{index + 1} · {group.leads.length} سجلات</span>
            <button
              disabled={busyId === `merge-${index}`}
              onClick={() => void merge(group, index)}
              className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              <GitMerge size={14} /> {busyId === `merge-${index}` ? 'جاري الدمج...' : 'دمج بعد المراجعة'}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-right text-sm">
              <thead className="bg-white text-xs text-gray-500">
                <tr>
                  <th className="p-3">الرئيسي</th><th className="p-3">الاسم</th><th className="p-3">الهاتف</th>
                  <th className="p-3">البريد</th><th className="p-3">الحالة</th><th className="p-3">النقاط</th><th className="p-3">كود العميل</th>
                </tr>
              </thead>
              <tbody>
                {group.leads.map(lead => (
                  <tr key={lead.id} className={targets[index] === lead.id ? 'bg-indigo-50' : 'border-t border-gray-100'}>
                    <td className="p-3"><input type="radio" name={`duplicate-target-${index}`} checked={targets[index] === lead.id} onChange={() => setTargets(current => ({ ...current, [index]: lead.id }))} /></td>
                    <td className="p-3 font-bold text-gray-900">{lead.name || 'بدون اسم'}</td>
                    <td className="p-3" dir="ltr">{lead.phone || '—'}</td>
                    <td className="p-3">{lead.email || '—'}</td>
                    <td className="p-3">{lead.status || '—'}</td>
                    <td className="p-3">{Number(lead.score || 0)}</td>
                    <td className="p-3">{lead.client_code || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <h3 className="mb-3 font-bold text-gray-900">سجل الدمج والاسترجاع</h3>
        <div className="space-y-2">
          {history.length === 0 && <p className="text-sm text-gray-500">لا توجد عمليات دمج مسجلة.</p>}
          {history.map(row => (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 p-3 text-sm">
              <div>
                <span className="font-bold">{row.sourceName || row.sourceId}</span>
                <span className="mx-2 text-gray-400">←</span>
                <span>{row.targetName || row.targetId}</span>
                <p className="mt-1 text-xs text-gray-500">{row.actor || 'النظام'} · {row.createdAt ? new Date(row.createdAt).toLocaleString('ar-EG') : '—'}</p>
              </div>
              {row.revertedAt ? (
                <span className="rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-500">تم فك الدمج</span>
              ) : (
                <button
                  disabled={busyId === `unmerge-${row.id}`}
                  onClick={() => void unmerge(row)}
                  className="flex items-center gap-1.5 rounded-xl border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-50"
                >
                  <RotateCcw size={14} /> فك الدمج
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
