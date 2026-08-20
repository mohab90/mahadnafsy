import { Award, Bell, CheckCircle, Gift, Loader2, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { mysqlClient } from '../../lib/mysqlapi';

type LedgerRow = {
  id?: string;
  points?: number;
  balance_after?: number;
  reason?: string;
  created_at?: string;
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
}

export function StudentLoyaltyTab() {
  const [balance, setBalance] = useState(0);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushMessage, setPushMessage] = useState('');
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    mysqlClient.getMyLoyalty()
      .then(data => {
        setBalance(Number(data.balance || 0));
        setLedger((data.ledger || []) as LedgerRow[]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    mysqlClient.getPushPublicKey()
      .then(data => setPushEnabled(!!data.enabled))
      .catch(() => setPushEnabled(false));
  }, []);

  const enablePush = async () => {
    setPushBusy(true);
    setPushMessage('');
    try {
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('المتصفح لا يدعم إشعارات Push');
      }
      const key = await mysqlClient.getPushPublicKey();
      if (!key.enabled || !key.publicKey) throw new Error('الإشعارات غير مفعلة من إعدادات النظام');

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('لم يتم منح إذن الإشعارات');

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key.publicKey),
      });
      await mysqlClient.subscribePush(subscription.toJSON());
      setPushMessage('تم تفعيل إشعارات المتصفح بنجاح');
    } catch (error) {
      setPushMessage(error instanceof Error ? error.message : 'تعذر تفعيل الإشعارات');
    } finally {
      setPushBusy(false);
    }
  };

  const sendTest = async () => {
    setPushBusy(true);
    setPushMessage('');
    try {
      await mysqlClient.sendTestPush();
      setPushMessage('تم إرسال إشعار تجريبي');
    } catch (error) {
      setPushMessage(error instanceof Error ? error.message : 'تعذر إرسال الإشعار التجريبي');
    } finally {
      setPushBusy(false);
    }
  };

  if (loading) {
    return <div className="rounded-2xl bg-white p-10 text-center text-gray-400"><Loader2 className="mx-auto animate-spin" /></div>;
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 p-6 text-white shadow">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-white/75">رصيد نقاط الولاء</p>
            <p className="mt-2 text-4xl font-extrabold">{balance.toLocaleString('ar-EG-u-nu-latn')}</p>
            <p className="mt-1 text-xs text-white/70">تُضاف النقاط تلقائيا مع المدفوعات المؤكدة.</p>
          </div>
          <Award size={44} className="text-white/80" />
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-xl bg-blue-50 p-2 text-blue-700"><Bell size={18} /></div>
          <div>
            <h3 className="text-sm font-extrabold text-gray-800">إشعارات المتصفح</h3>
            <p className="text-xs text-gray-400">استقبل تنبيهات المواعيد والدفع من حسابك.</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            onClick={enablePush}
            disabled={pushBusy || !pushEnabled}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {pushBusy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
            تفعيل الإشعارات
          </button>
          <button
            onClick={sendTest}
            disabled={pushBusy || !pushEnabled}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 disabled:opacity-50"
          >
            <Send size={15} />
            إرسال تجربة
          </button>
        </div>
        {!pushEnabled && <p className="mt-3 text-xs text-amber-600">الإشعارات تحتاج ضبط مفاتيح VAPID في السيرفر.</p>}
        {pushMessage && <p className="mt-3 text-xs font-bold text-gray-500">{pushMessage}</p>}
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-gray-100 p-4">
          <h3 className="flex items-center gap-2 text-sm font-extrabold text-gray-800"><Gift size={16} /> سجل النقاط</h3>
        </div>
        {ledger.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">لا توجد عمليات نقاط بعد</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {ledger.map(row => (
              <div key={row.id} className="grid grid-cols-[80px_1fr_90px] gap-3 p-4 text-sm">
                <span className={`font-extrabold ${Number(row.points) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {Number(row.points) > 0 ? '+' : ''}{Number(row.points || 0).toLocaleString('ar-EG-u-nu-latn')}
                </span>
                <p className="font-bold text-gray-700">{row.reason || 'عملية نقاط'}</p>
                <p className="text-left text-xs text-gray-400">{row.created_at ? new Date(row.created_at).toLocaleDateString('ar-EG-u-nu-latn') : ''}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
