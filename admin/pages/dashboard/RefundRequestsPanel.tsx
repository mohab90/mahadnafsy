import React from 'react';
import { RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { mysqlAdmin } from '../../lib/mysqlapi';
import type { Bundle, Course, SubscriberItem } from '../../types';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface RefundRequestsPanelProps {
  subscribers: SubscriberItem[];
  salesOwnSubscribers: SubscriberItem[];
  setSalesOwnSubscribers: React.Dispatch<React.SetStateAction<SubscriberItem[]>>;
  courses: Course[];
  bundles: Bundle[];
  updateSubscriber: (subscriber: SubscriberItem) => void;
  notify: NotifyFn;
  refundActionSaving: string | null;
  setRefundActionSaving: React.Dispatch<React.SetStateAction<string | null>>;
}

const refundMethodLabels: Record<string, string> = {
  bank: 'تحويل بنكي',
  vodafone: 'فودافون كاش',
  instapay: 'إنستاباي',
  cash: 'كاش',
  other: 'أخرى',
};

const fmtDate = (date?: string) => date ? date.slice(0, 10) : '—';

const refundAnswer = (row: SubscriberItem, key: string) =>
  row.transferAnswers?.[key] as string | undefined;

function refundMethodLabel(row: SubscriberItem) {
  const method = refundAnswer(row, 'refundMethod');
  if (!method) return <span className="text-gray-300">—</span>;
  return refundMethodLabels[method] || method;
}

function refundAmountLabel(row: SubscriberItem) {
  const amount = refundAnswer(row, 'refundAmount');
  return amount ? `${Number(amount).toLocaleString()} ج.م` : '—';
}

export function RefundRequestsPanel({
  subscribers,
  salesOwnSubscribers,
  setSalesOwnSubscribers,
  courses,
  bundles,
  updateSubscriber,
  notify,
  refundActionSaving,
  setRefundActionSaving,
}: RefundRequestsPanelProps) {
  const navigate = useNavigate();
  const seenIds = new Set<string>();
  const allSubs = [...subscribers, ...salesOwnSubscribers].filter((subscriber) => {
    if (seenIds.has(subscriber.id)) return false;
    seenIds.add(subscriber.id);
    return true;
  });
  const pendingRefunds = allSubs.filter((subscriber) => subscriber.clientStatus === 'refund_pending');
  const refunded = allSubs.filter((subscriber) => subscriber.clientStatus === 'refunded');

  const approveRefund = async (row: SubscriberItem) => {
    setRefundActionSaving(row.id);
    try {
      const updated = { ...row, clientStatus: 'refunded' as const };
      updateSubscriber(updated);
      setSalesOwnSubscribers((prev) => prev.map((subscriber) => subscriber.id === row.id ? updated : subscriber));
      await mysqlAdmin.saveSubscriber(updated as unknown as Record<string, unknown>);
      notify('success', `تمت الموافقة على استرداد ${row.name}`);
    } catch (err) {
      notify('error', 'فشل: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setRefundActionSaving(null);
    }
  };

  const rejectRefund = async (row: SubscriberItem) => {
    setRefundActionSaving(row.id + '_rej');
    try {
      const updated = { ...row, clientStatus: 'active' as const, transferAnswers: undefined, transferDate: undefined };
      updateSubscriber(updated);
      setSalesOwnSubscribers((prev) => prev.map((subscriber) => subscriber.id === row.id ? updated : subscriber));
      await mysqlAdmin.saveSubscriber(updated as unknown as Record<string, unknown>);
      notify('success', `تم رفض الاسترداد وإعادة ${row.name} للنشطين`);
    } catch (err) {
      notify('error', 'فشل: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setRefundActionSaving(null);
    }
  };

  const courseLabelsFor = (row: SubscriberItem) =>
    (row.enrolledCourseIds || []).map((courseId) => {
      if (courseId.startsWith('bundle:')) {
        return bundles.find((bundle) => bundle.id === courseId.replace('bundle:', ''))?.title || courseId;
      }
      return courses.find((course) => course.id === courseId)?.title || courseId;
    });

  return (
    <article className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 mt-2 space-y-5" dir="rtl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-extrabold text-gray-900 flex items-center gap-2">
          <RotateCcw size={20} className="text-red-500" /> طلبات الاسترداد
        </h2>
        <div className="flex items-center gap-2 text-sm">
          {pendingRefunds.length > 0 && <span className="bg-orange-100 text-orange-700 font-bold px-3 py-1 rounded-full">{pendingRefunds.length} معلق</span>}
          <span className="bg-red-100 text-red-700 font-bold px-3 py-1 rounded-full">{refunded.length} مكتمل</span>
        </div>
      </div>

      {pendingRefunds.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-orange-700 flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-orange-500 inline-block" /> طلبات تنتظر الموافقة ({pendingRefunds.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" dir="rtl">
              <thead className="bg-orange-50 text-gray-700">
                <tr>
                  <th className="text-right px-3 py-2.5 border border-gray-200 font-semibold">العميل</th>
                  <th className="text-right px-3 py-2.5 border border-gray-200 font-semibold">سبب الاسترداد</th>
                  <th className="text-center px-3 py-2.5 border border-gray-200 font-semibold">المبلغ</th>
                  <th className="text-center px-3 py-2.5 border border-gray-200 font-semibold">الطريقة</th>
                  <th className="text-center px-3 py-2.5 border border-gray-200 font-semibold">تاريخ الطلب</th>
                  <th className="text-center px-3 py-2.5 border border-gray-200 font-semibold">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {pendingRefunds.map((row) => (
                  <tr key={row.id} className="hover:bg-orange-50/40">
                    <td className="px-3 py-2 border border-gray-200">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center font-bold text-xs flex-shrink-0">{row.name.charAt(0)}</div>
                        <div>
                          <button onClick={() => navigate(`/client/${row.clientCode || row.id}`)} className="font-bold text-gray-800 hover:text-primary-700 text-sm block">{row.name}</button>
                          <a href={`tel:${row.phone}`} className="text-xs text-blue-600">{row.phone}</a>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 border border-gray-200 text-sm text-red-700 max-w-[200px]">
                      {refundAnswer(row, 'refundReason') || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 border border-gray-200 text-center text-sm font-bold text-red-700">{refundAmountLabel(row)}</td>
                    <td className="px-3 py-2 border border-gray-200 text-center text-xs text-gray-600">{refundMethodLabel(row)}</td>
                    <td className="px-3 py-2 border border-gray-200 text-center text-xs text-gray-500">{fmtDate(row.transferDate)}</td>
                    <td className="px-3 py-2 border border-gray-200">
                      <div className="flex items-center justify-center gap-2">
                        <button disabled={refundActionSaving === row.id || refundActionSaving === row.id + '_rej'} onClick={() => approveRefund(row)} className="px-2.5 py-1 rounded-lg bg-green-600 text-white text-xs font-bold hover:bg-green-700 disabled:opacity-50">{refundActionSaving === row.id ? '...' : 'موافقة'}</button>
                        <button disabled={refundActionSaving === row.id || refundActionSaving === row.id + '_rej'} onClick={() => rejectRefund(row)} className="px-2.5 py-1 rounded-lg bg-gray-200 text-gray-700 text-xs font-bold hover:bg-gray-300 disabled:opacity-50">{refundActionSaving === row.id + '_rej' ? '...' : 'رفض'}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {refunded.length === 0 && pendingRefunds.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <RotateCcw size={40} className="mx-auto mb-3 opacity-30" />
          <p>لا توجد طلبات استرداد حتى الآن</p>
        </div>
      ) : refunded.length > 0 ? (
        <div>
          {pendingRefunds.length > 0 && <h3 className="text-sm font-bold text-red-700 flex items-center gap-2 mb-3"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> تم الاسترداد ({refunded.length})</h3>}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" dir="rtl">
              <thead className="bg-red-50 text-gray-700">
                <tr>
                  <th className="text-right px-3 py-2.5 border border-gray-200 font-semibold">العميل</th>
                  <th className="text-right px-3 py-2.5 border border-gray-200 font-semibold">البريد الإلكتروني</th>
                  <th className="text-center px-3 py-2.5 border border-gray-200 font-semibold">تاريخ التحويل</th>
                  <th className="text-right px-3 py-2.5 border border-gray-200 font-semibold">سبب الاسترداد</th>
                  <th className="text-center px-3 py-2.5 border border-gray-200 font-semibold">المبلغ المطلوب</th>
                  <th className="text-center px-3 py-2.5 border border-gray-200 font-semibold">طريقة التحويل</th>
                  <th className="text-right px-3 py-2.5 border border-gray-200 font-semibold">الكورسات</th>
                  <th className="text-center px-3 py-2.5 border border-gray-200 font-semibold">إجمالي المدفوع</th>
                  <th className="text-center px-3 py-2.5 border border-gray-200 font-semibold">المسئول</th>
                  <th className="text-center px-3 py-2.5 border border-gray-200 font-semibold">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {refunded.map((row) => {
                  const clientCode = row.clientCode || row.id;
                  const totalPaid = (row.paymentHistory || []).reduce((sum, payment) => {
                    const amount = Number(payment.amount) || 0;
                    const egp = payment.currency === 'SAR' ? amount * 13 : payment.currency === 'USD' ? amount * 50 : amount;
                    return sum + egp;
                  }, 0);
                  const refundReason = refundAnswer(row, 'refundReason') || '';
                  const courseLabels = courseLabelsFor(row).slice(0, 2);
                  const extraCourseCount = Math.max(0, (row.enrolledCourseIds || []).length - 2);
                  return (
                    <tr key={row.id} className="hover:bg-red-50/40">
                      <td className="px-3 py-2 border border-gray-200">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-red-100 text-red-700 flex items-center justify-center font-bold text-xs flex-shrink-0">{row.name.charAt(0)}</div>
                          <div>
                            <button onClick={() => navigate(`/client/${clientCode}`)} className="font-bold text-gray-800 hover:text-primary-700 text-sm block">{row.name}</button>
                            <a href={`tel:${row.phone}`} className="text-xs text-blue-600">{row.phone}</a>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 border border-gray-200 text-xs text-gray-500">{row.email || '—'}</td>
                      <td className="px-3 py-2 border border-gray-200 text-center text-xs text-gray-500 whitespace-nowrap">{fmtDate(row.transferDate)}</td>
                      <td className="px-3 py-2 border border-gray-200 text-sm text-gray-700 max-w-[200px]">
                        {refundReason ? <span className="text-red-700">{refundReason}</span> : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 border border-gray-200 text-center text-sm font-bold text-red-700">{refundAmountLabel(row)}</td>
                      <td className="px-3 py-2 border border-gray-200 text-center text-xs text-gray-600">{refundMethodLabel(row)}</td>
                      <td className="px-3 py-2 border border-gray-200 text-xs text-gray-700">
                        {courseLabels.length > 0 ? (
                          <div className="flex flex-col gap-0.5">
                            {courseLabels.map((label, index) => <span key={`${label}-${index}`} className="truncate max-w-[160px] block">{label}</span>)}
                            {extraCourseCount > 0 && <span className="text-gray-400">+{extraCourseCount} أخرى</span>}
                          </div>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 border border-gray-200 text-center text-sm font-bold text-gray-700">
                        {totalPaid > 0 ? `${totalPaid.toLocaleString()} ج.م` : '—'}
                      </td>
                      <td className="px-3 py-2 border border-gray-200 text-center text-xs text-gray-600">
                        {row.assignedSalesName || row.assignedCsName || '—'}
                      </td>
                      <td className="px-3 py-2 border border-gray-200 text-center">
                        <button onClick={() => navigate(`/client/${clientCode}`)} className="px-2 py-1 rounded-lg bg-primary-50 text-primary-700 text-xs font-bold hover:bg-primary-100">
                          عرض
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </article>
  );
}
