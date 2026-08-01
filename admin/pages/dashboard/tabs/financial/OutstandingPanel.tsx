import { useState } from 'react';
import { ArrowDownRight, CheckCircle2, Download, TrendingDown, Users } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { BulkStubPanel } from '../FinancialPanels';
import { toDialable } from '../../../../lib/whatsappLink';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type OutstandingSub = {
  id: string; name: string; email: string; phone: string; client_code: string;
  assigned_sales_name: string | null; total_expected: number; total_paid: number; outstanding: number;
};

const exportCSV = (filename: string, rows: string[][], headers: string[]) => {
  const BOM = '﻿';
  const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))];
  const blob = new Blob([BOM + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

export function OutstandingPanel({ notify }: { notify: NotifyFn }) {
  const [outstandingSubs, setOutstandingSubs] = useState<OutstandingSub[] | null>(null);
  const [outstandingLoading, setOutstandingLoading] = useState(false);
  const [outstandingTotal, setOutstandingTotal] = useState(0);
  const [outstandingSelected, setOutstandingSelected] = useState<Set<string>>(new Set());
  const [outstandingReminderMsg, setOutstandingReminderMsg] = useState('أهلاً {name} 💚\nنود تذكيرك بأن لديك رصيداً مستحقاً بمبلغ {amount} ج.م.\nيرجى التواصل معنا لتسوية الرصيد. شكراً 🌿');
  const [outstandingSending, setOutstandingSending] = useState(false);

  const loadOutstanding = async () => {
    setOutstandingLoading(true);
    try {
      const data = await mysqlAdmin.adminGet<{ subscribers: OutstandingSub[]; total_outstanding: number }>(
        '/admin/payments/outstanding'
      );
      const d = data as { subscribers: OutstandingSub[]; total_outstanding: number };
      setOutstandingSubs(d.subscribers || []);
      setOutstandingTotal(d.total_outstanding || 0);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحميل الأرصدة المستحقة');
    } finally { setOutstandingLoading(false); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-bold text-gray-800 text-lg flex items-center gap-2">
            <TrendingDown size={18} className="text-red-500" /> الأرصدة المستحقة
          </h3>
          {outstandingTotal > 0 && (
            <p className="text-sm text-gray-500 mt-1">
              إجمالي المستحق: <span className="font-extrabold text-red-600">{Math.round(outstandingTotal).toLocaleString('ar-EG')} ج.م</span>
            </p>
          )}
        </div>
        <button onClick={loadOutstanding} disabled={outstandingLoading}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold bg-gray-100 text-gray-600 hover:bg-gray-200 transition disabled:opacity-60">
          {outstandingLoading
            ? <span className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
            : <ArrowDownRight size={15} />}
          تحديث
        </button>
      </div>

      {outstandingLoading && outstandingSubs === null ? (
        <div className="text-center py-16 text-sm text-gray-400">جارٍ التحميل...</div>
      ) : !outstandingSubs || outstandingSubs.length === 0 ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-10 text-center">
          <CheckCircle2 size={32} className="text-emerald-500 mx-auto mb-3" />
          <p className="font-bold text-emerald-800 text-lg">لا توجد أرصدة مستحقة 🎉</p>
          <p className="text-sm text-emerald-600 mt-1">جميع المشتركين سددوا مبالغهم</p>
        </div>
      ) : (
        <>
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <input type="checkbox"
                checked={outstandingSelected.size === outstandingSubs.length && outstandingSubs.length > 0}
                onChange={e => setOutstandingSelected(e.target.checked
                  ? new Set(outstandingSubs.map(s => s.id))
                  : new Set()
                )}
                className="w-4 h-4 accent-orange-600"
              />
              <span className="text-sm font-bold text-orange-800">تحديد الكل ({outstandingSubs.length})</span>
              {outstandingSelected.size > 0 && (
                <span className="text-xs text-orange-600 font-bold mr-auto">محدد: {outstandingSelected.size}</span>
              )}
            </div>
            <textarea
              value={outstandingReminderMsg}
              onChange={e => setOutstandingReminderMsg(e.target.value)}
              rows={3}
              className="w-full text-sm border border-orange-200 rounded-lg p-2 resize-none bg-white"
              placeholder="نص التذكير — {name} للاسم، {amount} للمبلغ"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <button
                disabled={outstandingSending || outstandingSelected.size === 0}
                onClick={async () => {
                  if (!outstandingReminderMsg.trim() || outstandingSelected.size === 0) return;
                  setOutstandingSending(true);
                  try {
                    const ids = [...outstandingSelected];
                    const res = await mysqlAdmin.adminPost<{ sent: number; failed: number }>(
                      '/admin/payments/send-reminder',
                      { subscriberIds: ids, message: outstandingReminderMsg }
                    );
                    const r = res as { sent: number; failed: number };
                    notify('success', `تم الإرسال: ${r.sent} رسالة ✅ (فشل: ${r.failed})`);
                    setOutstandingSelected(new Set());
                  } catch (e: unknown) {
                    notify('error', (e as Error).message || 'فشل الإرسال');
                  } finally { setOutstandingSending(false); }
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-60">
                {outstandingSending
                  ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  : <Users size={15} />}
                إرسال تذكير واتساب ({outstandingSelected.size})
              </button>
              <button
                onClick={() => exportCSV(
                  'outstanding-balances.csv',
                  outstandingSubs.map(s => [
                    s.name, s.phone, s.email, s.client_code || '',
                    String(Math.round(s.total_expected)), String(Math.round(s.total_paid)), String(Math.round(s.outstanding)),
                    s.assigned_sales_name || '',
                  ]),
                  ['الاسم', 'الهاتف', 'البريد', 'كود', 'المتوقع', 'المدفوع', 'المستحق', 'المندوب']
                )}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
                <Download size={14} /> تصدير CSV
              </button>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl overflow-x-auto shadow-sm">
            <table className="w-full text-sm" dir="rtl">
              <thead>
                <tr className="text-right border-b-2 border-gray-100 text-xs text-gray-500 bg-gray-50">
                  <th className="py-3 px-3 font-bold w-8"></th>
                  <th className="py-3 px-3 font-bold">المشترك</th>
                  <th className="py-3 px-3 font-bold">المتوقع</th>
                  <th className="py-3 px-3 font-bold">المدفوع</th>
                  <th className="py-3 px-3 font-bold text-red-600">المستحق</th>
                  <th className="py-3 px-3 font-bold">المندوب</th>
                  <th className="py-3 px-3 font-bold">تواصل</th>
                </tr>
              </thead>
              <tbody>
                {outstandingSubs.map(sub => (
                  <tr key={sub.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="py-3 px-3">
                      <input type="checkbox"
                        checked={outstandingSelected.has(sub.id)}
                        onChange={e => setOutstandingSelected(prev => {
                          const next = new Set(prev);
                          e.target.checked ? next.add(sub.id) : next.delete(sub.id);
                          return next;
                        })}
                        className="w-4 h-4 accent-orange-600"
                      />
                    </td>
                    <td className="py-3 px-3">
                      <p className="font-bold text-gray-900">{sub.name}</p>
                      <p className="text-xs text-gray-500">{sub.phone}</p>
                    </td>
                    <td className="py-3 px-3 text-gray-700">{Math.round(sub.total_expected).toLocaleString('ar-EG')} ج.م</td>
                    <td className="py-3 px-3 text-emerald-600 font-bold">{Math.round(sub.total_paid).toLocaleString('ar-EG')} ج.م</td>
                    <td className="py-3 px-3">
                      <span className="font-extrabold text-red-600">{Math.round(sub.outstanding).toLocaleString('ar-EG')} ج.م</span>
                    </td>
                    <td className="py-3 px-3 text-xs text-gray-500">{sub.assigned_sales_name || '—'}</td>
                    <td className="py-3 px-3">
                      {sub.phone && (
                        <a href={`https://wa.me/${toDialable(sub.phone)}`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-xs bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 rounded-lg px-2 py-1 transition font-bold">
                          واتساب
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <BulkStubPanel notify={notify} />
    </div>
  );
}
