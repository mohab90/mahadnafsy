import { useEffect, useState } from 'react';
import {
  Megaphone, Plus, Eye, Send, XCircle, Trash2, Loader2, Users, Clock, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import {
  mysqlAdmin,
  type WhatsappCampaign, type WhatsappCampaignPreview, type MessagingChannel,
  type WhatsappCampaignRecipient,
} from '../../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

const STATUS_LABEL: Record<WhatsappCampaign['status'], string> = {
  draft: 'مسودة', scheduled: 'مجدولة', sending: 'جاري الإرسال',
  sent: 'تم الإرسال', failed: 'فشلت', cancelled: 'ملغاة',
};
const STATUS_STYLE: Record<WhatsappCampaign['status'], string> = {
  draft: 'bg-gray-100 text-gray-600',
  scheduled: 'bg-blue-100 text-blue-700',
  sending: 'bg-amber-100 text-amber-700',
  sent: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-200 text-gray-500',
};

const RECIPIENT_LABEL: Record<string, string> = {
  queued: 'في الطابور', sent: 'وصلت', failed: 'فشلت', skipped: 'مستبعد',
};
const RECIPIENT_STYLE: Record<string, string> = {
  queued: 'bg-blue-100 text-blue-700',
  sent: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-gray-200 text-gray-600',
};

const AUDIENCE_LABEL: Record<string, string> = {
  leads: 'العملاء المحتملون', subscribers: 'المشتركون', all: 'الكل',
  manual: 'قائمة يدوية', segment: 'شريحة مخصصة',
};

/**
 * Composing and sending a WhatsApp campaign.
 *
 * The preview is the centre of this screen, not a nicety. A blast cannot be
 * recalled and a bad one costs the number its reputation, so sending is
 * deliberately two steps: see exactly who receives it and who does not, then
 * commit.
 */
export function WhatsappCampaignsPanel({ notify }: { notify: NotifyFn }) {
  const [campaigns, setCampaigns] = useState<WhatsappCampaign[]>([]);
  const [channels, setChannels] = useState<MessagingChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [preview, setPreview] = useState<{ id: string; data: WhatsappCampaignPreview } | null>(null);
  // The per-recipient outcome. Loaded on demand rather than with the list: it is
  // thousands of rows and only ever looked at for one campaign at a time.
  const [recipients, setRecipients] = useState<{ id: string; data: WhatsappCampaignRecipient[] } | null>(null);

  const [draft, setDraft] = useState({
    name: '', messageTemplate: '', audience: 'leads' as WhatsappCampaign['audience'],
    channelId: '', throttlePerMinute: 60,
  });

  const load = async () => {
    setLoading(true);
    try {
      const [list, chans] = await Promise.all([
        mysqlAdmin.listWhatsappCampaigns(),
        mysqlAdmin.listMessagingChannels('whatsapp'),
      ]);
      setCampaigns(list);
      setChannels(chans);
    } catch { notify('error', 'تعذر تحميل الحملات'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const create = async () => {
    if (!draft.name.trim()) { notify('error', 'اسم الحملة مطلوب'); return; }
    if (!draft.messageTemplate.trim()) { notify('error', 'نص الرسالة مطلوب'); return; }
    setBusyId('new');
    try {
      await mysqlAdmin.createWhatsappCampaign({
        name: draft.name.trim(),
        messageTemplate: draft.messageTemplate.trim(),
        audience: draft.audience,
        channelId: draft.channelId || null,
        throttlePerMinute: draft.throttlePerMinute,
      });
      notify('success', 'تم إنشاء الحملة — راجع المستقبلين قبل الإرسال');
      setShowNew(false);
      setDraft(d => ({ ...d, name: '', messageTemplate: '' }));
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر إنشاء الحملة');
    } finally { setBusyId(''); }
  };

  const runPreview = async (id: string) => {
    setBusyId(id);
    try {
      setPreview({ id, data: await mysqlAdmin.previewWhatsappCampaign(id) });
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذرت المعاينة');
    } finally { setBusyId(''); }
  };

  const send = async (id: string) => {
    setBusyId(id);
    try {
      const result = await mysqlAdmin.sendWhatsappCampaign(id);
      notify('success', `تم جدولة ${result.queued} رسالة — هتخلص خلال ${result.estimatedMinutes} دقيقة تقريباً`);
      setPreview(null);
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر الإرسال');
    } finally { setBusyId(''); }
  };

  const cancel = async (id: string) => {
    setBusyId(id);
    try {
      const result = await mysqlAdmin.cancelWhatsappCampaign(id);
      notify('info', `تم إيقاف ${result.stopped} رسالة لسه ما اتبعتتش`);
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر الإيقاف');
    } finally { setBusyId(''); }
  };

  const showRecipients = async (id: string) => {
    setBusyId(id);
    try { setRecipients({ id, data: await mysqlAdmin.whatsappCampaignRecipients(id) }); }
    catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر تحميل التفاصيل'); }
    finally { setBusyId(''); }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try { await mysqlAdmin.deleteWhatsappCampaign(id); notify('success', 'تم الحذف'); await load(); }
    catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر الحذف'); }
    finally { setBusyId(''); }
  };

  const connectedChannels = channels.filter(c => c.isConnected && c.is_active === 1);

  return (
    <div className="space-y-5" dir="rtl">
      <div className="bg-gradient-to-l from-emerald-600 to-teal-600 rounded-2xl p-5 text-white flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2"><Megaphone size={22} />حملات الواتساب</h2>
          <p className="text-emerald-50 text-sm mt-1">رسائل تسويقية مجدولة بإيقاع آمن على الرقم</p>
        </div>
        <button
          onClick={() => setShowNew(v => !v)}
          className="flex items-center gap-2 px-4 py-2 bg-white/15 hover:bg-white/25 rounded-xl text-sm font-bold transition"
        >
          <Plus size={16} />حملة جديدة
        </button>
      </div>

      {connectedChannels.length === 0 && !loading && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            مفيش أي قناة واتساب متصلة. اربط قناة من «قنوات المراسلة» واختبرها الأول، وبعدها الحملات هتقدر تشتغل.
          </p>
        </div>
      )}

      {showNew && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
          <h3 className="font-bold text-gray-800 text-sm">حملة جديدة</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">اسم الحملة</label>
              <input
                value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                placeholder="عرض دبلومة الصحة النفسية"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">الجمهور</label>
              <select
                value={draft.audience}
                onChange={e => setDraft(d => ({ ...d, audience: e.target.value as WhatsappCampaign['audience'] }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white"
              >
                <option value="leads">العملاء المحتملون</option>
                <option value="subscribers">المشتركون</option>
                <option value="all">الكل</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">تُرسل من</label>
              <select
                value={draft.channelId}
                onChange={e => setDraft(d => ({ ...d, channelId: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white"
              >
                <option value="">القناة الافتراضية للشركة</option>
                {connectedChannels.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.label}{c.ownerName ? ` — ${c.ownerName}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">السرعة (رسالة/دقيقة)</label>
              <input
                type="number" min={1} max={600} value={draft.throttlePerMinute}
                onChange={e => setDraft(d => ({ ...d, throttlePerMinute: Number(e.target.value) || 60 }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono"
              />
              <p className="text-[11px] text-gray-500 mt-1">
                كل ما قلّت، كل ما كان أأمن على الرقم. 60 رقم معقول.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">نص الرسالة</label>
            <textarea
              value={draft.messageTemplate}
              onChange={e => setDraft(d => ({ ...d, messageTemplate: e.target.value }))}
              rows={4}
              placeholder={'أهلاً {{name}} 👋\nعندنا عرض جديد على دبلومة الصحة النفسية...'}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm leading-relaxed"
            />
            <p className="text-[11px] text-gray-500 mt-1">
              متغيرات متاحة: <code className="bg-gray-100 px-1 rounded">{'{{name}}'}</code>{' '}
              <code className="bg-gray-100 px-1 rounded">{'{{clientCode}}'}</code>{' '}
              <code className="bg-gray-100 px-1 rounded">{'{{status}}'}</code>
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={() => setShowNew(false)}
              className="px-4 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm font-bold hover:bg-gray-50 transition">
              إلغاء
            </button>
            <button onClick={create} disabled={busyId === 'new'}
              className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition disabled:opacity-50">
              {busyId === 'new' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}إنشاء
            </button>
          </div>
        </div>
      )}

      {/* Preview — the review step before anything is sent */}
      {preview && (
        <div className="bg-white border-2 border-emerald-300 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2">
              <Eye size={16} className="text-emerald-600" />معاينة قبل الإرسال
            </h3>
            <button onClick={() => setPreview(null)} className="text-xs text-gray-400 hover:text-gray-700">إغلاق</button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-emerald-50 rounded-xl p-3">
              <p className="text-[11px] text-emerald-700 flex items-center gap-1"><Users size={12} />هيستقبلوا</p>
              <p className="text-xl font-bold text-emerald-800 font-mono">{preview.data.recipientCount}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-[11px] text-gray-500">مستبعدين</p>
              <p className="text-xl font-bold text-gray-700 font-mono">{preview.data.skippedCount}</p>
            </div>
            <div className="bg-blue-50 rounded-xl p-3">
              <p className="text-[11px] text-blue-700 flex items-center gap-1"><Clock size={12} />المدة</p>
              <p className="text-xl font-bold text-blue-800 font-mono">~{preview.data.estimatedMinutes} د</p>
            </div>
            {preview.data.capReached && (
              <div className="bg-amber-50 rounded-xl p-3">
                <p className="text-[11px] text-amber-700">تنبيه</p>
                <p className="text-xs font-bold text-amber-800 mt-1">وصلنا للحد الأقصى</p>
              </div>
            )}
          </div>

          {preview.data.samples.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-600 mb-2">أمثلة على الرسالة كما ستصل:</p>
              <div className="space-y-2">
                {preview.data.samples.map((sample, i) => (
                  <div key={i} className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                    <p className="text-[11px] text-emerald-700 font-mono mb-1">+{sample.phone} · {sample.name || '—'}</p>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{sample.message}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {preview.data.skipReasons.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-600 mb-2">ليه استبعدنا ناس:</p>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {preview.data.skipReasons.map((row, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-xs bg-gray-50 rounded-lg px-3 py-1.5">
                    <span className="text-gray-600 truncate">{row.name || row.phone}</span>
                    <span className="text-gray-400 shrink-0">{row.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={() => send(preview.id)}
              disabled={busyId === preview.id || preview.data.recipientCount === 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition disabled:opacity-50"
            >
              {busyId === preview.id ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              أرسل لـ {preview.data.recipientCount} شخص
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center text-gray-400">
          <Loader2 className="animate-spin mx-auto mb-2" size={22} />جاري التحميل...
        </div>
      ) : campaigns.length === 0 ? (
        <p className="text-sm text-gray-400 bg-white border border-gray-100 rounded-2xl p-8 text-center">
          مفيش حملات لسه
        </p>
      ) : (
        <div className="space-y-3">
          {campaigns.map(campaign => {
            const busy = busyId === campaign.id;
            const editable = ['draft', 'scheduled', 'failed'].includes(campaign.status);
            return (
              <div key={campaign.id} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-800 text-sm">{campaign.name}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded font-bold ${STATUS_STYLE[campaign.status]}`}>
                        {STATUS_LABEL[campaign.status]}
                      </span>
                      <span className="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                        {AUDIENCE_LABEL[campaign.audience] || campaign.audience}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2 whitespace-pre-wrap">{campaign.message_template}</p>
                  </div>
                  {campaign.status === 'sent' && (
                    <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                  )}
                </div>

                {campaign.recipient_count > 0 && (
                  <div className="flex flex-wrap gap-3 text-[11px] text-gray-500 font-mono">
                    <span>المستقبلون: {campaign.recipient_count}</span>
                    {campaign.sent_count > 0 && <span className="text-emerald-600">وصلت: {campaign.sent_count}</span>}
                    {campaign.fail_count > 0 && <span className="text-red-600">فشلت: {campaign.fail_count}</span>}
                    {campaign.skipped_count > 0 && <span>مستبعدون: {campaign.skipped_count}</span>}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {editable && (
                    <button
                      onClick={() => runPreview(campaign.id)} disabled={busy}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold hover:bg-emerald-100 transition disabled:opacity-40"
                    >
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}معاينة وإرسال
                    </button>
                  )}
                  {campaign.status === 'sending' && (
                    <button
                      onClick={() => cancel(campaign.id)} disabled={busy}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-bold hover:bg-red-100 transition disabled:opacity-40"
                    >
                      <XCircle size={12} />إيقاف الإرسال
                    </button>
                  )}
                  {campaign.recipient_count > 0 && (
                    <button
                      onClick={() => showRecipients(campaign.id)} disabled={busy}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-50 text-sky-700 rounded-lg text-xs font-bold hover:bg-sky-100 transition disabled:opacity-40"
                    >
                      <Users size={12} />مين استلم ومين لأ
                    </button>
                  )}
                  {editable && (
                    <button
                      onClick={() => remove(campaign.id)} disabled={busy}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 text-gray-500 rounded-lg text-xs font-bold hover:bg-gray-100 transition disabled:opacity-40"
                    >
                      <Trash2 size={12} />حذف
                    </button>
                  )}
                </div>

                {/* Per-recipient outcome — answers "why didn't Ahmed get it?" */}
                {recipients?.id === campaign.id && (
                  <div className="border-t border-gray-100 pt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-gray-600">
                        {recipients.data.length} مستقبل
                      </p>
                      <button onClick={() => setRecipients(null)} className="text-xs text-gray-400 hover:text-gray-700">
                        إغلاق
                      </button>
                    </div>
                    <div className="max-h-64 overflow-y-auto space-y-1">
                      {recipients.data.map(row => (
                        <div key={row.id} className="flex items-center justify-between gap-2 text-xs bg-gray-50 rounded-lg px-3 py-1.5">
                          <span className="text-gray-700 truncate">{row.name || row.phone}</span>
                          <span className="flex items-center gap-2 shrink-0">
                            {row.skip_reason && <span className="text-gray-400">{row.skip_reason}</span>}
                            {row.last_error && !row.skip_reason && (
                              <span className="text-red-500 truncate max-w-[12rem]" title={row.last_error}>
                                {row.last_error}
                              </span>
                            )}
                            <span className={`px-2 py-0.5 rounded font-bold ${RECIPIENT_STYLE[row.status]}`}>
                              {RECIPIENT_LABEL[row.status]}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
