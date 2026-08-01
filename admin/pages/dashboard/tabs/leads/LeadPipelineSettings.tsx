import { useCallback, useEffect, useState } from 'react';
import { Save, RefreshCw, GripVertical, Eye, EyeOff, Flag, AlertTriangle } from 'lucide-react';
import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';

// Stage configuration for the lead pipeline. The API (GET/PUT
// /api/admin/crm/pipeline) and the enforcement (validateTransition, called on
// every lead status change) already existed, but nothing in the dashboard ever
// called them — so the rules could only be changed by hand-crafting an API
// request, and most operators didn't know the capability existed at all.

interface Stage {
  status: string;
  label: string;
  position: number;
  showInPipeline: boolean;
  isTerminal: boolean;
  allowedNext: string[];
}

interface Props {
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}

export function LeadPipelineSettings({ notify }: Props) {
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/crm/pipeline', { credentials: 'include', headers: adminAuthHeaders() });
      if (!res.ok) throw new Error('تعذّر تحميل مراحل المسار');
      const data = await res.json();
      setStages((data?.stages || []).slice().sort((a: Stage, b: Stage) => a.position - b.position));
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const patch = (status: string, changes: Partial<Stage>) => {
    setStages(prev => prev.map(s => (s.status === status ? { ...s, ...changes } : s)));
    setDirty(true);
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= stages.length) return;
    const next = stages.slice();
    [next[index], next[target]] = [next[target], next[index]];
    // Renumber so the saved order matches what's on screen; the API sorts by
    // position, not by array index.
    setStages(next.map((s, i) => ({ ...s, position: (i + 1) * 10 })));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/admin/crm/pipeline', {
        method: 'PUT',
        credentials: 'include',
        headers: { ...adminAuthHeaders(true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ stages }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'تعذّر حفظ المراحل');
      setStages((data?.stages || stages).slice().sort((a: Stage, b: Stage) => a.position - b.position));
      setDirty(false);
      notify('success', 'تم حفظ مراحل المسار');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'خطأ غير متوقع';
      setError(msg);
      notify('error', msg);
    } finally {
      setSaving(false);
    }
  };

  const toggleAllowed = (stage: Stage, target: string) => {
    // '*' means "any transition". Picking specific targets replaces it, and
    // clearing every target falls back to '*' — an empty list would lock the
    // stage so no lead could ever leave it.
    const current = stage.allowedNext.includes('*') ? [] : stage.allowedNext;
    const next = current.includes(target) ? current.filter(s => s !== target) : [...current, target];
    patch(stage.status, { allowedNext: next.length ? next : ['*'] });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="bg-white border border-gray-200 rounded-2xl p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="font-bold text-gray-800 flex items-center gap-2"><Flag size={16} /> مراحل مسار العميل المحتمل</h3>
            <p className="text-xs text-gray-500 mt-1">
              الترتيب، الظهور في اللوحة، والانتقالات المسموحة. القواعد دي بتُطبَّق على كل تغيير حالة.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void load()} disabled={loading || saving}
              className="flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> إعادة تحميل
            </button>
            <button
              onClick={() => void save()} disabled={!dirty || saving || !stages.length}
              className="flex items-center gap-1.5 bg-emerald-600 text-white text-xs font-bold px-4 py-1.5 rounded-lg hover:bg-emerald-700 transition disabled:opacity-50"
            >
              <Save size={13} /> {saving ? 'جارٍ الحفظ…' : 'حفظ'}
            </button>
          </div>
        </div>
        {dirty && (
          <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 inline-flex items-center gap-1.5">
            <AlertTriangle size={13} /> فيه تعديلات غير محفوظة
          </p>
        )}
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">{error}</div>}

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        {loading && !stages.length ? (
          <div className="py-10 text-center text-gray-400 text-sm">جارٍ التحميل…</div>
        ) : !stages.length ? (
          <div className="py-10 text-center text-gray-400 text-sm">لا توجد مراحل معرّفة</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {stages.map((stage, index) => (
              <div key={stage.status} className="p-4 hover:bg-gray-50/60 transition">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="flex flex-col gap-0.5 pt-1">
                    <button
                      onClick={() => move(index, -1)} disabled={index === 0}
                      className="text-gray-400 hover:text-emerald-600 disabled:opacity-30" title="لأعلى"
                    >▲</button>
                    <GripVertical size={13} className="text-gray-300" />
                    <button
                      onClick={() => move(index, 1)} disabled={index === stages.length - 1}
                      className="text-gray-400 hover:text-emerald-600 disabled:opacity-30" title="لأسفل"
                    >▼</button>
                  </div>

                  <div className="flex-1 min-w-[220px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        value={stage.label}
                        onChange={e => patch(stage.status, { label: e.target.value })}
                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold min-w-[160px] focus:outline-none focus:ring-2 focus:ring-emerald-300"
                      />
                      <span className="text-[11px] font-mono text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">{stage.status}</span>
                    </div>

                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                        <input
                          type="checkbox" checked={stage.showInPipeline}
                          onChange={e => patch(stage.status, { showInPipeline: e.target.checked })}
                          className="w-3.5 h-3.5 rounded"
                        />
                        {stage.showInPipeline ? <Eye size={12} /> : <EyeOff size={12} />} تظهر في اللوحة
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                        <input
                          type="checkbox" checked={stage.isTerminal}
                          onChange={e => patch(stage.status, { isTerminal: e.target.checked })}
                          className="w-3.5 h-3.5 rounded"
                        />
                        مرحلة نهائية
                      </label>
                    </div>

                    <div className="mt-2">
                      <p className="text-[11px] text-gray-500 mb-1">
                        الانتقالات المسموحة {stage.allowedNext.includes('*') && <span className="text-emerald-600 font-bold">(الكل مسموح)</span>}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {stages.filter(s => s.status !== stage.status).map(target => {
                          const on = stage.allowedNext.includes('*') || stage.allowedNext.includes(target.status);
                          return (
                            <button
                              key={target.status}
                              onClick={() => toggleAllowed(stage, target.status)}
                              className={`px-2 py-0.5 rounded-lg text-[11px] font-medium border transition ${
                                on ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-gray-200 text-gray-400'
                              }`}
                            >
                              {target.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default LeadPipelineSettings;
