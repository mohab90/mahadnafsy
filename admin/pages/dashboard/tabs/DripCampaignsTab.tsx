import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, Plus, Play, Pause, Trash2, Clock, ChevronDown, ChevronUp, CheckCircle, RefreshCw, Mail, MessageSquare, Bell } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface DripStep {
  id: string;
  day: number;
  type: 'email' | 'sms' | 'whatsapp' | 'notification';
  subject?: string;
  message: string;
}

interface DripSequence {
  id: string;
  name: string;
  trigger_event: string;
  audience: string;
  status: 'active' | 'paused' | 'draft';
  steps: DripStep[];
  enrolled_count: number;
  completed_count: number;
  created_at: string;
}

const STEP_TYPE_ICON: Record<string, any> = {
  email: Mail, sms: MessageSquare, whatsapp: MessageSquare, notification: Bell,
};
const STEP_TYPE_COLOR: Record<string, string> = {
  email: 'bg-blue-100 text-blue-700',
  sms: 'bg-green-100 text-green-700',
  whatsapp: 'bg-emerald-100 text-emerald-700',
  notification: 'bg-amber-100 text-amber-700',
};
const STATUS_COLOR: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  paused: 'bg-amber-100 text-amber-700',
  draft: 'bg-gray-100 text-gray-600',
};
const STATUS_LABEL: Record<string, string> = {
  active: 'نشط', paused: 'موقوف', draft: 'مسودة',
};

