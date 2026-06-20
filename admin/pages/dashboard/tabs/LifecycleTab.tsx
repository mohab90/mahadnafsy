import React, { useState, useEffect, useCallback } from 'react';
import { Workflow, Save, RefreshCw, Loader2, Mail, MessageCircle, CheckCircle2, Clock, XCircle } from 'lucide-react';

interface Step { key: string; channel: string; channelLabel: string; enabled: boolean; }
interface Event { event: string; label: string; steps: Step[]; }
interface Activity { channel: string; recipient: string; subject: string | null; status: string; attempts: number; created_at: string; sent_at: string | null; }

export default function LifecycleTab({ notify }: { notify?: (type: 'success' | 'error' | 'info', text: string) => void }) {
  const [enabled, setEnabled] = useState(true);
  const [events, setEvents] = useState<Event[]>([]);
  const [stepState, setStepState] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [counts, setCounts] = useState<{ pending?: number; sent?: number; failed?: number }>({});

  const toast = useCallback((m: string, k: 'success' | 'error' = 'success') => { if (notify) notify(k, m); else alert(m); }, [notify]);

  const loadActivity = useCallback(() => {
    fetch('/api/admin/lifecycle/activity', { credentials: 'include' })
      .then(r => r.json()).then(d => { setActivity(d.recent || []); setCounts(d.counts || {}); }).catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/admin/settings/lifecycle', { credentials: 'include' })
      .then(r => r.json()).then(d => {
        setEnabled(d.enabled !== false);
        setEvents(d.events || []);
        const st: Record<string, boolean> = {};
        (d.events || []).forEach((ev: Event) => ev.steps.forEach(s => { st[s.key] = s.enabled; }));
        setStepState(st);
      }).catch(() => {}).finally(() => setLoading(false));
    loadActivity();
  }, [loadActivity]);

  const save = async () => {
    setSaving(true);
    try {
      const steps: Record<string, boolean> = {};
      Object.entries(stepState).forEach(([k, v]) => { if (!v) steps[k] = false; }); // only store disabled
      const res = await fetch('/api/admin/settings/lifecycle', {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, steps }),
      });
      if (!res.ok) throw new Error('فشل الحفظ');
      toast('تم حفظ إعدادات الرحلة ✅');
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'فشل الحفظ', 'error'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-48"><Loader2 className="animate-spin text-indigo-500" size={26} /></div>;

  const statusChip = (s: string) =>
    s === 'sent' ? <span className="text-green-600 flex items-center gap-1"><CheckCircle2 size={12} />تم</span>
    : s === 'pending' ? <span className="text-amber-600 flex items-center gap-1"><Clock size={12} />منتظر</span>
    : <span className="text-red-500 flex items-center gap-1"><XCircle size={12} />فشل</span>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-2 text-gray-800"><Workflow size={18} className="text-indigo-600" /><h3 className="font-bold text-base">رحلة العميل المؤتمتة</h3></div>
      <p className="text-xs text-gray-500 -mt-3">الرسائل اللي بتروح للعملاء تلقائياً في كل مرحلة. شغّل/طفّي أي رسالة، وتابع سجل الإرسال.</p>

      {/* Master switch */}
      <label className="flex items-center justify-between bg-white border border-gray-200 rounded-2xl p-4">
        <span className="font-semibold text-sm text-gray-700">تفعيل الرحلة بالكامل</span>
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="w-5 h-5 accent-indigo-600" />
      </label>

      {/* Events + steps */}
      <div className={`space-y-3 ${enabled ? '' : 'opacity-50 pointer-events-none'}`}>
        {events.map(ev => (
          <div key={ev.event} className="bg-white border border-gray-200 rounded-2xl p-4">
            <p className="font-bold text-sm text-gray-800 mb-2">{ev.label}</p>
            <div className="flex flex-wrap gap-2">
              {ev.steps.map(s => (
                <label key={s.key} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs cursor-pointer ${stepState[s.key] ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-gray-50 border-gray-200 text-gray-400'}`}>
                  <input type="checkbox" checked={!!stepState[s.key]} onChange={e => setStepState(p => ({ ...p, [s.key]: e.target.checked }))} className="accent-indigo-600" />
                  {s.channel === 'email' ? <Mail size={13} /> : <MessageCircle size={13} />} {s.channelLabel}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button onClick={save} disabled={saving}
        className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-60">
        {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} حفظ
      </button>

      {/* Activity feed */}
      <section className="bg-white border border-gray-200 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold text-sm text-gray-700">سجل النشاط</h4>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-green-600">تم: {counts.sent ?? 0}</span>
            <span className="text-amber-600">منتظر: {counts.pending ?? 0}</span>
            <span className="text-red-500">فشل: {counts.failed ?? 0}</span>
            <button onClick={loadActivity} className="text-indigo-600 hover:underline flex items-center gap-1"><RefreshCw size={12} />تحديث</button>
          </div>
        </div>
        {activity.length === 0 ? <p className="text-xs text-gray-400 text-center py-4">لا يوجد نشاط بعد</p> : (
          <div className="space-y-1.5 max-h-72 overflow-auto">
            {activity.map((a, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-xs border-b border-gray-50 py-1.5">
                <span className="flex items-center gap-1.5 text-gray-500">{a.channel === 'email' ? <Mail size={12} /> : <MessageCircle size={12} />}{a.recipient}</span>
                <span className="text-gray-400 truncate flex-1 px-2">{a.subject || '—'}</span>
                <span>{statusChip(a.status)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
