import { useEffect, useState } from 'react';
import { CheckCircle, Eye, Receipt, XCircle } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { SubscriberItem, PaymentProof, StaffMember } from '../../../../types';
import type { AuthUser } from '../../../../types';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface Props {
  notify: NotifyFn;
  subscribers: SubscriberItem[];
  updateSubscriber: (sub: SubscriberItem) => void;
  staffMembers: StaffMember[];
  authUser: AuthUser | null;
  onPendingCountChange: (count: number) => void;
}

export function FinancialProofsPanel({ notify, subscribers, updateSubscriber, staffMembers, authUser, onPendingCountChange }: Props) {
  const [allProofs, setAllProofs] = useState<PaymentProof[] | null>(null);
  const [proofsLoading, setProofsLoading] = useState(false);
  const [proofFilter, setProofFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'>('PENDING');
  const [reviewingProofId, setReviewingProofId] = useState<string | null>(null);
  const [proofsReviewerNote, setProofsReviewerNote] = useState('');
  const [proofsReviewLoading, setProofsReviewLoading] = useState(false);
  const [proofImages, setProofImages] = useState<Record<string, string>>({});

  const pendingCount = allProofs ? allProofs.filter(p => p.status === 'PENDING').length : 0;

  useEffect(() => { onPendingCountChange(pendingCount); }, [pendingCount, onPendingCountChange]);

  useEffect(() => { loadAllProofs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadAllProofs = async () => {
    setProofsLoading(true);
    try {
      const rows = await mysqlAdmin.listPaymentProofs() as unknown as PaymentProof[];
      setAllProofs(rows);
    } catch { /* ignore */ } finally { setProofsLoading(false); }
  };

  const loadProofImg = (id: string) => {
    if (proofImages[id]) return;
    mysqlAdmin.getPaymentProofImage(id).then(r => {
      if (r.image) setProofImages(prev => ({ ...prev, [id]: r.image }));
    }).catch(() => {});
  };

  const handleProofReview = async (proofId: string, action: 'approve' | 'reject') => {
    setProofsReviewLoading(true);
    try {
      await mysqlAdmin.reviewPaymentProof(proofId, action, proofsReviewerNote || undefined);
      if (action === 'approve' && allProofs) {
        const proof = allProofs.find(p => p.id === proofId);
        if (proof) {
          const sub = subscribers.find(s => s.id === proof.subscriber_id);
          if (sub) {
            const reviewerName = staffMembers.find(s => s.email === authUser?.email)?.name || 'الإدارة';
            const payEntry = {
              id: `proof-${proofId}`,
              amount: proof.amount,
              currency: proof.currency as 'EGP' | 'SAR' | 'USD',
              paymentType: 'course' as const,
              isInstallment: true,
              courseId: proof.course_id ?? undefined,
              paymentMethod: proof.payment_method,
              note: `تم اعتماد الإيصال${proofsReviewerNote ? ' | ' + proofsReviewerNote : ''}`,
              staffName: reviewerName,
              at: new Date().toISOString().slice(0, 10),
              status: 'paid' as const,
            };
            const alreadyAdded = (sub.paymentHistory ?? []).some(p => p.id === `proof-${proofId}`);
            if (!alreadyAdded) {
              updateSubscriber({ ...sub, paymentHistory: [...(sub.paymentHistory ?? []), payEntry] });
            }
          }
        }
      }
      setAllProofs(prev => prev ? prev.map(p => p.id === proofId ? {
        ...p, status: action === 'approve' ? 'APPROVED' : 'REJECTED',
        reviewer_note: proofsReviewerNote || null, reviewed_at: new Date().toISOString(),
      } : p) : prev);
      setReviewingProofId(null); setProofsReviewerNote('');
      notify('success', action === 'approve' ? 'تم قبول الإيصال وإضافة الدفعة.' : 'تم رفض الإيصال.');
    } catch { notify('error', 'حدث خطأ أثناء مراجعة الإيصال.'); } finally { setProofsReviewLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="font-bold text-gray-700">إيصالات التحويل المرسلة من العملاء</p>
        <div className="flex gap-2">
          {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const).map(f => (
            <button key={f} onClick={() => setProofFilter(f)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition ${proofFilter === f ? (f === 'PENDING' ? 'border-amber-500 bg-amber-50 text-amber-700' : f === 'APPROVED' ? 'border-green-500 bg-green-50 text-green-700' : f === 'REJECTED' ? 'border-red-400 bg-red-50 text-red-600' : 'border-primary-500 bg-primary-50 text-primary-700') : 'border-gray-200 bg-white text-gray-500'}`}>
              {f === 'PENDING' ? `⏳ قيد المراجعة${pendingCount > 0 ? ` (${pendingCount})` : ''}` : f === 'APPROVED' ? '✅ مُعتمدة' : f === 'REJECTED' ? '❌ مرفوضة' : '📋 الكل'}
            </button>
          ))}
          <button onClick={loadAllProofs} disabled={proofsLoading}
            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-600 transition">
            {proofsLoading ? '...' : '🔄 تحديث'}
          </button>
        </div>
      </div>

      {!allProofs && !proofsLoading && (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <Receipt size={40} className="text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 mb-3">اضغط "تحديث" لتحميل الإيصالات</p>
          <button onClick={loadAllProofs} className="bg-primary-600 text-white px-5 py-2 rounded-xl text-sm font-bold hover:bg-primary-700 transition">تحميل الإيصالات</button>
        </div>
      )}

      {proofsLoading && (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-400 text-sm">جاري التحميل...</div>
      )}

      {allProofs && (() => {
        const visible = allProofs.filter(p => proofFilter === 'ALL' || p.status === proofFilter);
        if (visible.length === 0) return (
          <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center text-gray-400">
            <CheckCircle size={36} className="mx-auto mb-3 text-gray-200" />
            <p>لا توجد إيصالات في هذه الحالة</p>
          </div>
        );
        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {visible.map(pr => {
              const isReviewing = reviewingProofId === pr.id;
              return (
                <div key={pr.id} className={`bg-white rounded-2xl border shadow-sm p-4 space-y-3 ${pr.status === 'PENDING' ? 'border-amber-200' : pr.status === 'APPROVED' ? 'border-green-200' : 'border-red-200'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-extrabold text-gray-800 text-lg">{pr.amount.toLocaleString()} {pr.currency === 'EGP' ? 'ج.م' : pr.currency === 'SAR' ? 'ر.س' : '$'}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{pr.subscriber_name} · {pr.subscriber_phone}</p>
                      <p className="text-xs text-gray-400">{pr.payment_method} · {pr.submitted_at?.slice(0, 10)}</p>
                      {pr.course_title && <p className="text-xs text-primary-600 font-medium">📚 {pr.course_title}</p>}
                      {pr.note && <p className="text-xs text-gray-500 italic">"{pr.note}"</p>}
                    </div>
                    <span className={`shrink-0 text-[11px] font-bold px-2 py-1 rounded-full ${pr.status === 'APPROVED' ? 'bg-green-100 text-green-700' : pr.status === 'REJECTED' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                      {pr.status === 'APPROVED' ? '✅ مُعتمد' : pr.status === 'REJECTED' ? '❌ مرفوض' : '⏳ قيد المراجعة'}
                    </span>
                  </div>
                  {pr.status === 'PENDING' && !proofImages[pr.id] && (
                    <button onClick={() => loadProofImg(pr.id)} className="flex items-center gap-1.5 text-xs text-primary-600 hover:underline">
                      <Eye size={13} /> عرض صورة الإيصال
                    </button>
                  )}
                  {proofImages[pr.id] && (
                    <img src={proofImages[pr.id]} alt="receipt" className="max-h-56 rounded-xl object-contain border border-gray-100 w-full" />
                  )}
                  {pr.reviewer_note && <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">ملاحظة: {pr.reviewer_note}</p>}
                  {pr.status === 'PENDING' && !isReviewing && (
                    <div className="flex gap-2">
                      <button onClick={() => { setReviewingProofId(pr.id); setProofsReviewerNote(''); loadProofImg(pr.id); }}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-2 rounded-xl transition">
                        <CheckCircle size={14} /> قبول واعتماد
                      </button>
                      <button onClick={() => { setReviewingProofId(pr.id); setProofsReviewerNote(''); }}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-bold py-2 rounded-xl transition">
                        <XCircle size={14} /> رفض
                      </button>
                    </div>
                  )}
                  {pr.status === 'PENDING' && isReviewing && (
                    <div className="space-y-2 border-t border-gray-100 pt-3">
                      <input value={proofsReviewerNote} onChange={e => setProofsReviewerNote(e.target.value)}
                        placeholder="ملاحظة للعميل (اختياري)"
                        className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white" />
                      <div className="flex gap-2">
                        <button onClick={() => handleProofReview(pr.id, 'approve')} disabled={proofsReviewLoading}
                          className="flex-1 flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold py-2 rounded-xl">
                          <CheckCircle size={13} /> {proofsReviewLoading ? '...' : 'تأكيد القبول'}
                        </button>
                        <button onClick={() => handleProofReview(pr.id, 'reject')} disabled={proofsReviewLoading}
                          className="flex-1 flex items-center justify-center gap-1 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white text-xs font-bold py-2 rounded-xl">
                          <XCircle size={13} /> {proofsReviewLoading ? '...' : 'تأكيد الرفض'}
                        </button>
                        <button onClick={() => setReviewingProofId(null)} className="px-3 border border-gray-200 rounded-xl text-xs text-gray-500 hover:bg-gray-50">إلغاء</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}
