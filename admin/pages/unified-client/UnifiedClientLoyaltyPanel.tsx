import { useCallback, useEffect, useState } from 'react';
import { Award, Gift, Loader2, Minus, Plus, RefreshCw } from 'lucide-react';
import { mysqlAdmin } from '../../lib/mysqlapi';

type LedgerRow = {
  id?: string;
  points?: number;
  balance_after?: number;
  reason?: string;
  reference_type?: string;
  reference_id?: string;
  created_at?: string;
};

type Props = {
  subscriberId: string;
};

export function UnifiedClientLoyaltyPanel({ subscriberId }: Props) {
  const [balance, setBalance] = useState(0);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [points, setPoints] = useState('10');
  const [reason, setReason] = useState('manual_adjustment');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'award' | 'redeem' | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mysqlAdmin.getSubscriberLoyalty(subscriberId);
      setBalance(Number(data.balance || 0));
      setLedger((data.ledger || []) as LedgerRow[]);
    } finally {
      setLoading(false);
    }
  }, [subscriberId]);

  useEffect(() => { load().catch(() => setLoading(false)); }, [load]);

  const submit = async (mode: 'award' | 'redeem') => {
    const n = Math.max(1, Math.floor(Number(points) || 0));
    setSaving(mode);
    setMessage('');
    try {
      const result = mode === 'award'
        ? await mysqlAdmin.awardSubscriberLoyalty(subscriberId, n, reason)
        : await mysqlAdmin.redeemSubscriberLoyalty(subscriberId, n, reason);
      setBalance(Number(result.balance || 0));
      setMessage(mode === 'award' ? 'تمت إضافة النقاط' : 'تم خصم النقاط');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر حفظ العملية');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div id="section-loyalty" className="space-y-4" dir="rtl">
      <div className="rounded-2xl border border-amber-100 bg-gradient-to-l from-amber-50 to-white p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold text-amber-700">نظام الولاء</p>
            <h3 className="mt-1 text-2xl font-extrabold text-gray-900">{balance.toLocaleString('ar-EG-u-nu-latn')} نقطة</h3>
          </div>
          <div className="h-12 w-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center">
            <Award size={24} />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[120px_1fr_auto_auto]">
          <input
            type="number"
            min={1}
            value={points}
            onChange={e => setPoints(e.target.value)}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
            placeholder="النقاط"
          />
          <input
            value={reason}
            onChange={e => setReason(e.target.value)}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
            placeholder="سبب العملية"
          />
          <button
            onClick={() => submit('award')}
            disabled={!!saving}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {saving === 'award' ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            إضافة
          </button>
          <button
            onClick={() => submit('redeem')}
            disabled={!!saving}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {saving === 'redeem' ? <Loader2 size={15} className="animate-spin" /> : <Minus size={15} />}
            خصم
          </button>
        </div>
        {message && <p className="mt-3 text-xs font-bold text-gray-500">{message}</p>}
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 p-4">
          <h4 className="text-sm font-extrabold text-gray-800 flex items-center gap-2"><Gift size={16} /> سجل النقاط</h4>
          <button onClick={load} className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          </button>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-400"><Loader2 className="mx-auto animate-spin" /></div>
        ) : ledger.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">لا توجد عمليات نقاط بعد</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {ledger.map(row => (
              <div key={row.id} className="grid grid-cols-[90px_1fr_110px] gap-3 p-4 text-sm">
                <span className={`font-extrabold ${Number(row.points) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {Number(row.points) > 0 ? '+' : ''}{Number(row.points || 0).toLocaleString('ar-EG-u-nu-latn')}
                </span>
                <div>
                  <p className="font-bold text-gray-700">{row.reason || 'عملية نقاط'}</p>
                  <p className="text-xs text-gray-400">{row.reference_type || ''} {row.reference_id || ''}</p>
                </div>
                <div className="text-left">
                  <p className="font-bold text-gray-600">{Number(row.balance_after || 0).toLocaleString('ar-EG-u-nu-latn')}</p>
                  <p className="text-xs text-gray-400">{row.created_at ? new Date(row.created_at).toLocaleDateString('ar-EG-u-nu-latn') : ''}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
