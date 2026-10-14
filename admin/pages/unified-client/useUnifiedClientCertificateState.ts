import { useState } from 'react';

// A certificate is requested from «حجز ودفع» only — the owner, 7 Oct 2026. The
// profile's own «طلب شهادة» form is gone, and its draft with it.
//
// «بيانات الشهادة» (13 Oct 2026) opens from the client's quick actions for whoever
// may (`allowed`): the English name, the national id and each course's dates.
export const useUnifiedClientCertificateState = (options?: {
  allowed: boolean;
  subscriberId?: string;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
  onSaved: () => void | Promise<unknown>;
}) => {
  const [viewCertId, setViewCertId] = useState<string | null>(null);
  const [dataOpen, setDataOpen] = useState(false);
  const certificateDataModal = dataOpen && options?.subscriberId ? {
    subscriberId: options.subscriberId, notify: options.notify, onClose: () => setDataOpen(false),
    onSaved: () => { setDataOpen(false); void options.onSaved(); },
  } : undefined;
  const openCertificateData = options?.allowed && options.subscriberId ? () => setDataOpen(true) : undefined;
  return { viewCertId, setViewCertId, certificateDataModal, openCertificateData };
};
