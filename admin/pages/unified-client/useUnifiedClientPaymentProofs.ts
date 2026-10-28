import { useEffect, useState } from 'react';
import { askRejectionReason } from '../../lib/rejectionReason';
import { arabicReason } from '../../lib/apiErrorText';

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

  // Once per client opened. Keyed on isSubscriber alone it never asked again when the page moved to another client
  // (the route keeps this page mounted), so client B showed client A's transfer proofs.
  const subscriberId = subscriber?.id;
  useEffect(() => {
    setClientProofs([]);
    setClientProofsLoaded(false);
    if (!isSubscriber || !subscriberId) return undefined;
    let alive = true;
    mysqlAdmin.listPaymentProofs()
      .then(rows => {
        if (!alive) return;
        setClientProofs((rows as unknown as PaymentProof[]).filter(proof => proof.subscriber_id === subscriberId));
        setClientProofsLoaded(true);
      })
      .catch(() => { if (alive) setClientProofsLoaded(true); });
    return () => { alive = false; };
  }, [isSubscriber, subscriberId]);

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
    // A rejected receipt is explained: the note on the screen, else asked for here.
    let note = reviewerNote.trim();
    if (action === 'reject' && note.length < 3) {
      const reason = await askRejectionReason('الإيصال');
      if (reason === null) return;
      note = reason;
    }
    setReviewLoading(true);
    try {
      await mysqlAdmin.reviewPaymentProof(proofId, action, note || undefined);
      if (action === 'approve') await reloadSubscribers();

      setClientProofs(prev => prev.map(proof => proof.id === proofId
        ? {
          ...proof,
          status: action === 'approve' ? 'APPROVED' : 'REJECTED',
          reviewer_note: note || null,
          reviewed_at: new Date().toISOString(),
        }
        : proof));
      setReviewingProofId(null);
      setReviewerNote('');
    } catch (error) {
      // No longer silent: a refused review says why (a rejection without a reason, a scope, a second reviewer).
      window.dispatchEvent(new CustomEvent('site-persist-error', { detail: { field: 'paymentProof', name: proofId, reason: arabicReason(error) } }));
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
