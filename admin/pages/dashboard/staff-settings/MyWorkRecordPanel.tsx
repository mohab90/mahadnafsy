import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, MessageSquare, Send, Target, TrendingUp, Users } from 'lucide-react';
import { adminAuthHeaders } from '../../../lib/adminAuthHeaders';

type Notify = (kind: 'success' | 'error' | 'warning' | 'info', message: string) => void;

type Report = {
  period: { key: string; label: string };
  revenue: number; bookings: number; biggestSale: number;
  leads: number; converted: number; conversionRate: number;
  touches: number; calls: number; whatsapp: number; meetings: number;
  tasksDone: number; tasksOpen: number;
};

type TargetRow = {
  period: string; revenueTarget: number; leadsTarget: number;
  actualRevenue: number; achievedPct: number | null;
};

type Message = {
  id: string; author_name: string | null;
  direction: 'to_staff' | 'from_staff' | 'peer_broadcast';
  broadcast_label: string | null; body: string; created_at: string;
};

type Resignation = {
  id: string; last_working_day: string; reason_note: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn';
  hr_note: string | null; created_at: string;
};

const PERIODS: [string, string][] = [
  ['today', 'اليوم'], ['yesterday', 'أمس'], ['week', 'الأسبوع'],
  ['days15', '15 يوم'], ['month', 'الشهر'], ['months3', '3 شهور'],
];

const egp = (n: number) => Number(n || 0).toLocaleString('ar-EG-u-nu-latn') + ' ج.م';
const monthLabel = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1))
    .toLocaleDateString('ar-EG-u-nu-latn', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

const getJson = <T,>(url: string): Promise<T | null> =>
  fetch(url, { credentials: 'include', headers: adminAuthHeaders() })
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null);

/**
 * The employee-facing half of the staff profile: what they achieved, how they
 * tracked against target month by month, a way to resign through the system,
 * and the thread with management and their own team.
 *
 * Everything reads from /api/staff/me/*, which resolves the staff row from the
 * caller — so this needs no HR permission and cannot be pointed at a colleague.
 */
