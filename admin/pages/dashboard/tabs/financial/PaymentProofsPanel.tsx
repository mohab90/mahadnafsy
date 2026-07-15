import React from 'react';
import { CheckCircle, Eye, Receipt, RefreshCw, XCircle } from 'lucide-react';
import type { PaymentProof } from '../../../../types';

type ProofFilter = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';

interface PaymentProofsPanelProps {
  allProofs: PaymentProof[] | null;
  proofsLoading: boolean;
  proofFilter: ProofFilter;
  setProofFilter: React.Dispatch<React.SetStateAction<ProofFilter>>;
  pendingProofsCount: number;
  loadAllProofs: () => void;
  proofImages: Record<string, string>;
  loadProofImg: (id: string) => void;
  reviewingProofId: string | null;
  setReviewingProofId: React.Dispatch<React.SetStateAction<string | null>>;
  proofsReviewerNote: string;
  setProofsReviewerNote: React.Dispatch<React.SetStateAction<string>>;
  proofsReviewLoading: boolean;
  handleProofReview: (proofId: string, action: 'approve' | 'reject') => Promise<void>;
}

const FILTER_LABELS: Record<ProofFilter, string> = {
  PENDING: 'قيد المراجعة',
  APPROVED: 'معتمدة',
  REJECTED: 'مرفوضة',
  ALL: 'الكل',
};

const STATUS_CLASS: Record<string, string> = {
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
  PENDING: 'bg-amber-100 text-amber-700',
};

function currencyLabel(currency?: string) {
  if (currency === 'EGP') return 'ج.م';
  if (currency === 'SAR') return 'ر.س';
  if (currency === 'USD') return '$';
  return currency || '';
}

