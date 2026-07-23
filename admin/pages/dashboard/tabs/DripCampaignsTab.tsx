import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, Plus, Play, Pause, Trash2, Clock, ChevronDown, ChevronUp, CheckCircle, RefreshCw, Mail, UserPlus, X } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { useSiteData } from '../../../context/SiteDataContext';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface DripStep {
  delay_days: number;
  subject: string;
  body_html: string;
}

interface DripSequence {
  id: string;
  name: string;
  description: string | null;
  trigger_status: string | null;
  is_active: number | boolean;
  steps: DripStep[];
  created_at: string;
}

interface DripEnrollment {
  id: string;
  sequence_id: string;
  completed_at: string | null;
  failed_at: string | null;
  unsubscribed_at: string | null;
}

// Rewired onto the real drip engine (MKT-05/06/07). This tab used to CRUD
// api/admin/drip-campaigns — a table with no send worker at all (creating a
// sequence there did nothing, ever). The actual working system —
// drip_sequences + drip_enrollments, with a real 15-minute cron that sends
// each step's email (routes/analytics/campaigns.js) — already existed but
// had no admin UI: no way to add a step's content, and no way to enroll
// anyone. Both gaps are closed here.
export default function DripCampaignsTab({ notify }: { notify: NotifyFn }) {
  const { leads, subscribers } = useSiteData();
  const [sequences, setSequences] = useState<DripSequence[]>([]);
  const [enrollments, setEnrollments] = useState<DripEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'new'>('list');
  const [newSeq, setNewSeq] = useState({ name: '', description: '', trigger_status: '' });
  const [saving, setSaving] = useState(false);
  const [stepDraft, setStepDraft] = useState<DripStep>({ delay_days: 1, subject: '', body_html: '' });
  const [enrollTarget, setEnrollTarget] = useState<{ seqId: string; kind: 'lead' | 'subscriber'; id: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [seqRes, enrRes] = await Promise.all([
        mysqlAdmin.adminGet<DripSequence[]>('/admin/drip-sequences'),
        mysqlAdmin.adminGet<DripEnrollment[]>('/admin/drip-enrollments'),
      ]);
      setSequences(seqRes || []);
      setEnrollments(enrRes || []);
    } catch { notify('error', 'تعذّر تحميل التسلسلات'); }
    setLoading(false);
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  const statsFor = useCallback((seqId: string) => {
    const rows = enrollments.filter(e => e.sequence_id === seqId);
    const completed = rows.filter(e => e.completed_at).length;
    const active = rows.filter(e => !e.completed_at && !e.failed_at && !e.unsubscribed_at).length;
    return { enrolled: rows.length, completed, active };
  }, [enrollments]);

  const stats = useMemo(() => ({
    total: sequences.length,
    active: sequences.filter(s => !!s.is_active).length,
    totalEnrolled: enrollments.length,
    totalCompleted: enrollments.filter(e => e.completed_at).length,
  }), [sequences, enrollments]);

  async function toggleActive(seq: DripSequence) {
    try {
      await mysqlAdmin.adminPut(`/admin/drip-sequences/${seq.id}`, { is_active: seq.is_active ? 0 : 1 });
      setSequences(ss => ss.map(s => (s.id === seq.id ? { ...s, is_active: s.is_active ? 0 : 1 } : s)));
    } catch { notify('error', 'خطأ في التحديث'); }
  }

  async function deleteSeq(id: string) {
    if (!window.confirm('حذف هذا التسلسل؟ سيتم إيقاف كل الاشتراكات الجارية فيه.')) return;
    try {
      await mysqlAdmin.adminDelete(`/admin/drip-sequences/${id}`);
      notify('success', 'تم الحذف');
      void load();
    } catch { notify('error', 'خطأ في الحذف'); }
  }

  async function createSequence() {
    if (!newSeq.name.trim()) { notify('error', 'أدخل اسم التسلسل'); return; }
    setSaving(true);
    try {
      await mysqlAdmin.adminPost('/admin/drip-sequences', { ...newSeq, steps: [], is_active: 1 });
      notify('success', 'تم إنشاء التسلسل');
      setNewSeq({ name: '', description: '', trigger_status: '' });
      setView('list');
      void load();
    } catch { notify('error', 'فشل الإنشاء'); }
    setSaving(false);
  }

  async function addStep(seq: DripSequence) {
    if (!stepDraft.subject.trim() || !stepDraft.body_html.trim()) { notify('error', 'أدخل عنوان ونص الرسالة'); return; }
    const nextSteps = [...(seq.steps || []), { ...stepDraft }];
    try {
      await mysqlAdmin.adminPut(`/admin/drip-sequences/${seq.id}`, { steps: nextSteps });
      setSequences(ss => ss.map(s => (s.id === seq.id ? { ...s, steps: nextSteps } : s)));
      setStepDraft({ delay_days: (stepDraft.delay_days || 0) + 2, subject: '', body_html: '' });
      notify('success', 'تمت إضافة الخطوة');
    } catch { notify('error', 'تعذّرت إضافة الخطوة'); }
  }

  async function removeStep(seq: DripSequence, index: number) {
    const nextSteps = (seq.steps || []).filter((_, i) => i !== index);
    try {
      await mysqlAdmin.adminPut(`/admin/drip-sequences/${seq.id}`, { steps: nextSteps });
      setSequences(ss => ss.map(s => (s.id === seq.id ? { ...s, steps: nextSteps } : s)));
    } catch { notify('error', 'تعذّر حذف الخطوة'); }
  }

  async function enrollNow() {
    if (!enrollTarget) return;
    const { seqId, kind, id } = enrollTarget;
    if (!id) { notify('error', 'اختر عميلاً أو مشتركاً'); return; }
    try {
      await mysqlAdmin.adminPost(`/admin/drip-sequences/${seqId}/enroll`, kind === 'lead' ? { lead_id: id } : { subscriber_id: id });
      notify('success', 'تم التسجيل في التسلسل');
      setEnrollTarget(null);
      void load();
    } catch (e) { notify('error', e instanceof Error ? e.message : 'تعذّر التسجيل'); }
  }

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-fuchsia-600 to-pink-600 rounded-2xl p-5 text-white">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><Layers size={22} />حملات Drip (تسلسلية)</h2>
            <p className="text-fuchsia-100 text-sm mt-1">أتمتة الرسائل التسلسلية بناءً على سلوك العميل</p>
          </div>
          <button onClick={() => { setView(v => v === 'list' ? 'new' : 'list'); if (view === 'new') void load(); }}
            className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-xl text-sm font-bold transition">
            {view === 'list' ? <><Plus size={16} />تسلسل جديد</> : <><Layers size={16} />عرض التسلسلات</>}
          </button>
        </div>
      </div>

      {view === 'list' ? (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'إجمالي التسلسلات', val: stats.total, color: 'fuchsia' },
              { label: 'نشطة', val: stats.active, color: 'emerald' },
              { label: 'مشتركون في التسلسلات', val: stats.totalEnrolled, color: 'blue' },
              { label: 'أكملوا التسلسل', val: stats.totalCompleted, color: 'violet' },
            ].map(k => (
              <div key={k.label} className={`bg-${k.color}-50 border border-${k.color}-100 rounded-2xl p-4 text-center`}>
                <div className="text-xl font-extrabold text-gray-900">{k.val}</div>
                <div className="text-xs text-gray-500 mt-1">{k.label}</div>
              </div>
            ))}
          </div>

          {/* Sequences */}
          <div className="space-y-3">
            {loading && <div className="p-10 text-center text-gray-400"><RefreshCw size={20} className="animate-spin mx-auto mb-2" />جاري التحميل...</div>}
            {!loading && sequences.map(seq => {
              const seqStats = statsFor(seq.id);
              return (
              <div key={seq.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                <div className="flex items-center gap-4 px-4 py-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${seq.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    <Layers size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-800">{seq.name}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${seq.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                        {seq.is_active ? 'نشط' : 'موقوف'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-gray-500">
                      <span>{Array.isArray(seq.steps) ? seq.steps.length : 0} خطوة</span>
                      <span>•</span>
                      <span>{seqStats.enrolled} مشترك</span>
                      <span>•</span>
                      <span className="text-emerald-600">{seqStats.completed} أكمل</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => setEnrollTarget({ seqId: seq.id, kind: 'lead', id: '' })}
                      className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition" title="تسجيل عميل/مشترك">
                      <UserPlus size={14} />
                    </button>
                    <button onClick={() => toggleActive(seq)}
                      className={`p-1.5 rounded-lg transition ${seq.is_active ? 'text-amber-500 hover:bg-amber-50' : 'text-emerald-500 hover:bg-emerald-50'}`}>
                      {seq.is_active ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                    <button onClick={() => setExpandedId(expandedId === seq.id ? null : seq.id)}
                      className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition">
                      {expandedId === seq.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    <button onClick={() => deleteSeq(seq.id)} className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Enroll picker */}
                {enrollTarget?.seqId === seq.id && (
                  <div className="border-t border-gray-100 px-4 py-3 bg-blue-50 space-y-2">
                    <div className="flex items-center gap-2">
                      <select value={enrollTarget.kind} onChange={e => setEnrollTarget(t => t && { ...t, kind: e.target.value as 'lead' | 'subscriber', id: '' })}
                        className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white">
                        <option value="lead">ليد</option>
                        <option value="subscriber">مشترك</option>
                      </select>
                      <select value={enrollTarget.id} onChange={e => setEnrollTarget(t => t && { ...t, id: e.target.value })}
                        className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white">
                        <option value="">— اختر —</option>
                        {(enrollTarget.kind === 'lead' ? leads : subscribers).slice(0, 500).map((p: any) => (
                          <option key={p.id} value={p.id}>{p.name} {p.email ? `— ${p.email}` : ''}</option>
                        ))}
                      </select>
                      <button onClick={() => { void enrollNow(); }} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700">تسجيل</button>
                      <button onClick={() => setEnrollTarget(null)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg"><X size={14} /></button>
                    </div>
                  </div>
                )}

                {/* Expanded steps */}
                {expandedId === seq.id && (
                  <div className="border-t border-gray-100 px-4 py-4 space-y-4">
                    <div>
                      <h4 className="font-semibold text-gray-700 text-sm mb-3">خطوات التسلسل</h4>
                      {(!seq.steps || seq.steps.length === 0) ? (
                        <p className="text-gray-400 text-sm">لا توجد خطوات — أضف خطوة أدناه</p>
                      ) : (
                        <div className="space-y-2">
                          {seq.steps.map((step, i) => (
                            <div key={i} className="flex items-start gap-3">
                              <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0">
                                <Mail size={15} />
                              </div>
                              <div className="flex-1 bg-gray-50 rounded-xl p-3">
                                <div className="flex items-center gap-2 text-xs mb-1 flex-wrap">
                                  <span className="text-gray-500 flex items-center gap-1"><Clock size={10} />بعد {step.delay_days} يوم</span>
                                  <span className="text-gray-700 font-semibold">{step.subject}</span>
                                </div>
                                <p className="text-xs text-gray-600 line-clamp-2">{step.body_html}</p>
                              </div>
                              <button onClick={() => { void removeStep(seq, i); }} className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition flex-shrink-0">
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Add step form */}
                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                        <input type="number" min={0} value={stepDraft.delay_days}
                          onChange={e => setStepDraft(d => ({ ...d, delay_days: parseInt(e.target.value) || 0 }))}
                          placeholder="بعد كام يوم"
                          className="sm:col-span-1 border border-gray-300 rounded-lg px-2 py-1.5 text-xs" />
                        <input value={stepDraft.subject} onChange={e => setStepDraft(d => ({ ...d, subject: e.target.value }))}
                          placeholder="عنوان الرسالة"
                          className="sm:col-span-3 border border-gray-300 rounded-lg px-2 py-1.5 text-xs" />
                      </div>
                      <textarea value={stepDraft.body_html} onChange={e => setStepDraft(d => ({ ...d, body_html: e.target.value }))}
                        rows={2} placeholder="نص الرسالة (HTML مسموح)"
                        className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs resize-none" />
                      <button onClick={() => { void addStep(seq); }} className="flex items-center gap-1 px-3 py-1.5 bg-fuchsia-600 text-white rounded-lg text-xs font-bold hover:bg-fuchsia-700">
                        <Plus size={12} /> إضافة خطوة
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );})}
            {!loading && sequences.length === 0 && (
              <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center text-gray-400">
                <Layers size={36} className="mx-auto mb-3 text-gray-200" />
                <p>لا توجد تسلسلات</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-5">
          <h3 className="font-bold text-gray-800 flex items-center gap-2"><Plus size={16} className="text-fuchsia-500" />تسلسل Drip جديد</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">اسم التسلسل</label>
              <input value={newSeq.name} onChange={e => setNewSeq(s => ({ ...s, name: e.target.value }))}
                placeholder="تسلسل الترحيب"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-300" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">ملاحظة عن الموعد المناسب للتسجيل (اختياري)</label>
              <input value={newSeq.trigger_status} onChange={e => setNewSeq(s => ({ ...s, trigger_status: e.target.value }))}
                placeholder="مثال: عند اهتمام الليد"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-300" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1">وصف</label>
              <input value={newSeq.description} onChange={e => setNewSeq(s => ({ ...s, description: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-300" />
            </div>
          </div>
          <div className="bg-fuchsia-50 border border-fuchsia-200 rounded-xl p-3 text-fuchsia-700 text-xs">
            التسجيل في التسلسل يدوي حاليًا — بعد إنشائه، افتح التسلسل واضغط "تسجيل عميل/مشترك" لبدء إرسال خطواته لهم.
          </div>
          <div className="flex gap-3">
            <button onClick={() => { void createSequence(); }} disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-fuchsia-600 text-white rounded-xl text-sm font-bold hover:bg-fuchsia-700 transition disabled:opacity-50">
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle size={14} />}
              إنشاء التسلسل
            </button>
            <button onClick={() => { setView('list'); void load(); }} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200 transition">إلغاء</button>
          </div>
        </div>
      )}
    </div>
  );
}