export default function DripCampaignsTab({ notify }: { notify: NotifyFn }) {
  const { leads, subscribers } = useSiteData();
  const [sequences, setSequences] = useState<DripSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'new'>('list');
  const [newSeq, setNewSeq] = useState({ name: '', trigger_event: 'subscription_created', audience: 'subscribers' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/drip-campaigns`, { credentials: 'include' });
      if (res.ok) setSequences(await res.json());
    } catch { notify('error', 'تعذّر تحميل التسلسلات'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => ({
    total: sequences.length,
    active: sequences.filter(s => s.status === 'active').length,
    totalEnrolled: sequences.reduce((a, s) => a + (s.enrolled_count || 0), 0),
    totalCompleted: sequences.reduce((a, s) => a + (s.completed_count || 0), 0),
  }), [sequences]);

  async function toggleStatus(seq: DripSequence) {
    const newStatus = seq.status === 'active' ? 'paused' : seq.status === 'paused' ? 'active' : 'active';
    try {
      const res = await fetch(`/api/admin/drip-campaigns/${seq.id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: seq.name, trigger_event: seq.trigger_event, audience: seq.audience, status: newStatus, steps: seq.steps }),
      });
      if (res.ok) { setSequences(ss => ss.map(s => s.id === seq.id ? { ...s, status: newStatus } : s)); }
    } catch { notify('error', 'خطأ في التحديث'); }
  }

  async function deleteSeq(id: string) {
    try {
      const res = await fetch(`/api/admin/drip-campaigns/${id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) { notify('success', 'تم الحذف'); load(); }
    } catch { notify('error', 'خطأ في الحذف'); }
  }

  async function createSequence() {
    if (!newSeq.name.trim()) { notify('error', 'أدخل اسم التسلسل'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/drip-campaigns`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSeq),
      });
      if (res.ok) {
        notify('success', 'تم إنشاء التسلسل');
        setNewSeq({ name: '', trigger_event: 'subscription_created', audience: 'subscribers' });
        setView('list');
        load();
      } else notify('error', 'فشل الإنشاء');
    } catch { notify('error', 'خطأ في الاتصال'); }
    setSaving(false);
  }

  const TRIGGERS = [
    { value: 'subscription_created', label: 'عند الاشتراك' },
    { value: 'lead_status:interested', label: 'عند اهتمام الليد' },
    { value: 'lead_status:new', label: 'عند ليد جديد' },
    { value: 'consultation_completed', label: 'بعد إتمام استشارة' },
    { value: 'payment_received', label: 'عند استلام دفعة' },
  ];

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-fuchsia-600 to-pink-600 rounded-2xl p-5 text-white">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><Layers size={22} />حملات Drip (تسلسلية)</h2>
            <p className="text-fuchsia-100 text-sm mt-1">أتمتة الرسائل التسلسلية بناءً على سلوك العميل</p>
          </div>
          <button onClick={() => { setView(v => v === 'list' ? 'new' : 'list'); if (view === 'new') load(); }}
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
            {!loading && sequences.map(seq => (
              <div key={seq.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                <div className="flex items-center gap-4 px-4 py-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${STATUS_COLOR[seq.status]}`}>
                    <Layers size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-800">{seq.name}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLOR[seq.status]}`}>{STATUS_LABEL[seq.status]}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-gray-500">
                      <span>{Array.isArray(seq.steps) ? seq.steps.length : 0} خطوة</span>
                      <span>•</span>
                      <span>{seq.enrolled_count} مشترك</span>
                      <span>•</span>
                      <span className="text-emerald-600">{seq.completed_count} أكمل</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {seq.status !== 'draft' && (
                      <button onClick={() => toggleStatus(seq)}
                        className={`p-1.5 rounded-lg transition ${seq.status === 'active' ? 'text-amber-500 hover:bg-amber-50' : 'text-emerald-500 hover:bg-emerald-50'}`}>
                        {seq.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
                      </button>
                    )}
                    <button onClick={() => setExpandedId(expandedId === seq.id ? null : seq.id)}
                      className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition">
                      {expandedId === seq.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    <button onClick={() => deleteSeq(seq.id)} className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Expanded steps */}
                {expandedId === seq.id && (
                  <div className="border-t border-gray-100 px-4 py-4">
                    <h4 className="font-semibold text-gray-700 text-sm mb-3">خطوات التسلسل</h4>
                    {seq.steps.length === 0 ? (
                      <p className="text-gray-400 text-sm">لا توجد خطوات — أضف خطوات لهذا التسلسل</p>
                    ) : (
                      <div className="relative">
                        <div className="absolute right-5 top-5 bottom-5 w-0.5 bg-gray-200" />
                        <div className="space-y-3">
                          {seq.steps.map((step, i) => {
                            const Icon = STEP_TYPE_ICON[step.type] || Bell;
                            return (
                              <div key={step.id} className="flex items-start gap-3 relative">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 z-10 ${STEP_TYPE_COLOR[step.type]}`}>
                                  <Icon size={16} />
                                </div>
                                <div className="flex-1 bg-gray-50 rounded-xl p-3">
                                  <div className="flex items-center gap-2 text-xs mb-1 flex-wrap">
                                    <span className={`px-2 py-0.5 rounded-lg font-bold ${STEP_TYPE_COLOR[step.type]}`}>{step.type.toUpperCase()}</span>
                                    <span className="text-gray-500 flex items-center gap-1"><Clock size={10} />اليوم {step.day}</span>
                                    {step.subject && <span className="text-gray-600 font-semibold">{step.subject}</span>}
                                  </div>
                                  <p className="text-xs text-gray-600 line-clamp-2">{step.message}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {sequences.length === 0 && (
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
              <label className="block text-sm font-semibold text-gray-700 mb-1">المُحفِّز (Trigger)</label>
              <select value={newSeq.trigger_event} onChange={e => setNewSeq(s => ({ ...s, trigger_event: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-fuchsia-300">
                {TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">الجمهور</label>
              <select value={newSeq.audience} onChange={e => setNewSeq(s => ({ ...s, audience: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-fuchsia-300">
                <option value="subscribers">المشتركون</option>
                <option value="leads">الليدات</option>
                <option value="all">الجميع</option>
              </select>
            </div>
          </div>
          <div className="bg-fuchsia-50 border border-fuchsia-200 rounded-xl p-3 text-fuchsia-700 text-xs">
            بعد إنشاء التسلسل ستتمكن من إضافة الخطوات التفصيلية. الإرسال الفعلي يتطلب ربط API.
          </div>
          <div className="flex gap-3">
            <button onClick={createSequence} disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-fuchsia-600 text-white rounded-xl text-sm font-bold hover:bg-fuchsia-700 transition disabled:opacity-50">
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle size={14} />}
              إنشاء التسلسل
            </button>
            <button onClick={() => { setView('list'); load(); }} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200 transition">إلغاء</button>
          </div>
        </div>
      )}
    </div>
  );
}
