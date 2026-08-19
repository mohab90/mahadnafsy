import { useCallback, useEffect, useState } from 'react';
import { MessageCircle, CheckCircle2, AlertTriangle, Loader2, Send, Unlink, Save } from 'lucide-react';
import { mysqlAdmin, type MessagingChannel } from '../../../../lib/mysqlapi';
import { toDialable } from '../../../../lib/whatsappLink';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

/**
 * "Connect my own WhatsApp."
 *
 * A rep messaging a lead from the company switchboard gets a different reply
 * rate than one messaging from their own number, which is the whole point of
 * this screen.
 *
 * Credentials are write-only by design: they go up, and the API answers with
 * hasCredentials rather than the values. So the fields are always blank on load
 * and an empty submit means "leave what is stored alone" — never "clear it".
 */
export function MyWhatsappChannelPanel({ notify }: { notify: NotifyFn }) {
  const [channel, setChannel] = useState<MessagingChannel | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [provider, setProvider] = useState<'green-api' | 'meta' | 'wapilot'>('green-api');
  const [displayNumber, setDisplayNumber] = useState('');
  const [instanceId, setInstanceId] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [metaPhoneId, setMetaPhoneId] = useState('');
  const [metaToken, setMetaToken] = useState('');
  const [wapilotKey, setWapilotKey] = useState('');
  const [wapilotInstance, setWapilotInstance] = useState('');
  const [testTo, setTestTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const mine = await mysqlAdmin.getMyWhatsappChannel();
      setChannel(mine);
      if (mine) {
        setProvider(mine.provider === 'meta' ? 'meta' : mine.provider === 'wapilot' ? 'wapilot' : 'green-api');
        setDisplayNumber(mine.display_number || '');
      }
    } catch { notify('error', 'تعذر تحميل بيانات القناة'); }
    finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const credentialsFromForm = (): Record<string, string> => {
    if (provider === 'meta') return { metaPhoneId: metaPhoneId.trim(), metaToken: metaToken.trim() };
    if (provider === 'wapilot') return { apiKey: wapilotKey.trim(), instance: wapilotInstance.trim() };
    return { instanceId: instanceId.trim(), apiToken: apiToken.trim() };
  };

  const save = async () => {
    const credentials = credentialsFromForm();
    const filled = Object.values(credentials).filter(Boolean).length;
    if (filled === 0) { notify('error', 'أدخل بيانات الاتصال من مزوّد الخدمة'); return; }
    if (filled < 2) { notify('error', 'أكمل الحقلين معاً — بيانات ناقصة لن تعمل'); return; }
    setSaving(true);
    try {
      const saved = await mysqlAdmin.saveMyWhatsappChannel({
        provider, displayNumber: displayNumber.trim() || undefined, credentials,
      });
      setChannel(saved);
      // Cleared on purpose: nothing that can send as this person stays in the DOM.
      setInstanceId(''); setApiToken(''); setMetaPhoneId(''); setMetaToken('');
      setWapilotKey(''); setWapilotInstance('');
      notify('success', 'تم الحفظ — ابعت رسالة اختبار عشان نتأكد إنها شغالة');
    } catch { notify('error', 'فشل الحفظ'); }
    finally { setSaving(false); }
  };

  const test = async () => {
    if (!channel) return;
    const to = toDialable(testTo || displayNumber);
    if (!to) { notify('error', 'أدخل رقماً صالحاً للاختبار'); return; }
    setTesting(true);
    try {
      await mysqlAdmin.testMessagingChannel(channel.id, to);
      notify('success', 'وصلت! القناة متصلة وشغالة');
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'لم يتم الإرسال — راجع بيانات الاتصال');
      await load();
    } finally { setTesting(false); }
  };

  const disconnect = async () => {
    if (!channel) return;
    setSaving(true);
    try {
      await mysqlAdmin.deleteMyWhatsappChannel();
      setChannel(null);
      notify('info', 'تم فصل القناة — رسايلك هتخرج من رقم الشركة');
    } catch { notify('error', 'تعذر فصل القناة'); }
    finally { setSaving(false); }
  };

  const usedToday = channel ? channel.sent_today : 0;
  const limit = channel?.daily_send_limit || 0;
  const usedPct = limit ? Math.min(100, Math.round((usedToday / limit) * 100)) : 0;

  return (
    <div className="space-y-5" dir="rtl">
      <div className="bg-gradient-to-l from-emerald-600 to-green-600 rounded-2xl p-5 text-white">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <MessageCircle size={22} />واتساب الخاص بي
        </h2>
        <p className="text-emerald-50 text-sm mt-1">
          اربط رقمك عشان رسايلك للعملاء تخرج باسمك بدل رقم الشركة
        </p>
      </div>

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center text-gray-400">
          <Loader2 className="animate-spin mx-auto mb-2" size={22} />جاري التحميل...
        </div>
      ) : (
        <>
          {/* Status */}
          <div className={`rounded-2xl border p-4 flex items-start gap-3 ${
            channel?.isConnected ? 'bg-emerald-50 border-emerald-200'
              : channel?.status === 'error' ? 'bg-red-50 border-red-200'
                : channel ? 'bg-amber-50 border-amber-200'
                  : 'bg-gray-50 border-gray-200'}`}>
            {channel?.isConnected
              ? <CheckCircle2 size={20} className="text-emerald-600 shrink-0 mt-0.5" />
              : <AlertTriangle size={20} className={`shrink-0 mt-0.5 ${channel?.status === 'error' ? 'text-red-600' : 'text-amber-600'}`} />}
            <div className="min-w-0 flex-1">
              <p className="font-bold text-gray-800 text-sm">
                {channel?.isConnected ? 'متصل وشغال'
                  : channel?.status === 'error' ? 'في مشكلة في الاتصال'
                    : channel ? 'محفوظ — لسه محتاج اختبار'
                      : 'مش مربوط — رسايلك بتخرج من رقم الشركة'}
              </p>
              {channel?.display_number && (
                <p className="text-xs text-gray-500 font-mono mt-0.5">+{channel.display_number}</p>
              )}
              {channel?.last_error && (
                <p className="text-xs text-red-700 mt-1">{channel.last_error}</p>
              )}
              {channel && limit > 0 && (
                <div className="mt-2">
                  <div className="flex justify-between text-[11px] text-gray-500 mb-1">
                    <span>الحد اليومي</span>
                    <span className="font-mono">{usedToday} / {limit}</span>
                  </div>
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${usedPct > 85 ? 'bg-red-500' : usedPct > 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                      style={{ width: `${usedPct}%` }}
                    />
                  </div>
                  {usedPct > 85 && (
                    <p className="text-[11px] text-red-600 mt-1">
                      قربت على الحد — الإرسال الزيادة هيتوقف لحد بكرة عشان الرقم ميتقفلش
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Credentials */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
            <h3 className="font-bold text-gray-800 text-sm">بيانات الاتصال</h3>
            <p className="text-xs text-gray-500 -mt-2">
              هتلاقيها في لوحة مزوّد الخدمة. بتتخزن مشفّرة، ومحدش — ولا حتى الأدمن — يقدر يقراها بعد الحفظ.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">المزوّد</label>
                <select
                  value={provider}
                  onChange={e => setProvider(e.target.value as 'green-api' | 'meta')}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-300"
                >
                  <option value="green-api">Green-API (رقمك الشخصي)</option>
                  <option value="wapilot">Wapilot (رقمك الشخصي)</option>
                  <option value="meta">WhatsApp Cloud API (رقم أعمال)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">رقم الواتساب</label>
                <input
                  value={displayNumber}
                  onChange={e => setDisplayNumber(e.target.value)}
                  placeholder="01012345678"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-300"
                />
                {displayNumber && !toDialable(displayNumber) && (
                  <p className="text-xs text-red-600 mt-1">الرقم ده مش هينفع يستقبل رسايل</p>
                )}
              </div>

              {provider === 'wapilot' ? (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">API Key</label>
                    <input
                      type="password" value={wapilotKey} onChange={e => setWapilotKey(e.target.value)}
                      placeholder={channel?.hasCredentials ? '•••••• (محفوظ)' : ''}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">اسم النسخة (Instance)</label>
                    <input
                      value={wapilotInstance} onChange={e => setWapilotInstance(e.target.value)}
                      placeholder="instance5000"
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    />
                  </div>
                </>
              ) : provider === 'green-api' ? (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Instance ID</label>
                    <input
                      value={instanceId} onChange={e => setInstanceId(e.target.value)}
                      placeholder={channel?.hasCredentials ? '•••••• (محفوظ)' : ''}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">API Token</label>
                    <input
                      type="password" value={apiToken} onChange={e => setApiToken(e.target.value)}
                      placeholder={channel?.hasCredentials ? '•••••• (محفوظ)' : ''}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Phone Number ID</label>
                    <input
                      value={metaPhoneId} onChange={e => setMetaPhoneId(e.target.value)}
                      placeholder={channel?.hasCredentials ? '•••••• (محفوظ)' : ''}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Access Token</label>
                    <input
                      type="password" value={metaToken} onChange={e => setMetaToken(e.target.value)}
                      placeholder={channel?.hasCredentials ? '•••••• (محفوظ)' : ''}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-wrap gap-2 justify-end pt-1">
              {channel && (
                <button
                  onClick={disconnect} disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm font-bold hover:bg-gray-50 transition disabled:opacity-50"
                >
                  <Unlink size={14} />فصل الربط
                </button>
              )}
              <button
                onClick={save} disabled={saving}
                className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {channel ? 'تحديث البيانات' : 'ربط الواتساب'}
              </button>
            </div>
          </div>

          {/* Test — the only honest proof the credentials work */}
          {channel && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
              <h3 className="font-bold text-gray-800 text-sm">اختبار الإرسال</h3>
              <p className="text-xs text-gray-500 -mt-1">
                ابعت لنفسك رسالة. دي الطريقة الوحيدة اللي تتأكد بيها إن الربط شغال فعلاً.
              </p>
              <div className="flex flex-wrap gap-2">
                <input
                  value={testTo} onChange={e => setTestTo(e.target.value)}
                  placeholder={displayNumber || '01012345678'}
                  className="flex-1 min-w-[12rem] border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-300"
                />
                <button
                  onClick={test} disabled={testing}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 transition disabled:opacity-50"
                >
                  {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  إرسال اختبار
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
