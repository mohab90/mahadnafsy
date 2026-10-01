import { useCallback, useEffect, useState } from 'react';
import { Activity, Loader2, Mail, MessageCircle, RefreshCw, RotateCw, ShieldCheck } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { useSiteData } from '../../../../context/SiteDataContext';
import { confirmDialog } from '../../../../../shared/ui/confirmDialog';
import { cairoDateTime } from '../../../../../shared/cairoDate';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type Summary = {
  byChannel: Array<{ channel: string; status: string; count: number; last_sent: string | null }>;
  topErrors: Array<{ error: string; channel: string; count: number }>;
  last24h: Array<{ channel: string; died: number; sent: number }>;
};
type Outbound = { env: string[]; always: string[]; panel: string[]; switchable: string[] };

// What each kind of WhatsApp message is, and how much it risks the number.
const KINDS: Record<string, { label: string; hint: string; risk?: boolean }> = {
  otp: { label: 'أكواد الدخول', hint: 'كود الدخول ونسيت كلمة المرور' },
  owner_report: { label: 'تقرير الإدارة اليومي', hint: 'للأرقام المحفوظة في «تقارير الإدارة»' },
  staff_alert: { label: 'تنبيهات الموظفين', hint: 'ليد اتأخرت متابعته — لرقم الموظف' },
  inbox_reply: { label: 'الرد على العملاء', hint: 'ردود صندوق الرسائل وتذاكر الدعم — العميل هو اللي بدأ' },
  payment: { label: 'إيصالات الدفع', hint: 'تأكيد كل دفعة للعميل' },
  reminder: { label: 'التذكير', hint: 'جلسة مباشرة، كورس وقف عنه العميل، حجز ما كملش' },
  crm: { label: 'رسايل المتابعة', hint: 'استلمنا رسالتك، الشهادة جاهزة، رسايل الموظفين' },
  welcome: { label: 'الترحيب', hint: 'لما حد يسجل أو يشترك' },
  automation: { label: 'الرسايل التلقائية', hint: 'الحملات المتسلسلة', risk: true },
  broadcast: { label: 'الحملات الجماعية', hint: 'رسايل لعدد كبير — أعلى خطر حظر للرقم', risk: true },
};

// Why a message died, in words a person can act on.
function explain(error: string): string {
  if (/category_disabled|موقوف/.test(error)) return 'النوع ده مقفول — يتفتح من «أنواع الرسايل» تحت.';
  if (/daily_limit_reached/.test(error)) return 'الرقم وصل لحده اليومي — الباقي بيتبعت تاني يوم.';
  if (/535|authentication failed|Invalid login/i.test(error)) return 'سيرفر الإيميل رافض كلمة السر — «الإعدادات ← البريد»: حط كلمة السر الصح واعمل إرسال تجربة.';
  if (/ETIMEDOUT|ENETUNREACH|timeout/i.test(error)) return 'سيرفر الإيميل مش بيرد — راجع العنوان والبورت في «الإعدادات ← البريد».';
  if (/invalid_number/.test(error)) return 'رقم العميل مكتوب غلط — يتصلح من ملف العميل.';
  if (/not_configured/.test(error)) return 'القناة مش متظبطة.';
  if (/payment|suspend|expired|not paid|unpaid/i.test(error)) return 'مزود الواتساب موقف الخدمة — جدّد الاشتراك.';
  return error;
}

/**
 * «رسايل العملاء»: what leaves, what dies and why, which kinds of WhatsApp
 * message may go out — the owner's switch, not an edit on the server — and the
 * last few days' dead messages sent again once their cause is fixed.
 */
