import { useEffect, useState } from 'react';

import { mysqlAdmin } from '../../lib/mysqlapi';
import type { PaymentProof, SubscriberItem } from '../../types';

type ReviewAction = 'approve' | 'reject';

type UseUnifiedClientPaymentProofsArgs = {
  isSubscriber: boolean;
  subscriber?: SubscriberItem;
  reloadSubscribers: () => Promise<void>;
};

export function useUnifiedClientPaymentProofs({
  isSubscriber,
  subscriber,
  reloadSubscribers,
}: UseUnifiedClientPaymentProofsArgs) {
  const [clientProofs, setClientProofs] = useState<PaymentProof[]>([]);
  const [clientProofsLoaded, setClientProofsLoaded] = useState(false);
  const [reviewingProofId, setReviewingProofId] = useState<string | null>(null);
  const [reviewerNote, setReviewerNote] = useState('');
  const [proofImageUrl, setProofImageUrl] = useState<Record<string, string>>({});
  const [reviewLoading, setReviewLoading] = useState(false);

  const loadClientProofs = () => {
    if (!subscriber) return;
    mysqlAdmin.listPaymentProofs()
      .then(rows => {
        const filtered = (rows as unknown as PaymentProof[])
          .filter(proof => proof.subscriber_id === subscriber.id);
        setClientProofs(filtered);
        setClientProofsLoaded(true);
      })
      .catch(() => setClientProofsLoaded(true));
  };

  useEffect(() => {
    if (isSubscriber && !clientProofsLoaded) loadClientProofs();
    // Keep the previous single-page auto-load behavior without refetching on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubscriber]);

  const loadProofImage = (proofId: string) => {
    if (proofImageUrl[proofId]) return;
    mysqlAdmin.getPaymentProofImage(proofId)
      .then(response => {
        if (response.image) {
          setProofImageUrl(prev => ({ ...prev, [proofId]: response.image }));
        }
      })
      .catch(() => {});
  };

  const handleReviewProof = async (proofId: string, action: ReviewAction) => {
    setReviewLoading(true);
    try {
      await mysqlAdmin.reviewPaymentProof(proofId, action, reviewerNote || undefined);
      if (action === 'approve') await reloadSubscribers();

      setClientProofs(prev => prev.map(proof => proof.id === proofId
        ? {
          ...proof,
          status: action === 'approve' ? 'APPROVED' : 'REJECTED',
          reviewer_note: reviewerNote || null,
          reviewed_at: new Date().toISOString(),
        }
        : proof));
      setReviewingProofId(null);
      setReviewerNote('');
    } catch {
      // The legacy page kept proof review failures silent; preserve UX until a toast path is added.
    } finally {
      setReviewLoading(false);
    }
  };

  return {
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
  };
}
