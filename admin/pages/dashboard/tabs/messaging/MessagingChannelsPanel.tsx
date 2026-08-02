import { useEffect, useMemo, useState } from 'react';
import {
  Radio, Plus, Star, Power, Trash2, Send, Loader2, CheckCircle2, AlertTriangle, Building2, User,
} from 'lucide-react';
import { mysqlAdmin, type MessagingChannel } from '../../../../lib/mysqlapi';
import { toDialable } from '../../../../lib/whatsappLink';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

/**
 * Every identity the institute can send from, in one place.
 *
 * The admin's job here is mostly triage: which channels are connected, which
 * are erroring, and how close each is to its daily limit — because a rep whose
 * personal number is at 95% is about to stop being able to message customers
 * and nobody will tell them.
 */
export function MessagingChannelsPanel({ notify }: { notify: NotifyFn }) {
  const [channels, setChannels] = useState<MessagingChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const [draft, setDraft] = useState({
    kind: 'whatsapp' as 'whatsapp' | 'messenger',
    provider: 'green-api',
    label: '',
    displayNumber: '',
    instanceId: '', apiToken: '',
    metaPhoneId: '', metaToken: '',
    pageId: '', pageAccessToken: '',
    dailySendLimit: 1000,
    makeDefault: false,
  });

  const load = async () => {
    setLoading(true);
    try { setChannels(await mysqlAdmin.listMessagingChannels()); }
    catch { notify('error', 'تعذر تحميل القنوات'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const { company, staff } = useMemo(() => ({
    company: channels.filter(c => !c.owner_staff_id),
    staff: channels.filter(c => c.owner_staff_id),
  }), [channels]);

  const buildCredentials = (): Record<string, string> => {
    if (draft.kind === 'messenger') {
      return { pageId: draft.pageId.trim(), pageAccessToken: draft.pageAccessToken.trim() };
    }
    return draft.provider === 'meta'
      ? { metaPhoneId: draft.metaPhoneId.trim(), metaToken: draft.metaToken.trim() }
      : { instanceId: draft.instanceId.trim(), apiToken: draft.apiToken.trim() };
  };

  const add = async () => {
    if (!draft.label.trim()) { notify('error', 'اسم القناة مطلوب'); return; }
    const credentials = buildCredentials();
    if (Object.values(credentials).some(v => !v)) { notify('error', 'أكمل بيانات الاتصال'); return; }
    setBusyId('new');
    try {
      await mysqlAdmin.createMessagingChannel({
        kind: draft.kind,
        provider: draft.kind === 'messenger' ? 'messenger' : draft.provider,
        label: draft.label.trim(),
        displayNumber: draft.displayNumber.trim() || undefined,
        credentials,
        dailySendLimit: draft.dailySendLimit,
        makeDefault: draft.makeDefault,
      });
      notify('success', 'تمت إضافة القناة — اختبرها عشان تتأكد');
      setShowAdd(false);
      setDraft(d => ({ ...d, label: '', displayNumber: '', instanceId: '', apiToken: '', metaPhoneId: '', metaToken: '', pageId: '', pageAccessToken: '' }));
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذرت إضافة القناة');
    } finally { setBusyId(''); }
  };

  const act = async (id: string, fn: () => Promise<unknown>, okMessage: string) => {
    setBusyId(id);
    try { await fn(); notify('success', okMessage); await load(); }
    catch (error) { notify('error', error instanceof Error ? error.message : 'فشل الإجراء'); await load(); }
    finally { setBusyId(''); }
  };

  const ChannelRow = ({ channel }: { channel: MessagingChannel }) => {
    const limit = channel.daily_send_limit || 0;
    const usedPct = limit ? Math.min(100, Math.round((channel.sent_today / limit) * 100)) : 0;
    const busy = busyId === channel.id;
    return (
      <div className="border border-gray-200 rounded-xl p-4 bg-white flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-gray-800 text-sm">{channel.label}</span>
              {channel.is_default === 1 && (
                <span className="text-[11px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-bold">الافتراضية</span>
              )}
              <span className="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-mono">{channel.provider}</span>
              {channel.is_active === 0 && (
                <span className="text-[11px] bg-gray-200 text-gray-600 px-2 py-0.5 rounded font-bold">موقوفة</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
              {channel.display_number && <span className="font-mono">+{channel.display_number}</span>}
              {channel.ownerName && <span>· {channel.ownerName}</span>}
            </div>
            {channel.last_error && <p className="text-xs text-red-600 mt-1">{channel.last_error}</p>}
          </div>
          <div className="flex items-center gap-1.5">
            {channel.isConnected
              ? <span className="flex items-center gap-1 text-xs font-bold text-emerald-600"><CheckCircle2 size={14} />متصلة</span>
              : <span className="flex items-center gap-1 text-xs font-bold text-amber-600"><AlertTriangle size={14} />
                {channel.status === 'error' ? 'خطأ' : 'لم تُختبر'}</span>}
          </div>
        </div>

        {limit > 0 && (
          <div>
            <div className="flex justify-between text-[11px] text-gray-500 mb-1">
              <span>مرسل اليوم</span>
              <span className="font-mono">{channel.sent_today} / {limit}</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${usedPct > 85 ? 'bg-red-500' : usedPct > 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${usedPct}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {/* Messenger verifies by asking Facebook who the token belongs to —
              it has no recipient to send to until a customer writes in. */}
          <button
            onClick={() => act(
              channel.id,
              () => mysqlAdmin.testMessagingChannel(channel.id),
              channel.kind === 'messenger' ? 'التوكن سليم — الصفحة متصلة' : 'وصلت الرسالة — القناة شغالة',
            )}
            disabled={busy || (channel.kind === 'whatsapp' && !channel.display_number)}
            title={channel.kind === 'whatsapp' && !channel.display_number ? 'أضف رقماً للقناة أولاً' : ''}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-xs font-bold hover:bg-green-100 transition disabled:opacity-40"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            {channel.kind === 'messenger' ? 'تحقّق' : 'اختبار'}
          </button>
          {!channel.owner_staff_id && channel.is_default === 0 && (
            <button
              onClick={() => act(channel.id, () => mysqlAdmin.setDefaultMessagingChannel(channel.id), 'أصبحت القناة الافتراضية')}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-xs font-bold hover:bg-amber-100 transition disabled:opacity-40"
            >
              <Star size={12} />اجعلها الافتراضية
            </button>
          )}
          <button
            onClick={() => act(channel.id, () => mysqlAdmin.updateMessagingChannel(channel.id, { isActive: channel.is_active === 0 }), channel.is_active === 1 ? 'تم إيقاف القناة' : 'تم تفعيل القناة')}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 text-gray-600 rounded-lg text-xs font-bold hover:bg-gray-100 transition disabled:opacity-40"
          >
            <Power size={12} />{channel.is_active === 1 ? 'إيقاف' : 'تفعيل'}
          </button>
          <button
            onClick={() => act(channel.id, () => mysqlAdmin.deleteMessagingChannel(channel.id), 'تم حذف القناة')}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-bold hover:bg-red-100 transition disabled:opacity-40"
          >
            <Trash2 size={12} />حذف
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5" dir="rtl">
      <div className="bg-gradient-to-l from-teal-600 to-emerald-600 rounded-2xl p-5 text-white flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2"><Radio size={22} />قنوات المراسلة</h2>
          <p className="text-teal-50 text-sm mt-1">أرقام الواتساب وحسابات الماسنجر اللي السيستم بيبعت منها</p>
        </div>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="flex items-center gap-2 px-4 py-2 bg-white/15 hover:bg-white/25 rounded-xl text-sm font-bold transition"
        >
          <Plus size={16} />إضافة قناة
        </button>
      </div>

      {showAdd && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
          <h3 className="font-bold text-gray-800 text-sm">قناة جديدة</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">النوع</label>
              <select
                value={draft.kind}
                onChange={e => setDraft(d => ({ ...d, kind: e.target.value as 'whatsapp' | 'messenger' }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white"
              >
                <option value="whatsapp">واتساب</option>
                <option value="messenger">ماسنجر (صفحة فيسبوك)</option>
              </select>
            </div>
            {draft.kind === 'whatsapp' && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">المزوّد</label>
                <select
                  value={draft.provider}
                  onChange={e => setDraft(d => ({ ...d, provider: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white"
                >
                  <option value="green-api">Green-API</option>
                  <option value="meta">WhatsApp Cloud API</option>
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">الاسم</label>
              <input
                value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
                placeholder="واتساب الشركة الرئيسي"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
              />
            </div>
            {draft.kind === 'whatsapp' && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">الرقم</label>
                <input
                  value={draft.displayNumber} onChange={e => setDraft(d => ({ ...d, displayNumber: e.target.value }))}
                  placeholder="01012345678"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono"
                />
                {draft.displayNumber && !toDialable(draft.displayNumber) && (
                  <p className="text-xs text-red-600 mt-1">الرقم ده مش هينفع يستقبل رسايل</p>
                )}
              </div>
            )}

            {draft.kind === 'messenger' ? (
              <>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Page ID</label>
                  <input value={draft.pageId} onChange={e => setDraft(d => ({ ...d, pageId: e.target.value }))}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Page Access Token</label>
                  <input type="password" value={draft.pageAccessToken} onChange={e => setDraft(d => ({ ...d, pageAccessToken: e.target.value }))}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono" />
                </div>
              </>
            ) : draft.provider === 'meta' ? (
              <>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Phone Number ID</label>
                  <input value={draft.metaPhoneId} onChange={e => setDraft(d => ({ ...d, metaPhoneId: e.target.value }))}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Access Token</label>
                  <input type="password" value={draft.metaToken} onChange={e => setDraft(d => ({ ...d, metaToken: e.target.value }))}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono" />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Instance ID</label>
                  <input value={draft.instanceId} onChange={e => setDraft(d => ({ ...d, instanceId: e.target.value }))}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">API Token</label>
                  <input type="password" value={draft.apiToken} onChange={e => setDraft(d => ({ ...d, apiToken: e.target.value }))}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono" />
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">الحد اليومي للرسائل</label>
              <input
                type="number" min={1} value={draft.dailySendLimit}
                onChange={e => setDraft(d => ({ ...d, dailySendLimit: Number(e.target.value) || 1000 }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono"
              />
              <p className="text-[11px] text-gray-500 mt-1">بيحمي الرقم من الإيقاف لو حصل إرسال كتير بالغلط</p>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={draft.makeDefault}
              onChange={e => setDraft(d => ({ ...d, makeDefault: e.target.checked }))}
              className="w-4 h-4 accent-emerald-600" />
            اجعلها القناة الافتراضية للشركة
          </label>

          <div className="flex justify-end gap-2">
            <button onClick={() => setShowAdd(false)}
              className="px-4 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm font-bold hover:bg-gray-50 transition">
              إلغاء
            </button>
            <button onClick={add} disabled={busyId === 'new'}
              className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition disabled:opacity-50">
              {busyId === 'new' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}إضافة
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center text-gray-400">
          <Loader2 className="animate-spin mx-auto mb-2" size={22} />جاري التحميل...
        </div>
      ) : (
        <>
          <section className="space-y-3">
            <h3 className="font-bold text-gray-700 text-sm flex items-center gap-2">
              <Building2 size={16} className="text-teal-500" />قنوات الشركة
              <span className="text-xs text-gray-400 font-normal">({company.length})</span>
            </h3>
            {company.length === 0 ? (
              <p className="text-sm text-gray-400 bg-white border border-gray-100 rounded-xl p-6 text-center">
                لا توجد قنوات بعد — أضف قناة الشركة الرئيسية عشان الرسايل تبدأ تخرج منها
              </p>
            ) : company.map(c => <ChannelRow key={c.id} channel={c} />)}
          </section>

          <section className="space-y-3">
            <h3 className="font-bold text-gray-700 text-sm flex items-center gap-2">
              <User size={16} className="text-teal-500" />واتساب الموظفين
              <span className="text-xs text-gray-400 font-normal">({staff.length})</span>
            </h3>
            {staff.length === 0 ? (
              <p className="text-sm text-gray-400 bg-white border border-gray-100 rounded-xl p-6 text-center">
                محدش من الموظفين ربط رقمه لسه — كل موظف بيربط رقمه بنفسه من صفحة حسابه
              </p>
            ) : staff.map(c => <ChannelRow key={c.id} channel={c} />)}
          </section>
        </>
      )}
    </div>
  );
}
