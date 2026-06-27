import { useState, useEffect } from 'react';
import { useSiteData } from '../../context/SiteDataContext';
import { mysqlAdmin } from '../../lib/mysqlapi';
import type { SubscriberItem, PaymentProof } from '../../types';

/**
 * Client-uploaded payment receipts ("proofs"): list/auto-load on mount, lazy
 * image fetch, and the approve/reject review flow (approval also posts the
 * payment into the subscriber's history so it shows in Finance). Extracted
 * verbatim from UnifiedClientPage; returns identical names so render is unchanged.
 *
 * Called at the same component position so the internal hook order
 * (6× useState then the mount useEffect) is preserved.
 */
export function useClientProofs(subscriber: SubscriberItem | undefined, isSub: boolean) {
  const { updateSubscriber } = useSiteData();
  const [clientProofs, setClientProofs] = useState<PaymentProof[]>([]);
  const [clientProofsLoaded, setClientProofsLoaded] = useState(false);
  const [reviewingProofId, setReviewingProofId] = useState<string | null>(null);
  const [reviewerNote, setReviewerNote] = useState('');
  const [proofImageUrl, setProofImageUrl] = useState<Record<string, string>>({});
  const [reviewLoading, setReviewLoading] = useState(false);

  const loadClientProofs = () => {
    if (!subscriber) return;
    mysqlAdmin.listPaymentProofs().then(rows => {
      const filtered = (rows as unknown as PaymentProof[]).filter(p => p.subscriber_id === subscriber.id);
      setClientProofs(filtered);
      setClientProofsLoaded(true);
    }).catch(() => setClientProofsLoaded(true));
  };

  // Auto-load payment proofs on mount (single-page view)
  useEffect(() => {
    if (isSub && !clientProofsLoaded) loadClientProofs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSub]);

  const loadProofImage = (proofId: string) => {
    if (proofImageUrl[proofId]) return;
    mysqlAdmin.getPaymentProofImage(proofId).then(r => {
      if (r.image) setProofImageUrl(prev => ({ ...prev, [proofId]: r.image }));
    }).catch(() => {});
  };

  const handleReviewProof = async (proofId: string, action: 'approve' | 'reject') => {
    setReviewLoading(true);
    try {
      await mysqlAdmin.reviewPaymentProof(proofId, action, reviewerNote || undefined);
      // On approval: add the payment to subscriber's paymentHistory so it appears in Finance
      if (action === 'approve' && subscriber) {
        const proof = clientProofs.find(p => p.id === proofId);
        if (proof) {
          const payEntry = {
            id: `proof-${proofId}`,
            amount: proof.amount,
            currency: proof.currency,
            paymentType: 'course' as const,
            isInstallment: true,
            courseId: proof.course_id ?? undefined,
            paymentMethod: proof.payment_method,
            note: `إيصال معتمد${reviewerNote ? ' | ' + reviewerNote : ''}`,
            at: new Date().toISOString().slice(0, 10),
          };
          const updatedSub = { ...subscriber, paymentHistory: [...(subscriber.paymentHistory ?? []), payEntry] };
          updateSubscriber(updatedSub);
          void mysqlAdmin.saveSubscriberPayment(subscriber.id, payEntry as unknown as Record<string, unknown>).catch(() => {});
        }
      }
      setClientProofs(prev => prev.map(p => p.id === proofId ? {
        ...p,
        status: action === 'approve' ? 'APPROVED' : 'REJECTED',
        reviewer_note: reviewerNote || null,
        reviewed_at: new Date().toISOString(),
      } : p));
      setReviewingProofId(null);
      setReviewerNote('');
    } catch { /* ignore */ } finally { setReviewLoading(false); }
  };

  return {
    clientProofs, setClientProofs, clientProofsLoaded, setClientProofsLoaded,
    reviewingProofId, setReviewingProofId, reviewerNote, setReviewerNote,
    proofImageUrl, setProofImageUrl, reviewLoading, setReviewLoading,
    loadClientProofs, loadProofImage, handleReviewProof,
  };
}