export function PaymentProofsPanel({
  allProofs,
  proofsLoading,
  proofFilter,
  setProofFilter,
  pendingProofsCount,
  loadAllProofs,
  proofImages,
  loadProofImg,
  reviewingProofId,
  setReviewingProofId,
  proofsReviewerNote,
  setProofsReviewerNote,
  proofsReviewLoading,
  handleProofReview,
}: PaymentProofsPanelProps) {
  const visible = allProofs?.filter((proof) => proofFilter === 'ALL' || proof.status === proofFilter) || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-bold text-gray-800">إيصالات التحويل المرسلة من العملاء</p>
          <p className="text-xs text-gray-500">{visible.length} إيصال ظاهر</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const).map((filter) => (
            <button
              type="button"
              key={filter}
              onClick={() => setProofFilter(filter)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                proofFilter === filter
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >
              {FILTER_LABELS[filter]}{filter === 'PENDING' && pendingProofsCount > 0 ? ` (${pendingProofsCount})` : ''}
            </button>
          ))}
          <button
            type="button"
            onClick={loadAllProofs}
            disabled={proofsLoading}
            className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-600 transition hover:bg-gray-200 disabled:opacity-60"
          >
            <RefreshCw size={13} className={proofsLoading ? 'animate-spin' : ''} /> تحديث
          </button>
        </div>
      </div>

      {!allProofs && !proofsLoading && (
        <div className="rounded-lg border border-gray-100 bg-white p-12 text-center">
          <Receipt size={40} className="mx-auto mb-3 text-gray-200" />
          <p className="mb-3 text-gray-500">اضغط تحديث لتحميل الإيصالات</p>
          <button type="button" onClick={loadAllProofs} className="rounded-lg bg-primary-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-primary-700">
            تحميل الإيصالات
          </button>
        </div>
      )}

      {proofsLoading && (
        <div className="rounded-lg border border-gray-100 bg-white p-8 text-center text-sm text-gray-400">جاري التحميل...</div>
      )}

      {allProofs && visible.length === 0 && (
        <div className="rounded-lg border border-gray-100 bg-white p-12 text-center text-gray-400">
          <CheckCircle size={36} className="mx-auto mb-3 text-gray-200" />
          <p>لا توجد إيصالات في هذه الحالة</p>
        </div>
      )}

      {allProofs && visible.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs font-bold text-gray-600">
                <tr>
                  <th className="p-3">العميل</th>
                  <th className="p-3">المبلغ</th>
                  <th className="p-3">طريقة الدفع</th>
                  <th className="p-3">الكورس</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">التاريخ</th>
                  <th className="p-3">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map((proof) => {
                  const isReviewing = reviewingProofId === proof.id;
                  return (
                    <React.Fragment key={proof.id}>
                      <tr className="align-top hover:bg-gray-50">
                        <td className="p-3">
                          <p className="font-bold text-gray-900">{proof.subscriber_name || '-'}</p>
                          <p className="text-xs text-gray-500">{proof.subscriber_phone || ''}</p>
                          {proof.note && <p className="mt-1 text-xs italic text-gray-500">{proof.note}</p>}
                        </td>
                        <td className="p-3 font-extrabold text-emerald-700">
                          {Number(proof.amount || 0).toLocaleString()} {currencyLabel(proof.currency)}
                        </td>
                        <td className="p-3 text-xs text-gray-600">{proof.payment_method || '-'}</td>
                        <td className="p-3 text-xs text-primary-700">{proof.course_title || '-'}</td>
                        <td className="p-3">
                          <span className={`rounded-full px-2 py-1 text-xs font-bold ${STATUS_CLASS[proof.status] || STATUS_CLASS.PENDING}`}>
                            {FILTER_LABELS[(proof.status as ProofFilter) || 'PENDING'] || proof.status}
                          </span>
                        </td>
                        <td className="p-3 text-xs text-gray-500">{proof.submitted_at?.slice(0, 10) || '-'}</td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1">
                            {!proofImages[proof.id] && (
                              <button type="button" onClick={() => loadProofImg(proof.id)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-primary-700 hover:bg-primary-50">
                                <Eye size={13} /> عرض
                              </button>
                            )}
                            {proof.status === 'PENDING' && !isReviewing && (
                              <>
                                <button type="button" onClick={() => { setReviewingProofId(proof.id); setProofsReviewerNote(''); loadProofImg(proof.id); }} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-xs font-bold text-white hover:bg-emerald-700">
                                  <CheckCircle size={13} /> قبول
                                </button>
                                <button type="button" onClick={() => { setReviewingProofId(proof.id); setProofsReviewerNote(''); }} className="inline-flex items-center gap-1 rounded-lg bg-red-500 px-2 py-1 text-xs font-bold text-white hover:bg-red-600">
                                  <XCircle size={13} /> رفض
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      {(proofImages[proof.id] || proof.reviewer_note || isReviewing) && (
                        <tr>
                          <td colSpan={7} className="bg-gray-50 p-3">
                            <div className="grid gap-3 md:grid-cols-[240px_1fr]">
                              {proofImages[proof.id] ? (
                                <img src={proofImages[proof.id]} alt="receipt" className="max-h-56 w-full rounded-lg border border-gray-200 object-contain" />
                              ) : <div />}
                              <div className="space-y-2">
                                {proof.reviewer_note && <p className="rounded-lg bg-white px-3 py-2 text-xs text-gray-600">ملاحظة المراجع: {proof.reviewer_note}</p>}
                                {isReviewing && proof.status === 'PENDING' && (
                                  <>
                                    <input
                                      value={proofsReviewerNote}
                                      onChange={(event) => setProofsReviewerNote(event.target.value)}
                                      placeholder="ملاحظة للعميل (اختياري)"
                                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs"
                                    />
                                    <div className="flex flex-wrap gap-2">
                                      <button type="button" onClick={() => handleProofReview(proof.id, 'approve')} disabled={proofsReviewLoading} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
                                        {proofsReviewLoading ? '...' : 'تأكيد القبول'}
                                      </button>
                                      <button type="button" onClick={() => handleProofReview(proof.id, 'reject')} disabled={proofsReviewLoading} className="rounded-lg bg-red-500 px-3 py-2 text-xs font-bold text-white hover:bg-red-600 disabled:opacity-60">
                                        {proofsReviewLoading ? '...' : 'تأكيد الرفض'}
                                      </button>
                                      <button type="button" onClick={() => setReviewingProofId(null)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 hover:bg-gray-50">
                                        إلغاء
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
