import { useEffect, useMemo, useState } from 'react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { PaymentProof } from '../../../../types';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type ProofFilter = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';

interface UsePaymentProofsReviewArgs {
  notify: NotifyFn;
  reloadSubscribers: () => Promise<void>;
  branchFilter?: string;
}

export function usePaymentProofsReview({
  notify,
  reloadSubscribers,
  branchFilter,
}: UsePaymentProofsReviewArgs) {
  const [allProofs, setAllProofs] = useState<PaymentProof[] | null>(null);
  const [proofsLoading, setProofsLoading] = useState(false);
  const [proofFilter, setProofFilter] = useState<ProofFilter>('PENDING');
  const [reviewingProofId, setReviewingProofId] = useState<string | null>(null);
  const [proofsReviewerNote, setProofsReviewerNote] = useState('');
  const [proofsReviewLoading, setProofsReviewLoading] = useState(false);
  const [proofImages, setProofImages] = useState<Record<string, string>>({});

  const loadAllProofs = async () => {
    setProofsLoading(true);
    try {
      const rows = await mysqlAdmin.listPaymentProofs(undefined, branchFilter) as unknown as PaymentProof[];
      setAllProofs(rows);
    } catch {
      notify('error', 'تعذر تحميل إيصالات الدفع من السيرفر.');
    } finally {
      setProofsLoading(false);
    }
  };

  useEffect(() => {
    loadAllProofs();
  }, [branchFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadProofImg = (id: string) => {
    if (proofImages[id]) return;
    mysqlAdmin.getPaymentProofImage(id, branchFilter).then((result) => {
      if (result.image) setProofImages((previous) => ({ ...previous, [id]: result.image }));
    }).catch(() => notify('error', 'تعذر تحميل صورة الإيصال.'));
  };

  const handleProofReview = async (proofId: string, action: 'approve' | 'reject') => {
    setProofsReviewLoading(true);
    try {
      const result = await mysqlAdmin.reviewPaymentProof(proofId, action, proofsReviewerNote || undefined, branchFilter);
      if (action === 'approve' && !result.pendingSecondApproval) await reloadSubscribers();
      setAllProofs((previous) => previous ? previous.map((proof) => proof.id === proofId ? {
        ...proof,
        status: result.status as PaymentProof['status'],
        ...(result.pendingSecondApproval
          ? {
              first_review_note: proofsReviewerNote || null,
              first_reviewed_at: new Date().toISOString(),
            }
          : {
              reviewer_note: proofsReviewerNote || null,
              reviewed_at: new Date().toISOString(),
            }),
      } : proof) : previous);
      setReviewingProofId(null);
      setProofsReviewerNote('');
      notify('success', result.pendingSecondApproval
        ? 'تم تسجيل الاعتماد الأول؛ العملية الحساسة تنتظر مراجعًا ثانيًا.'
        : action === 'approve' ? 'تم قبول الإيصال وإضافة الدفعة.' : 'تم رفض الإيصال.');
    } catch {
      notify('error', 'حدث خطأ أثناء مراجعة الإيصال.');
    } finally {
      setProofsReviewLoading(false);
    }
  };

  const pendingProofsCount = useMemo(
    () => allProofs ? allProofs.filter((proof) => proof.status === 'PENDING').length : 0,
    [allProofs],
  );

  return {
    allProofs,
    proofsLoading,
    proofFilter,
    setProofFilter,
    reviewingProofId,
    setReviewingProofId,
    proofsReviewerNote,
    setProofsReviewerNote,
    proofsReviewLoading,
    proofImages,
    loadAllProofs,
    loadProofImg,
    handleProofReview,
    pendingProofsCount,
  };
}