export function MessagesHealthPanel({ notify }: { notify: NotifyFn }) {
  const { isAdmin, currentStaff } = useSiteData();
  const canSwitch = isAdmin || ['admin', 'manager'].includes(String(currentStaff?.role || '').toLowerCase());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [outbound, setOutbound] = useState<Outbound | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextSummary, nextOutbound] = await Promise.all([
        mysqlAdmin.adminGet<Summary>('/admin/messaging/outbox/summary'),
        mysqlAdmin.adminGet<Outbound>('/admin/messaging/outbound'),
      ]);
      setSummary(nextSummary);
      setOutbound(nextOutbound);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحميل حالة الرسايل');
    } finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (kind: string) => {
    if (!outbound) return;
    const next = outbound.panel.includes(kind) ? outbound.panel.filter(item => item !== kind) : [...outbound.panel, kind];
    if (!outbound.panel.includes(kind) && KINDS[kind]?.risk
      && !await confirmDialog({
        title: `فتح «${KINDS[kind].label}»`,
        message: `«${KINDS[kind].label}» بتروح لعدد كبير من غير ما يطلبوها، ودي اللي اتحظرت الأرقام بسببها قبل كده. تفتحها؟`,
        confirmLabel: 'افتحها',
      })) return;
    setBusy(kind);
    try {
      setOutbound(await mysqlAdmin.adminPut<Outbound>('/admin/messaging/outbound', { categories: next }));
      notify('success', next.includes(kind) ? `اتفتح: ${KINDS[kind]?.label || kind}` : `اتقفل: ${KINDS[kind]?.label || kind}`);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر الحفظ');
    } finally { setBusy(''); }
  };

  const requeue = async (channel: 'whatsapp' | 'email') => {
    setBusy(`requeue:${channel}`);
    try {
      const preview = await mysqlAdmin.adminPost<{ eligible: number; stillFailing: boolean }>('/admin/messaging/outbox/requeue', { channel, hours: 72 });
      if (!preview.eligible) { notify('info', 'مفيش رسايل متعطلة في آخر 3 أيام'); return; }
      const warning = preview.stillFailing ? '\nتنبيه: القناة لسه بتفشل في آخر 24 ساعة — صلّح السبب الأول.' : '';
      if (!await confirmDialog({
        title: 'إعادة إرسال',
        message: `إعادة إرسال لحد ${preview.eligible} رسالة متعطلة من آخر 3 أيام (${channel === 'email' ? 'إيميل' : 'واتساب'})؟\nاللي نوعها لسه مقفول أو رقمها غلط مش هتتبعت.${warning}`,
        confirmLabel: 'ابعتها',
        tone: preview.stillFailing ? 'danger' : 'normal',
      })) return;
      const result = await mysqlAdmin.adminPost<{ requeued: number; skipped: number }>('/admin/messaging/outbox/requeue', { channel, hours: 72, confirm: true });
      notify('success', `اتحط ${result.requeued} رسالة للإرسال${result.skipped ? ` — و${result.skipped} فضلت (نوعها مقفول أو رقمها غلط)` : ''}`);
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر إعادة الإرسال');
    } finally { setBusy(''); }
  };

  if (loading && !summary) {
    return <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="ml-2 animate-spin" size={18} /> جاري التحميل...</div>;
  }

  const channelCard = (channel: 'whatsapp' | 'email') => {
    const rows = (summary?.byChannel || []).filter(row => row.channel === channel);
    const lastSent = rows.map(row => row.last_sent).filter(Boolean).sort().pop() || null;
    const day = (summary?.last24h || []).find(row => row.channel === channel);
    const sent = Number(day?.sent) || 0;
    const died = Number(day?.died) || 0;
    const healthy = died === 0 || sent > 0;
    const errors = (summary?.topErrors || []).filter(row => row.channel === channel).slice(0, 4);
    const Icon = channel === 'email' ? Mail : MessageCircle;
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-extrabold text-gray-800"><Icon size={16} /> {channel === 'email' ? 'الإيميل' : 'الواتساب'}</h3>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${healthy ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
            {healthy ? 'شغال' : 'بيفشل'}
          </span>
        </div>
        <p className="text-xs text-gray-500">
          آخر 24 ساعة: <b className="text-emerald-700">{sent}</b> اتبعتت · <b className="text-red-600">{died}</b> فشلت
          {lastSent && <> · آخر رسالة وصلت {cairoDateTime(lastSent)}</>}
        </p>
        {errors.length > 0 && (
          <ul className="space-y-1.5">
            {errors.map(row => (
              <li key={row.error} className="rounded-xl bg-gray-50 px-3 py-2 text-xs">
                <b className="text-gray-800">{Number(row.count).toLocaleString('ar-EG-u-nu-latn')} رسالة</b> — <span className="text-gray-700">{explain(row.error)}</span>
              </li>
            ))}
          </ul>
        )}
        {canSwitch && (
          <button disabled={!!busy} onClick={() => void requeue(channel)}
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {busy === `requeue:${channel}` ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />} ابعت المتعطل من آخر 3 أيام
          </button>
        )}
      </div>
    );
  };

  const open = new Set([...(outbound?.env || []), ...(outbound?.always || []), ...(outbound?.panel || [])]);
  const allOpen = outbound?.env.includes('all');
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-extrabold text-gray-900"><Activity size={18} className="text-emerald-600" /> صحة الرسايل</h2>
        <button onClick={() => void load()} disabled={loading}
          className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} تحديث
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {channelCard('whatsapp')}
        {channelCard('email')}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
        <h3 className="flex items-center gap-2 font-extrabold text-gray-800"><ShieldCheck size={16} /> أنواع رسايل الواتساب المسموح بيها</h3>
        <p className="text-xs leading-5 text-gray-500">
          بعد حظر الأرقام الإرسال اتقفل غير لأكواد الدخول. كل نوع هنا بيتفتح لوحده، وحد الرقم اليومي بيفضل شغال على أي نوع مفتوح.
          {!canSwitch && ' الفتح والقفل للمالك والمديرين.'}
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          {Object.entries(KINDS).map(([kind, meta]) => {
            const fixed = allOpen || outbound?.env.includes(kind) || outbound?.always.includes(kind);
            const switchable = outbound?.switchable.includes(kind);
            const on = allOpen || open.has(kind);
            return (
              <div key={kind} className={`flex items-start justify-between gap-3 rounded-xl border px-3 py-2 ${on ? 'border-emerald-200 bg-emerald-50/50' : 'border-gray-200'}`}>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-800">{meta.label}{meta.risk && <span className="mr-1 text-[10px] font-bold text-amber-700">⚠ خطر حظر</span>}</p>
                  <p className="text-[11px] leading-4 text-gray-500">{meta.hint}</p>
                </div>
                {fixed ? (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">مفتوح دايماً</span>
                ) : switchable && canSwitch ? (
                  <button disabled={!!busy} onClick={() => void toggle(kind)}
                    className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold transition disabled:opacity-50 ${on ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
                    {busy === kind ? '…' : on ? 'مفتوح' : 'مقفول'}
                  </button>
                ) : (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${on ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{on ? 'مفتوح' : 'مقفول'}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
