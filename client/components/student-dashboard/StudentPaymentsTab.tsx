import { Camera, Calendar, CheckCircle, CreditCard, DollarSign, Loader2, Plus } from 'lucide-react';
import type React from 'react';

import type { Course, PaymentProof, SubscriberItem } from '../../types';

type CoursePaymentSummary = {
  paidEGP: number;
  expectedEGP?: number;
};

type ProofCurrency = 'EGP' | 'SAR' | 'USD';
type ProofMethod = 'instapay' | 'bank_transfer' | 'vodafone_cash' | 'fawry' | 'other';

type InstallmentModalState = {
  courseId: string;
  courseTitle: string;
  remaining: number;
};

type Props = {
  subscriber: SubscriberItem | undefined;
  enrolledCourses: Course[];
  coursePayMap: Record<string, CoursePaymentSummary>;
  showProofForm: boolean;
  proofAmount: string;
  proofCurrency: ProofCurrency;
  proofMethod: ProofMethod;
  proofCourseId: string;
  proofNote: string;
  proofImage: string | null;
  proofImageName: string;
  proofSubmitting: boolean;
  proofSuccess: boolean;
  proofError: string;
  myProofs: PaymentProof[];
  proofsLoaded: boolean;
  setShowProofForm: (value: boolean) => void;
  setProofAmount: (value: string) => void;
  setProofCurrency: (value: ProofCurrency) => void;
  setProofMethod: (value: ProofMethod) => void;
  setProofCourseId: (value: string) => void;
  setProofNote: (value: string) => void;
  setInstallModal: (value: InstallmentModalState) => void;
  setInstallAmount: (value: string) => void;
  setInstallIframeUrl: (value: string) => void;
  setInstallError: (value: string) => void;
  onOpenCourses: () => void;
  loadMyProofs: () => void;
  handleProofImageChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleSubmitProof: () => void;
};

const moneySuffix = (currency: string) => currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : '$';

