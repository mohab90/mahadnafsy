import { useEffect, useMemo, useState } from 'react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { PaymentProof, StaffMember, SubscriberItem } from '../../../../types';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type ProofFilter = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';

interface UsePaymentProofsReviewArgs {
  authUserEmail?: string | null;
  notify: NotifyFn;
  staffMembers: StaffMember[];
  subscribers: SubscriberItem[];
  updateSubscriber: (subscriber: SubscriberItem) => void | Promise<void>;
}

export function usePaymentProofsReview({
  authUserEmail,
  notify,
  staffMembers,
  subscribers,
  updateSubscriber,
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
      const rows = await mysqlAdmin.listPaymentProofs() as unknown as PaymentProof[];
      setAllProofs(rows);
    } catch {
      /* keep existing silent load behavior */
    } finally {
      setProofsLoading(false);
    }
  };

  useEffect(() => {
    loadAllProofs();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadProofImg = (id: string) => {
    if (proofImages[id]) return;
    mysqlAdmin.getPaymentProofImage(id).then((result) => {
      if (result.image) setProofImages((previous) => ({ ...previous, [id]: result.image }));
    }).catch(() => {});
  };

  const handleProofReview = async (proofId: string, action: 'approve' | 'reject') => {
    setProofsReviewLoading(true);
    try {
      await mysqlAdmin.reviewPaymentProof(proofId, action, proofsReviewerNote || undefined);
      if (action === 'approve' && allProofs) {
        const proof = allProofs.find((item) => item.id === proofId);
        const subscriber = proof ? subscribers.find((item) => item.id === proof.subscriber_id) : null;
        if (proof && subscriber) {
          const reviewerName = staffMembers.find((staff) => staff.email === authUserEmail)?.name || 'الإدارة';
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
          const alreadyAdded = (subscriber.paymentHistory ?? []).some((payment) => payment.id === `proof-${proofId}`);
          if (!alreadyAdded) {
            updateSubscriber({ ...subscriber, paymentHistory: [...(subscriber.paymentHistory ?? []), payEntry] });
          }
        }
      }
      setAllProofs((previous) => previous ? previous.map((proof) => proof.id === proofId ? {
        ...proof,
        status: action === 'approve' ? 'APPROVED' : 'REJECTED',
        reviewer_note: proofsReviewerNote || null,
        reviewed_at: new Date().toISOString(),
      } : proof) : previous);
      setReviewingProofId(null);
      setProofsReviewerNote('');
      notify('success', action === 'approve' ? 'تم قبول الإيصال وإضافة الدفعة.' : 'تم رفض الإيصال.');
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
