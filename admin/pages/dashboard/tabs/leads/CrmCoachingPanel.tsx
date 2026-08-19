import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Link2, RefreshCw } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;
interface Communication {
  id: string;
  lead_name: string | null;
  staff_name: string | null;
  type: string;
  date: string;
  notes: string;
  evidence_count: number;
  review_count: number;
}
interface CoachingDashboard {
  staff: Array<{
    staff_id: string; staff_name: string; review_count: number; average_score: number;
    discovery_score: number; empathy_score: number; accuracy_score: number; next_step_score: number;
  }>;
  recentCommunications: Communication[];
}

export function CrmCoachingPanel({ notify }: { notify: Notify }) {
  const [data, setData] = useState<CoachingDashboard>({ staff: [], recentCommunications: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [communicationId, setCommunicationId] = useState('');
  const [evidence, setEvidence] = useState({ evidence_type: 'note', evidence_url: '', content_text: '' });
  const [evidenceId, setEvidenceId] = useState('');
  const [review, setReview] = useState({
    discovery_score: 3, empathy_score: 3, accuracy_score: 3, next_step_score: 3, comments: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await mysqlAdmin.adminGet<CoachingDashboard>('/admin/crm/coaching?days=30')); }
    catch (error) { notify('error', error instanceof Error ? error.message : 'تعذّر تحميل التدريب'); }
    finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(
    () => data.recentCommunications.find(row => row.id === communicationId),
    [communicationId, data.recentCommunications],
  );

  const addEvidence = async () => {
    if (!communicationId || (!evidence.evidence_url && !evidence.content_text)) return notify('error', 'اختر تواصلًا وأدخل الدليل');
    setSaving(true);
    try {
      const result = await mysqlAdmin.adminPost<{ id: string }>(`/admin/crm/communications/${communicationId}/evidence`, evidence);
      setEvidenceId(result.id);
      notify('success', 'تم تثبيت الدليل؛ يمكنك الآن تسجيل المراجعة');
      await load();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذّر حفظ الدليل'); }
    finally { setSaving(false); }
  };

  const saveReview = async () => {
    if (!communicationId || !evidenceId) return notify('error', 'احفظ دليلًا مرتبطًا أولًا');
    setSaving(true);
    try {
      await mysqlAdmin.adminPost('/admin/crm/coaching/reviews', {
        communication_id: communicationId, evidence_id: evidenceId, ...review,
      });
      notify('success', 'تم حفظ المراجعة المدعومة بالدليل');
      setCommunicationId('');
      setEvidenceId('');
      setEvidence({ evidence_type: 'note', evidence_url: '', content_text: '' });
      await load();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذّر حفظ المراجعة'); }
    finally { setSaving(false); }
  };

  return (
    <section className="space-y-4 rounded-2xl border border-violet-200 bg-white p-4" dir="rtl">
      <header className="flex items-center justify-between gap-2">
        <div><h3 className="flex items-center gap-2 font-bold text-gray-900"><ClipboardCheck size={17} className="text-violet-600" />مراجعة جودة المحادثات</h3>
          <p className="text-xs text-gray-500">لا توجد درجة بلا Recording/Transcript/رسالة أو ملاحظة موثقة.</p></div>
        <button type="button" onClick={() => { void load(); }} className="rounded-lg p-2 text-gray-500"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
      </header>

      {data.staff.length > 0 && <div className="grid gap-2 md:grid-cols-3">
        {data.staff.slice(0, 6).map(row => <div key={row.staff_id} className="rounded-xl bg-violet-50 p-3">
          <strong className="text-sm text-gray-900">{row.staff_name || row.staff_id}</strong>
          <div className="mt-1 text-xl font-black text-violet-700">{Number(row.average_score).toFixed(1)}%</div>
          <div className="text-[10px] text-gray-500">{row.review_count} مراجعة</div>
        </div>)}
      </div>}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2 rounded-xl border p-3">
          <label className="text-xs font-bold text-gray-700">التواصل محل المراجعة</label>
          <select value={communicationId} onChange={event => { setCommunicationId(event.target.value); setEvidenceId(''); }}
            className="w-full rounded-lg border px-2 py-2 text-xs">
            <option value="">اختر من آخر 30 يومًا</option>
            {data.recentCommunications.map(row => <option key={row.id} value={row.id}>
              {row.staff_name || 'غير منسوب'} — {row.lead_name || 'عميل'} — {row.type} — {new Date(row.date).toLocaleDateString('ar-EG-u-nu-latn')}
            </option>)}
          </select>
          {selected && <p className="rounded-lg bg-gray-50 p-2 text-xs text-gray-600">{selected.notes}</p>}
          <div className="flex gap-2">
            <select value={evidence.evidence_type} onChange={event => setEvidence(value => ({ ...value, evidence_type: event.target.value }))}
              className="rounded-lg border px-2 py-2 text-xs">
              <option value="note">ملاحظة</option><option value="recording">تسجيل</option><option value="transcript">تفريغ</option>
              <option value="email">Email</option><option value="whatsapp">WhatsApp</option>
            </select>
            <input value={evidence.evidence_url} onChange={event => setEvidence(value => ({ ...value, evidence_url: event.target.value }))}
              placeholder="رابط HTTPS للدليل (اختياري)" className="min-w-0 flex-1 rounded-lg border px-2 py-2 text-xs" />
          </div>
          <textarea value={evidence.content_text} onChange={event => setEvidence(value => ({ ...value, content_text: event.target.value }))}
            rows={3} placeholder="النص أو الملاحظة الموثقة" className="w-full rounded-lg border px-2 py-2 text-xs" />
          <button type="button" disabled={saving} onClick={() => { void addEvidence(); }}
            className="flex items-center gap-1 rounded-lg bg-violet-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
            <Link2 size={12} />تثبيت الدليل
          </button>
        </div>

        <div className="space-y-2 rounded-xl border p-3">
          <div className="grid grid-cols-2 gap-2">
            {[
              ['discovery_score', 'فهم الاحتياج'], ['empathy_score', 'التعاطف'],
              ['accuracy_score', 'دقة المعلومات'], ['next_step_score', 'وضوح الخطوة التالية'],
            ].map(([key, label]) => <label key={key} className="text-xs text-gray-600">{label}
              <input type="number" min={0} max={5} value={review[key as keyof typeof review]}
                onChange={event => setReview(value => ({ ...value, [key]: Number(event.target.value) }))}
                className="mt-1 w-full rounded-lg border px-2 py-1.5" />
            </label>)}
          </div>
          <textarea value={review.comments} onChange={event => setReview(value => ({ ...value, comments: event.target.value }))}
            rows={3} placeholder="ملاحظات المدرب" className="w-full rounded-lg border px-2 py-2 text-xs" />
          <button type="button" disabled={saving || !evidenceId} onClick={() => { void saveReview(); }}
            className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">حفظ المراجعة</button>
          {!evidenceId && <p className="text-[10px] text-amber-700">ثبّت الدليل أولًا؛ النظام يمنع التقييم غير المدعوم.</p>}
        </div>
      </div>
    </section>
  );
}
