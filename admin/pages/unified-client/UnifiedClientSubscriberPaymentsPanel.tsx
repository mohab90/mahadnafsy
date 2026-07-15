import React, { Suspense, type Dispatch, type SetStateAction } from 'react';
import { AlertCircle, CreditCard, Plus, Printer, RefreshCw, Trash2 } from 'lucide-react';

import type { PaymentDraft } from '../../components/PaymentModal';
import type { Course, PaymentHistoryEntry, PaymentProof, SubscriberItem } from '../../types';
import { ptLabels } from './constants';
import { UnifiedClientPaymentSummaryPanel } from './UnifiedClientPaymentSummaryPanel';

const PaymentModal = React.lazy(() => import('../../components/PaymentModal'));

type PaidTotals = { EGP: number; SAR: number; USD: number };
type BookingMap = Record<string, { paidEGP: number; expectedEGP?: number; discount?: number }>;
type ReviewAction = 'approve' | 'reject';

type UnifiedClientSubscriberPaymentsPanelProps = {
  subscriber: SubscriberItem;
  courses: Course[];
  clientName: string;
  isAdmin: boolean;
  showSubPayForm: boolean;
  payModalDraft: PaymentDraft;
  setPayModalDraft: Dispatch<SetStateAction<PaymentDraft>>;
  onShowPaymentForm: () => void;
  onClosePaymentForm: () => void;
  onPaymentSubmit: (draft: PaymentDraft) => void;
  subPaidTotals: PaidTotals;
  subRemainingEGP: number;
  bookedCourseIds: string[];
  bookingMap: BookingMap;
  confirmedHistory: PaymentHistoryEntry[];
  subHistory: PaymentHistoryEntry[];
  onUpdateSubscriber: (subscriber: SubscriberItem) => void;
  clientProofs: PaymentProof[];
  clientProofsLoaded: boolean;
  reviewingProofId: string | null;
  reviewerNote: string;
  proofImageUrl: Record<string, string>;
  reviewLoading: boolean;
  setReviewingProofId: Dispatch<SetStateAction<string | null>>;
  setReviewerNote: Dispatch<SetStateAction<string>>;
  loadClientProofs: () => void;
  loadProofImage: (proofId: string) => void;
  handleReviewProof: (proofId: string, action: ReviewAction) => void | Promise<void>;
};