export function StudentPaymentsTab({
  subscriber,
  enrolledCourses,
  coursePayMap,
  showProofForm,
  proofAmount,
  proofCurrency,
  proofMethod,
  proofCourseId,
  proofNote,
  proofImage,
  proofImageName,
  proofSubmitting,
  proofSuccess,
  proofError,
  myProofs,
  proofsLoaded,
  setShowProofForm,
  setProofAmount,
  setProofCurrency,
  setProofMethod,
  setProofCourseId,
  setProofNote,
  setInstallModal,
  setInstallAmount,
  setInstallIframeUrl,
  setInstallError,
  onOpenCourses,
  loadMyProofs,
  handleProofImageChange,
  handleSubmitProof,
}: Props) {
  const history = subscriber?.paymentHistory ?? [];
  // status is undefined/missing for older rows written before the field
  // existed — treat that the same as 'paid' (backward compat); only exclude
  // rows explicitly marked pending/failed from "what the client has paid"
  // (PAY-13). Scoped to the totals only — the full history list below still
  // shows pending/failed entries so the client can track their status.
  const isPaid = (payment: { status?: string }) => !payment.status || payment.status === 'paid';
  const paidHistory = history.filter(isPaid);
  const totalEGP = paidHistory.filter(payment => payment.currency === 'EGP').reduce((sum, payment) => sum + payment.amount, 0);
  const totalSAR = paidHistory.filter(payment => payment.currency === 'SAR').reduce((sum, payment) => sum + payment.amount, 0);
  const totalUSD = paidHistory.filter(payment => payment.currency === 'USD').reduce((sum, payment) => sum + payment.amount, 0);
  const methodMap: Record<string, number> = {};

  paidHistory.filter(payment => payment.currency === 'EGP').forEach(payment => {
    const method = payment.paymentMethod || 'غير محدد';
    methodMap[method] = (methodMap[method] || 0) + payment.amount;
  });
  const methodEntries = Object.entries(methodMap).sort((a, b) => b[1] - a[1]);

  if (history.length === 0 && enrolledCourses.length === 0 && (subscriber?.installmentPlans ?? []).length === 0) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-gray-100 bg-white p-12 text-center shadow-sm">
        <CreditCard size={40} className="mx-auto mb-4 text-gray-300" />
        <p className="text-gray-500">لا توجد مدفوعات مسجلة بعد</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="rounded-2xl bg-gradient-to-br from-primary-600 to-primary-800 p-5 text-white shadow">
        <p className="mb-2 text-sm font-bold text-white/70">إجمالي ما دفعته</p>
        <div className="mb-4 flex flex-wrap items-end gap-6">
          {totalEGP > 0 && <div><p className="text-3xl font-extrabold">{totalEGP.toLocaleString()}</p><p className="text-xs text-white/60">جنيه مصري</p></div>}
          {totalSAR > 0 && <div><p className="text-3xl font-extrabold">{totalSAR.toLocaleString()}</p><p className="text-xs text-white/60">ريال سعودي</p></div>}
          {totalUSD > 0 && <div><p className="text-3xl font-extrabold">{totalUSD.toLocaleString()}</p><p className="text-xs text-white/60">دولار</p></div>}
          {totalEGP + totalSAR + totalUSD === 0 && (
            <p className="text-sm font-bold text-white/70">لا توجد مدفوعات مؤكدة بعد</p>
          )}
        </div>
        {methodEntries.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-white/20 pt-3">
            {methodEntries.map(([method, total]) => (
              <div key={method} className="rounded-xl bg-white/10 px-3 py-1.5 text-xs">
                <span className="text-white/70">{method}: </span>
                <span className="font-bold text-white">{total.toLocaleString()} ج.م</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {enrolledCourses.length > 0 && (
        <div>
          <p className="mb-3 text-sm font-extrabold text-gray-700">مدفوعات كل كورس</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {enrolledCourses.map(course => {
              const summary = coursePayMap[course.id];
              if (!summary) return null;
              const remaining = summary.expectedEGP != null ? Math.max(0, summary.expectedEGP - summary.paidEGP) : null;
              const pct = summary.expectedEGP ? Math.min(100, Math.round((summary.paidEGP / summary.expectedEGP) * 100)) : 100;

              return (
                <div key={course.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                  <p className="mb-3 line-clamp-1 text-sm font-bold text-gray-800">{course.title}</p>
                  <div className="mb-3 space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-500">مدفوع</span>
                      <span className="font-extrabold text-green-700">{summary.paidEGP.toLocaleString()} ج.م</span>
                    </div>
                    {summary.expectedEGP != null && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-gray-500">الإجمالي المطلوب</span>
                          <span className="font-bold">{summary.expectedEGP.toLocaleString()} ج.م</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">الباقي</span>
                          <span className={`font-bold ${remaining && remaining > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {remaining && remaining > 0 ? `${remaining.toLocaleString()} ج.م` : 'مكتمل'}
                          </span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
                          <div className="h-full rounded-full bg-primary-500" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="text-right text-gray-400">{pct}%</p>
                      </>
                    )}
                  </div>
                  {remaining !== null && remaining > 0 && (
                    <button
                      onClick={() => {
                        setInstallModal({ courseId: course.id, courseTitle: course.title, remaining });
                        setInstallAmount(String(remaining));
                        setInstallIframeUrl('');
                        setInstallError('');
                        onOpenCourses();
                      }}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-500 py-2 text-xs font-bold text-white transition hover:bg-amber-600"
                    >
                      <DollarSign size={13} /> ادفع قسطا الآن
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(subscriber?.installmentPlans ?? []).length > 0 && (
        <div>
          <p className="mb-3 flex items-center gap-2 text-sm font-extrabold text-gray-700">
            <Calendar size={15} className="text-amber-500" /> خطط الأقساط
          </p>
          <div className="space-y-4">
            {subscriber!.installmentPlans!.map(plan => {
              const paidTotal = plan.entries.reduce((sum, entry) => sum + (entry.paidAt ? (entry.paidAmount ?? entry.amount) : 0), 0);
              const remaining = plan.totalAmount - paidTotal;
              const todayStr = new Date().toISOString().slice(0, 10);

              return (
                <div key={plan.id} className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                  <div className="flex items-center justify-between border-b border-gray-50 bg-amber-50/50 px-4 py-3">
                    <div>
                      <p className="text-sm font-bold text-gray-800">{plan.courseTitle || 'قسط عام'}</p>
                      <p className="text-xs text-gray-500">الإجمالي: {plan.totalAmount.toLocaleString()} {moneySuffix(plan.currency)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">مدفوع: <span className="font-bold text-emerald-700">{paidTotal.toLocaleString()}</span></p>
                      <p className="text-xs text-gray-500">متبقي: <span className={`font-bold ${remaining > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{remaining > 0 ? `${remaining.toLocaleString()} ${moneySuffix(plan.currency)}` : 'مكتمل'}</span></p>
                    </div>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {plan.entries.map(entry => {
                      const isOverdue = !entry.paidAt && entry.dueDate < todayStr;
                      const daysLeft = !entry.paidAt && entry.dueDate >= todayStr
                        ? Math.ceil((new Date(entry.dueDate).getTime() - Date.now()) / 86400000)
                        : null;
                      const daysOverdue = isOverdue
                        ? Math.floor((Date.now() - new Date(entry.dueDate).getTime()) / 86400000)
                        : 0;

                      return (
                        <div key={entry.id} className={`flex items-center justify-between px-4 py-3 text-sm ${isOverdue ? 'bg-red-50/60' : entry.paidAt ? 'bg-emerald-50/30' : ''}`}>
                          <div className="flex items-center gap-3">
                            <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${entry.paidAt ? 'bg-emerald-100 text-emerald-700' : isOverdue ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                              {entry.paidAt ? '✓' : isOverdue ? '!' : '◷'}
                            </div>
                            <div>
                              <p className="font-bold text-gray-800">{entry.amount.toLocaleString()} {moneySuffix(plan.currency)}</p>
                              <p className="text-xs text-gray-500">موعد الاستحقاق: {entry.dueDate}</p>
                              {entry.note && <p className="text-xs text-gray-400">{entry.note}</p>}
                            </div>
                          </div>
                          <div className="flex-shrink-0 text-right">
                            {entry.paidAt ? (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-600">مدفوع</span>
                            ) : isOverdue ? (
                              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-600">متأخر {daysOverdue} يوم</span>
                            ) : daysLeft !== null && daysLeft <= 7 ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">خلال {daysLeft} يوم</span>
                            ) : (
                              <span className="text-xs text-gray-400">مستقبلي</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">المبلغ</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">طريقة الدفع</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">النوع</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">ملاحظة</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">التاريخ</th>
            </tr>
          </thead>
          <tbody>
            {history.slice().reverse().map(payment => (
              <tr key={payment.id} className="border-b border-gray-50 transition hover:bg-gray-50">
                <td className="whitespace-nowrap px-4 py-3 font-bold text-primary-700">{payment.amount.toLocaleString()} {moneySuffix(payment.currency)}</td>
                <td className="px-4 py-3 text-xs text-gray-600">{payment.paymentMethod || <span className="text-gray-300">-</span>}</td>
                <td className="px-4 py-3">
                  <PaymentTypeBadge paymentType={payment.paymentType} isInstallment={payment.isInstallment} />
                </td>
                <td className="max-w-[180px] truncate px-4 py-3 text-xs text-gray-400">{payment.note || '-'}</td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">{payment.at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-gray-800">رفع إيصال تحويل / انستا باي</p>
            <p className="mt-0.5 text-xs text-gray-500">ارفع صورة الإيصال وسيتم مراجعته وتسجيله خلال 24 ساعة</p>
          </div>
          {!showProofForm && (
            <button
              onClick={() => { setShowProofForm(true); if (!proofsLoaded) loadMyProofs(); }}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-700"
            >
              <Plus size={14} /> رفع إيصال
            </button>
          )}
        </div>

        {proofSuccess && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle size={16} /> تم إرسال الإيصال بنجاح. سيتم مراجعته خلال 24 ساعة.
          </div>
        )}

        {showProofForm && (
          <div className="mb-4 space-y-4 rounded-xl border border-emerald-100 bg-emerald-50/40 p-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-bold text-gray-600">المبلغ المدفوع *</label>
                <input type="number" min="1" value={proofAmount} onChange={event => setProofAmount(event.target.value)} placeholder="مثال: 500" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-gray-600">العملة</label>
                <select value={proofCurrency} onChange={event => setProofCurrency(event.target.value as ProofCurrency)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                  <option value="EGP">جنيه مصري (EGP)</option>
                  <option value="SAR">ريال سعودي (SAR)</option>
                  <option value="USD">دولار (USD)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-gray-600">طريقة الدفع</label>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {([
                  { val: 'instapay', label: 'انستا باي' },
                  { val: 'bank_transfer', label: 'تحويل بنكي' },
                  { val: 'vodafone_cash', label: 'فودافون كاش' },
                  { val: 'fawry', label: 'فوري' },
                  { val: 'other', label: 'أخرى' },
                ] as const).map(method => (
                  <button key={method.val} type="button" onClick={() => setProofMethod(method.val)} className={`rounded-lg border-2 py-1.5 text-xs font-medium transition ${proofMethod === method.val ? 'border-emerald-500 bg-white text-emerald-700' : 'border-gray-200 bg-white text-gray-500 hover:border-emerald-200'}`}>
                    {method.label}
                  </button>
                ))}
              </div>
            </div>

            {enrolledCourses.length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-bold text-gray-600">الكورس (اختياري)</label>
                <select value={proofCourseId} onChange={event => setProofCourseId(event.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                  <option value="">اختر الكورس إن وجد</option>
                  {enrolledCourses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-bold text-gray-600">صورة الإيصال / لقطة الشاشة</label>
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 bg-white p-4 transition hover:border-emerald-300">
                <input type="file" accept="image/*" className="hidden" onChange={handleProofImageChange} />
                {proofImage ? (
                  <div className="w-full space-y-2">
                    <img src={proofImage} alt="receipt" className="mx-auto max-h-40 rounded-lg object-contain" />
                    <p className="text-center text-xs text-emerald-600">{proofImageName} ✓</p>
                  </div>
                ) : (
                  <>
                    <Camera size={24} className="text-gray-300" />
                    <p className="text-xs text-gray-400">اضغط لرفع الصورة</p>
                    <p className="text-[10px] text-gray-300">PNG أو JPG حتى 4 ميجا</p>
                  </>
                )}
              </label>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-gray-600">ملاحظة (اختياري)</label>
              <input type="text" value={proofNote} onChange={event => setProofNote(event.target.value)} placeholder="مثال: دفعة القسط الثاني للشهر الحالي" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm" />
            </div>

            {proofError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{proofError}</p>}
            <div className="flex gap-2 pt-1">
              <button onClick={handleSubmitProof} disabled={proofSubmitting} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-60">
                {proofSubmitting ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
                {proofSubmitting ? 'جاري الإرسال...' : 'إرسال الإيصال'}
              </button>
              <button onClick={() => { setShowProofForm(false); }} className="rounded-xl border border-gray-200 px-4 text-sm text-gray-500 hover:bg-gray-50">إلغاء</button>
            </div>
          </div>
        )}

        {!showProofForm && (
          <SubmittedProofs proofsLoaded={proofsLoaded} myProofs={myProofs} loadMyProofs={loadMyProofs} />
        )}
      </div>
    </div>
  );
}

function PaymentTypeBadge({ paymentType, isInstallment }: { paymentType?: string; isInstallment?: boolean }) {
  const typeMap: Record<string, [string, string]> = {
    course: isInstallment ? ['bg-amber-100 text-amber-700', 'قسط كورس'] : ['bg-green-100 text-green-700', 'حجز كورس'],
    certificate: ['bg-violet-100 text-violet-700', 'شهادة'],
    consultation: ['bg-blue-100 text-blue-700', 'استشارة'],
    book: ['bg-teal-100 text-teal-700', 'كتاب'],
    carneh: ['bg-indigo-100 text-indigo-700', 'كارنيه'],
    other: ['bg-gray-100 text-gray-600', 'أخرى'],
  };
  const [classes, label] = paymentType && typeMap[paymentType]
    ? typeMap[paymentType]
    : isInstallment ? ['bg-amber-100 text-amber-700', 'قسط'] : ['bg-green-100 text-green-700', 'حجز جديد'];

  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${classes}`}>{label}</span>;
}

function SubmittedProofs({ proofsLoaded, myProofs, loadMyProofs }: { proofsLoaded: boolean; myProofs: PaymentProof[]; loadMyProofs: () => void }) {
  if (!proofsLoaded) {
    return <button onClick={loadMyProofs} className="text-xs text-primary-600 hover:underline">عرض الإيصالات المرسلة</button>;
  }

  if (myProofs.length === 0) {
    return <p className="py-3 text-center text-xs text-gray-400">لا توجد إيصالات مرسلة بعد</p>;
  }

  return (
    <div className="space-y-2">
      <p className="mb-2 text-xs font-bold text-gray-600">إيصالاتي المرسلة ({myProofs.length})</p>
      {myProofs.map(proof => (
        <div key={proof.id} className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2.5 text-xs">
          <div className="min-w-0 flex-1">
            <p className="font-bold text-gray-700">{proof.amount.toLocaleString()} {moneySuffix(proof.currency)}</p>
            <p className="truncate text-gray-400">{proof.payment_method} · {proof.submitted_at.slice(0, 10)}{proof.note ? ` · ${proof.note}` : ''}</p>
            {proof.reviewer_note && proof.status !== 'PENDING' && (
              <p className="mt-0.5 text-gray-500">رد الإدارة: {proof.reviewer_note}</p>
            )}
          </div>
          <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${proof.status === 'APPROVED' ? 'bg-green-100 text-green-700' : proof.status === 'REJECTED' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
            {proof.status === 'APPROVED' ? 'معتمد' : proof.status === 'REJECTED' ? 'مرفوض' : 'قيد المراجعة'}
          </span>
        </div>
      ))}
    </div>
  );
}
