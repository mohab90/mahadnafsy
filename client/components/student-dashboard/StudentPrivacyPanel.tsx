import React, { useEffect, useState } from 'react';
import { Download, ShieldCheck, Trash2 } from 'lucide-react';
import { mysqlClient } from '../../lib/mysqlapi';

type PrivacyRequest = Awaited<ReturnType<typeof mysqlClient.getMyPrivacyRequests>>[number];

export const StudentPrivacyPanel: React.FC = () => {
  const [requests, setRequests] = useState<PrivacyRequest[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'export' | 'erase' | null>(null);
  const [message, setMessage] = useState('');

  const load = () => mysqlClient.getMyPrivacyRequests().then(setRequests).catch(() => {});
  useEffect(() => { void load(); }, []);

  const download = async () => {
    setBusy('export');
    setMessage('');
    try {
      const blob = await mysqlClient.downloadMyPrivacyExport();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `my-data-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage('تم تجهيز وتنزيل نسخة بياناتك بنجاح.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر تصدير البيانات.');
    } finally { setBusy(null); }
  };

  const requestErasure = async () => {
    if (!window.confirm('طلب المحو يعطّل الحساب نهائيًا بعد المراجعة. هل تريد الاستمرار؟')) return;
    setBusy('erase');
    setMessage('');
    try {
      await mysqlClient.requestPrivacyErasure(reason.trim());
      setReason('');
      await load();
      setMessage('تم تسجيل الطلب وسيتم مراجعته قبل أي حذف أو إخفاء للبيانات.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر تسجيل الطلب.');
    } finally { setBusy(null); }
  };

  const openRequest = requests.find(item => ['pending', 'processing', 'blocked'].includes(item.status));
  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" dir="rtl">
      <div>
        <h3 className="flex items-center gap-2 font-extrabold text-gray-900"><ShieldCheck size={18}/> الخصوصية وبيانات الحساب</h3>
        <p className="mt-1 text-xs text-gray-500">التصدير يشمل بيانات الحساب والدفع والتعلم والدعم. المحو يخضع لمراجعة الالتزامات المالية والحجوزات المفتوحة.</p>
      </div>
      <button onClick={download} disabled={Boolean(busy)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary-200 bg-primary-50 py-3 font-bold text-primary-700 disabled:opacity-50">
        <Download size={16}/> {busy === 'export' ? 'جاري تجهيز البيانات...' : 'تنزيل نسخة من بياناتي'}
      </button>
      <div className="rounded-xl border border-red-100 bg-red-50 p-4">
        <label className="mb-2 block text-xs font-bold text-red-800">سبب طلب محو الحساب (اختياري)</label>
        <textarea value={reason} onChange={event => setReason(event.target.value.slice(0, 1000))}
          disabled={Boolean(openRequest)} rows={2}
          className="w-full rounded-lg border border-red-200 bg-white p-2 text-sm outline-none disabled:opacity-60" />
        <button onClick={requestErasure} disabled={Boolean(busy || openRequest)}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 py-2.5 text-sm font-bold text-white disabled:opacity-50">
          <Trash2 size={15}/> {openRequest ? `طلب قائم: ${openRequest.status}` : busy === 'erase' ? 'جاري التسجيل...' : 'طلب محو بيانات الحساب'}
        </button>
        {openRequest?.legal_hold_reason && <p className="mt-2 text-xs text-amber-700">سبب الإيقاف: {openRequest.legal_hold_reason}</p>}
      </div>
      {message && <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-700">{message}</p>}
    </div>
  );
};