export default function MyWorkRecordPanel({ notify }: { notify: Notify }) {
  const [period, setPeriod] = useState('month');
  const [report, setReport] = useState<Report | null>(null);
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [resignations, setResignations] = useState<Resignation[]>([]);
  const [draft, setDraft] = useState('');
  const [scope, setScope] = useState<'management' | 'team'>('management');
  const [sending, setSending] = useState(false);
  const [showResign, setShowResign] = useState(false);
  const [resignDraft, setResignDraft] = useState({ lastWorkingDay: '', reasonNote: '' });
  const [resigning, setResigning] = useState(false);

  useEffect(() => { getJson<Report>(`/api/staff/me/report?period=${period}`).then(setReport); }, [period]);

  const loadThread = useCallback(() => {
    getJson<Message[]>('/api/staff/me/messages').then(rows => setMessages(rows || []));
  }, []);

  useEffect(() => {
    getJson<TargetRow[]>('/api/staff/me/targets').then(rows => setTargets(rows || []));
    getJson<Resignation[]>('/api/staff/me/resignation').then(rows => setResignations(rows || []));
    loadThread();
  }, [loadThread]);

  // Only months that actually carry a target or some revenue — a table of
  // twelve empty rows tells the employee nothing.
  const targetRows = useMemo(
    () => targets.filter(t => t.revenueTarget > 0 || t.actualRevenue > 0),
    [targets],
  );

  const achievements = useMemo(() => {
    if (!report) return [];
    const out: { icon: string; title: string; note: string }[] = [];
    if (report.converted > 0) out.push({ icon: '🎯', title: `${report.converted} تحويل`, note: `من ${report.leads} ليد — معدل ${report.conversionRate}%` });
    if (report.revenue > 0) out.push({ icon: '💰', title: egp(report.revenue), note: `${report.bookings} حجز` });
    if (report.biggestSale > 0) out.push({ icon: '🏆', title: `أكبر صفقة ${egp(report.biggestSale)}`, note: 'في هذه الفترة' });
    if (report.calls > 0) out.push({ icon: '📞', title: `${report.calls} مكالمة`, note: `${report.touches} تواصل إجمالي` });
    if (report.tasksDone > 0) out.push({ icon: '✅', title: `${report.tasksDone} مهمة منجزة`, note: report.tasksOpen > 0 ? `${report.tasksOpen} مفتوحة` : 'لا مهام مفتوحة' });
    const hit = targets.find(t => t.period === new Date().toISOString().slice(0, 7));
    if (hit?.achievedPct != null && hit.achievedPct >= 100) out.push({ icon: '🌟', title: 'حقّقت تارجت الشهر', note: `${hit.achievedPct}% من الهدف` });
    return out;
  }, [report, targets]);

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      const r = await fetch('/api/staff/me/messages', {
        method: 'POST', credentials: 'include', headers: adminAuthHeaders(true),
        body: JSON.stringify({ body, scope }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'تعذر الإرسال');
      setDraft('');
      loadThread();
      notify('success', scope === 'team' ? 'وصلت لفريقك' : 'وصلت للإدارة');
    } catch (e) {
      notify('error', (e as Error).message);
    } finally { setSending(false); }
  };

  const submitResignation = async () => {
    if (!resignDraft.lastWorkingDay) { notify('error', 'حدد آخر يوم عمل'); return; }
    setResigning(true);
    try {
      const r = await fetch('/api/staff/me/resignation', {
        method: 'POST', credentials: 'include', headers: adminAuthHeaders(true),
        body: JSON.stringify(resignDraft),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'تعذر إرسال الطلب');
      setShowResign(false);
      setResignDraft({ lastWorkingDay: '', reasonNote: '' });
      getJson<Resignation[]>('/api/staff/me/resignation').then(rows => setResignations(rows || []));
      notify('success', 'تم إرسال طلب الاستقالة للموارد البشرية');
    } catch (e) {
      notify('error', (e as Error).message);
    } finally { setResigning(false); }
  };

  const pendingResignation = resignations.find(r => r.status === 'pending');

  return (
    <div className="space-y-5" dir="rtl">
      {/* ── Achievements ─────────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <h3 className="font-extrabold text-gray-900 flex items-center gap-2">
            <Award size={16} className="text-amber-500" /> سجل نجاحاتي
          </h3>
          <div className="flex flex-wrap gap-1">
            {PERIODS.map(([key, label]) => (
              <button key={key} type="button" onClick={() => setPeriod(key)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                  period === key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {achievements.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">لا توجد أرقام في هذه الفترة بعد — ابدأ واحدة وستظهر هنا.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {achievements.map(a => (
              <div key={a.title} className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                <span className="text-xl">{a.icon}</span>
                <p className="font-extrabold text-gray-900 text-sm mt-1">{a.title}</p>
                <p className="text-[11px] text-gray-500">{a.note}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Target: this month and the months before it ──────────────────── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <h3 className="font-extrabold text-gray-900 flex items-center gap-2 mb-4">
          <Target size={16} className="text-indigo-500" /> التارجت — هذا الشهر والشهور السابقة
        </h3>
        {targetRows.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">لم تُحدد لك تارجتات بعد.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="py-2 px-3 text-right font-bold text-gray-600">الشهر</th>
                  <th className="py-2 px-3 text-right font-bold text-gray-600">الهدف</th>
                  <th className="py-2 px-3 text-right font-bold text-gray-600">المحقق</th>
                  <th className="py-2 px-3 text-right font-bold text-gray-600">النسبة</th>
                </tr>
              </thead>
              <tbody>
                {targetRows.map(t => (
                  <tr key={t.period} className="border-b border-gray-50">
                    <td className="py-2 px-3 font-bold text-gray-800">{monthLabel(t.period)}</td>
                    <td className="py-2 px-3 text-gray-600">{t.revenueTarget > 0 ? egp(t.revenueTarget) : '—'}</td>
                    <td className="py-2 px-3 text-gray-900 font-semibold">{egp(t.actualRevenue)}</td>
                    <td className="py-2 px-3">
                      {t.achievedPct == null ? <span className="text-gray-300">—</span> : (
                        <span className={`px-2 py-0.5 rounded-full font-bold ${
                          t.achievedPct >= 100 ? 'bg-emerald-100 text-emerald-700'
                            : t.achievedPct >= 70 ? 'bg-amber-100 text-amber-700'
                              : 'bg-red-100 text-red-700'}`}>{t.achievedPct}%</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Thread with management / my team ─────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <h3 className="font-extrabold text-gray-900 flex items-center gap-2 mb-4">
          <MessageSquare size={16} className="text-sky-500" /> مراسلاتي
        </h3>
        <div className="max-h-72 overflow-y-auto space-y-2 mb-3">
          {messages.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">لا توجد رسائل بعد.</p>
          ) : messages.map(m => {
            const mine = m.direction === 'from_staff';
            const peer = m.direction === 'peer_broadcast';
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  mine ? 'bg-indigo-600 text-white'
                    : peer ? 'bg-violet-50 text-violet-900 border border-violet-200'
                      : 'bg-gray-100 text-gray-800'}`}>
                  <div className={`text-[10px] mb-0.5 ${mine ? 'text-indigo-200' : 'text-gray-500'}`}>
                    {mine ? 'أنا' : (m.author_name || 'الإدارة')}
                    {m.broadcast_label && ` · ${m.broadcast_label}`}
                    {' · '}{new Date(m.created_at).toLocaleString('ar-EG-u-nu-latn')}
                  </div>
                  <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="text-[11px] font-bold text-gray-600 mb-1 block">إلى</label>
            <select value={scope} onChange={e => setScope(e.target.value as 'management' | 'team')}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
              <option value="management">الإدارة</option>
              <option value="team">فريقي كله</option>
            </select>
          </div>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2}
            placeholder={scope === 'team' ? 'رسالة لكل زملائك في نفس القسم…' : 'اكتب رسالتك للإدارة…'}
            className="flex-1 min-w-[220px] border border-gray-200 rounded-xl px-3 py-2 text-sm resize-y" />
          <button type="button" disabled={sending || !draft.trim()} onClick={send}
            className="flex items-center gap-2 px-4 py-2.5 bg-sky-600 text-white rounded-xl font-bold text-sm hover:bg-sky-700 disabled:opacity-60 transition">
            {scope === 'team' ? <Users size={15} /> : <Send size={15} />} إرسال
          </button>
        </div>
      </div>

      {/* ── Resignation ──────────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h3 className="font-extrabold text-gray-900 flex items-center gap-2">
            <TrendingUp size={16} className="text-rose-500 rotate-180" /> إنهاء الخدمة
          </h3>
          {!pendingResignation && (
            <button type="button" onClick={() => setShowResign(v => !v)}
              className="text-xs px-3 py-1.5 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 font-bold hover:bg-rose-100 transition">
              {showResign ? 'إلغاء' : 'تقديم استقالة'}
            </button>
          )}
        </div>

        {pendingResignation && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            طلب استقالتك قيد المراجعة — آخر يوم عمل مطلوب:{' '}
            <strong>{new Date(pendingResignation.last_working_day).toLocaleDateString('ar-EG-u-nu-latn')}</strong>
          </div>
        )}

        {showResign && !pendingResignation && (
          <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50/60 p-4">
            <div>
              <label className="text-xs font-bold text-gray-600 mb-1 block">آخر يوم عمل</label>
              <input type="date" value={resignDraft.lastWorkingDay}
                onChange={e => setResignDraft(d => ({ ...d, lastWorkingDay: e.target.value }))}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white" />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-600 mb-1 block">السبب (اختياري)</label>
              <textarea rows={3} value={resignDraft.reasonNote}
                onChange={e => setResignDraft(d => ({ ...d, reasonNote: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-y" />
            </div>
            <p className="text-[11px] text-gray-500">
              الطلب يصل للموارد البشرية للمراجعة — لا يُنهي خدمتك تلقائيًا.
            </p>
            <button type="button" disabled={resigning} onClick={submitResignation}
              className="px-4 py-2 bg-rose-600 text-white rounded-xl font-bold text-sm hover:bg-rose-700 disabled:opacity-60 transition">
              إرسال الطلب
            </button>
          </div>
        )}

        {resignations.filter(r => r.status !== 'pending').length > 0 && (
          <div className="mt-3 space-y-1.5 text-xs">
            {resignations.filter(r => r.status !== 'pending').map(r => (
              <div key={r.id} className="flex items-center justify-between gap-2 border-b border-gray-50 pb-1.5">
                <span className="text-gray-600">{new Date(r.created_at).toLocaleDateString('ar-EG-u-nu-latn')}</span>
                <span className={`px-2 py-0.5 rounded-full font-bold ${
                  r.status === 'accepted' ? 'bg-emerald-100 text-emerald-700'
                    : r.status === 'declined' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                  {r.status === 'accepted' ? 'مقبول' : r.status === 'declined' ? 'مرفوض' : 'مسحوب'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
