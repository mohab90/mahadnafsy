import { useState } from 'react';

// A certificate is requested from «حجز ودفع» only — the owner, 7 Oct 2026. The
// profile's own «طلب شهادة» form is gone, and its draft with it.
export const useUnifiedClientCertificateState = () => {
  const [viewCertId, setViewCertId] = useState<string | null>(null);
  return { viewCertId, setViewCertId };
};