export function UnifiedClientSubscriberPaymentsPanel({
  subscriber,
  courses,
  clientName,
  isAdmin,
  showSubPayForm,
  payModalDraft,
  setPayModalDraft,
  onShowPaymentForm,
  onClosePaymentForm,
  onPaymentSubmit,
  subPaidTotals,
  subRemainingEGP,
  bookedCourseIds,
  bookingMap,
  confirmedHistory,
  subHistory,
  onUpdateSubscriber,
  clientProofs,
  clientProofsLoaded,
  reviewingProofId,
  reviewerNote,
  proofImageUrl,
  reviewLoading,
  setReviewingProofId,
  setReviewerNote,
  loadClientProofs,
  loadProofImage,
  handleReviewProof,
}: UnifiedClientSubscriberPaymentsPanelProps) {
  const updateSubscriber = onUpdateSubscriber;

  return (
    <>
      <button onClick={() => setShowSubPayForm(true)}
        className="w-full py-3 border-2 border-dashed border-emerald-200 rounded-xl text-emerald-600 hover:bg-emerald-50 text-sm flex items-center justify-center gap-2">
        <Plus size={18} /> حجز أو دفع جديد
      </button>
      {showSubPayForm && subscriber && (
        <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black/20" />}>
          <PaymentModal
            mode="subscriber"
            subject={{ id: subscriber.id, name: subscriber.name, phone: subscriber.phone, enrolledCourseIds: subscriber.enrolledCourseIds, paymentHistory: subscriber.paymentHistory || [], extraCertificateRequests: subscriber.extraCertificateRequests || [] }}
            draft={payModalDraft}
            setDraft={setPayModalDraft}
            onSubmit={(d) => handlePayModalSubmit(d)}
            onClose={() => setShowSubPayForm(false)}
          />
        </Suspense>
      )}
      {/* ── Financial Summary Strip ── */}
      <UnifiedClientPaymentSummaryPanel
        totalPaidEGP={subPaidTotals.EGP}
        remainingEGP={subRemainingEGP}
        transactionCount={subHistory.length}
      />

      {/* ── Per-course breakdown cards ── */}
      {bookedCourseIds.length > 0 && (
        <div className="space-y-2 mb-3">
          {bookedCourseIds.map(cId => {
            const course = courses.find(c => c.id === cId);
            const bm = bookingMap[cId] || { paidEGP: 0 };
            const expected = bm.expectedEGP || 0;
            const pct = expected > 0 ? Math.min(100, Math.round((bm.paidEGP / expected) * 100)) : 100;
            const remaining = expected > 0 ? Math.max(0, expected - bm.paidEGP) : 0;
            return (
              <div key={cId} className="bg-white border border-gray-100 rounded-xl px-3 py-2.5 shadow-sm">
                <div className="flex items-center justify-between mb-1.5 gap-2">
                  <p className="text-sm font-bold text-gray-800 truncate flex-1">{course?.title || cId}</p>
                  {remaining > 0
                    ? <span className="text-xs font-bold text-red-600 shrink-0">متبقي {remaining.toLocaleString()} ج.م</span>
                    : <span className="text-xs font-bold text-emerald-600 shrink-0">✅ مكتمل</span>}
                </div>
                {expected > 0 && (
                  <>
                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-[10px] text-gray-400 mt-0.5">{bm.paidEGP.toLocaleString()} من {expected.toLocaleString()} ج.م ({pct}%)</p>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Transaction History ── */}
      {confirmedHistory.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">سجل المعاملات ({confirmedHistory.length})</p>
          <div className="space-y-2">
            {[...confirmedHistory].sort((a, b) => {
              const dc = b.at.localeCompare(a.at);
              if (dc !== 0) return dc;
              return confirmedHistory.indexOf(b) - confirmedHistory.indexOf(a);
            }).map(p => (
              <div key={p.id} className="group flex items-start justify-between bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 hover:border-gray-200 transition-colors">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-extrabold text-emerald-700 text-base">{Number(p.amount).toLocaleString()} {p.currency === 'EGP' ? 'ج.م' : p.currency === 'SAR' ? 'ر.س' : '$'}</span>
                    {p.paymentType && <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{ptLabels[p.paymentType] || p.paymentType}</span>}
                    {p.isInstallment === true && <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">💳 قسط</span>}
                    {p.isInstallment === false && <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">🆕 حجز</span>}
                  </div>
                  {(p.itemTitle || p.courseId) && <p className="text-xs text-gray-500 truncate">{p.itemTitle || courses.find(c => c.id === p.courseId)?.title || p.courseId}</p>}
                  <div className="flex items-center gap-2 flex-wrap text-[10px] text-gray-400">
                    {p.paymentMethod && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{p.paymentMethod}</span>}
                    {p.staffName && <span className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">بواسطة: {p.staffName}</span>}
                    <span>{p.at?.slice(0, 10)}</span>
                    {p.transactionId && <span className="italic">#{p.transactionId}</span>}
                    {p.note && !p.transactionId && <span className="italic">{p.note}</span>}
                  </div>
                </div>
                {/* Action buttons */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity mt-1 shrink-0 mr-2">
                  {/* Print receipt */}
                  <button
                    title="طباعة إيصال"
                    onClick={() => {
                      const w = window.open('', '_blank', 'width=700,height=900');
                      if (!w) return;
                      const courseName = p.itemTitle || courses.find(c => c.id === p.courseId)?.title || '';
                      w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>إيصال دفع</title><style>body{font-family:Arial,sans-serif;padding:40px;direction:rtl;color:#111}.header{text-align:center;border-bottom:3px solid #d97706;padding-bottom:20px;margin-bottom:30px}h1{color:#d97706;margin:0;font-size:24px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:12px 16px;border:1px solid #e5e7eb;text-align:right}th{background:#fffbeb;font-weight:700}tfoot td{font-weight:700;background:#f0fdf4}.footer{margin-top:40px;text-align:center;color:#888;font-size:12px;border-top:1px solid #e5e7eb;padding-top:16px}</style></head><body><div class="header"><h1>معهد الدراسات النفسية</h1><p style="color:#888;font-size:12px">إيصال دفع — ${p.at?.slice(0, 10) || ''}</p></div><h3>العميل: ${clientName}${p.staffName ? ` | بواسطة: ${p.staffName}` : ''}</h3><table><thead><tr><th>الخدمة</th><th>النوع</th><th>وسيلة الدفع</th><th>المبلغ</th></tr></thead><tbody><tr><td>${courseName || ptLabels[p.paymentType || ''] || 'دفعة'}</td><td>${ptLabels[p.paymentType || ''] || '—'}</td><td>${p.paymentMethod || '—'}</td><td>${Number(p.amount).toLocaleString()} ${p.currency || 'EGP'}</td></tr></tbody><tfoot><tr><td colspan="3">الإجمالي</td><td>${Number(p.amount).toLocaleString()} ${p.currency || 'EGP'}</td></tr></tfoot></table>${p.transactionId ? `<p style="margin-top:16px;font-size:12px;color:#888;">رقم المعاملة: ${p.transactionId}</p>` : ''}<div class="footer">معهد الدراسات النفسية — mahadnafsy.com</div></body></html>`);
                      w.document.close(); setTimeout(() => w.print(), 500);
                    }}
                    className="text-amber-500 hover:text-amber-700 hover:bg-amber-50 p-1 rounded-lg transition">
                    <Printer size={14} />
                  </button>
                  {/* Mark as failed - admin only */}
                  {isAdmin && (
                    <button
                      title="تحديد كفشل"
                      onClick={() => {
                        if (!window.confirm('هل تريد تحديد هذه الدفعة كـ "فشل"؟')) return;
                        const updated = subHistory.map(x => x.id === p.id ? { ...x, status: 'failed' as const } : x);
                        updateSubscriber({ ...subscriber!, paymentHistory: updated });
                      }}
                      className="text-orange-400 hover:text-orange-600 hover:bg-orange-50 p-1 rounded-lg transition">
                      <AlertCircle size={14} />
                    </button>
                  )}
                  {/* Delete - admin only */}
                  {isAdmin && (
                    <button
                      title="حذف الدفعة"
                      onClick={() => {
                        if (!window.confirm('هل تريد حذف هذه الدفعة؟ لا يمكن التراجع.')) return;
                        updateSubscriber({ ...subscriber!, paymentHistory: subHistory.filter(x => x.id !== p.id) });
                      }}
                      className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1 rounded-lg transition">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {confirmedHistory.length === 0 && !showSubPayForm && (
        <div className="text-center py-10 text-gray-400"><CreditCard size={40} className="mx-auto mb-2 text-gray-200" /><p>لا توجد مدفوعات</p></div>
      )}

      {/* ── Payment Proofs (client-uploaded receipts) ── */}
      {isSub && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <p className="font-bold text-gray-700 text-sm">إيصالات التحويل</p>
              {(() => {
                const pendingCount = clientProofs.filter(p => p.status === 'PENDING').length;
                return pendingCount > 0 ? <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{pendingCount} عالق</span> : null;
              })()}
            </div>
            <button onClick={loadClientProofs} className="text-xs text-primary-600 hover:underline flex items-center gap-1">
              <RefreshCw size={12} /> تحديث
            </button>
          </div>
          {clientProofsLoaded && clientProofs.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-3">لا توجد إيصالات مرسلة</p>
          )}
          {clientProofsLoaded && clientProofs.map(pr => {
            const isReviewing = reviewingProofId === pr.id;
            return (
              <div key={pr.id} className={`rounded-xl border p-3 mb-2 space-y-2 ${pr.status === 'PENDING' ? 'border-amber-200 bg-amber-50/40' : pr.status === 'APPROVED' ? 'border-green-200 bg-green-50/30' : 'border-red-200 bg-red-50/30'}`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <p className="font-extrabold text-gray-800">{pr.amount.toLocaleString()} {pr.currency === 'EGP' ? 'ج.م' : pr.currency === 'SAR' ? 'ر.س' : '$'}</p>
                    <p className="text-xs text-gray-500">{pr.payment_method} · {pr.submitted_at.slice(0, 10)}{pr.note ? ' · ' + pr.note : ''}</p>
                    {pr.course_title && <p className="text-xs text-gray-400">الكورس: {pr.course_title}</p>}
                  </div>
                  <span className={`font-bold text-[11px] px-2 py-1 rounded-full ${pr.status === 'APPROVED' ? 'bg-green-100 text-green-700' : pr.status === 'REJECTED' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                    {pr.status === 'APPROVED' ? '✅ مُعتمد' : pr.status === 'REJECTED' ? '❌ مرفوض' : '⏳ قيد المراجعة'}
                  </span>
                </div>
                {pr.status === 'PENDING' && !proofImageUrl[pr.id] && (
                  <button onClick={() => loadProofImage(pr.id)} className="text-xs text-primary-600 hover:underline">عرض الصورة</button>
                )}
                {proofImageUrl[pr.id] && (
                  <img src={proofImageUrl[pr.id]} alt="receipt" className="max-h-48 rounded-lg object-contain border border-gray-100" />
                )}
                {pr.reviewer_note && <p className="text-xs text-gray-500">ملاحظة الإدارة: {pr.reviewer_note}</p>}
                {pr.status === 'PENDING' && !isReviewing && (
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => { setReviewingProofId(pr.id); setReviewerNote(''); }} className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition">قبول ✅</button>
                    <button onClick={() => { setReviewingProofId(pr.id); setReviewerNote(''); }} className="flex-1 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-lg transition">رفض ❌</button>
                  </div>
                )}
                {pr.status === 'PENDING' && isReviewing && (
                  <div className="space-y-2 pt-1">
                    <input value={reviewerNote} onChange={e => setReviewerNote(e.target.value)}
                      placeholder="ملاحظة للعميل (اختياري)"
                      className="w-full border border-gray-200 bg-white rounded-lg px-3 py-1.5 text-xs" />
                    <div className="flex gap-2">
                      <button onClick={() => handleReviewProof(pr.id, 'approve')} disabled={reviewLoading}
                        className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold rounded-lg">
                        {reviewLoading ? '...' : '✅ قبول واعتماد الدفعة'}
                      </button>
                      <button onClick={() => handleReviewProof(pr.id, 'reject')} disabled={reviewLoading}
                        className="flex-1 py-1.5 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white text-xs font-bold rounded-lg">
                        {reviewLoading ? '...' : '❌ رفض'}
                      </button>
                      <button onClick={() => setReviewingProofId(null)} className="px-3 border border-gray-200 rounded-lg text-xs text-gray-500">إلغاء</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
