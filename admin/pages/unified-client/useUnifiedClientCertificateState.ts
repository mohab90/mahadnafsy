import { useState } from 'react';

import type { ExtraCertificateType } from '../../types';

export type ExtraCertificateDraft = {
  courseId: string;
  type: ExtraCertificateType | '';
  certExpected: string;
  certPaid: string;
};

export const createExtraCertificateDraft = (): ExtraCertificateDraft => ({
  courseId: '',
  type: '',
  certExpected: '',
  certPaid: '',
});

export const useUnifiedClientCertificateState = () => {
  const [viewCertId, setViewCertId] = useState<string | null>(null);
  const [showExtraCertForm, setShowExtraCertForm] = useState(false);
  const [extraCertDraft, setExtraCertDraft] = useState<ExtraCertificateDraft>(createExtraCertificateDraft());

  const resetExtraCertDraft = () => setExtraCertDraft(createExtraCertificateDraft());

  return {
    viewCertId,
    setViewCertId,
    showExtraCertForm,
    setShowExtraCertForm,
    extraCertDraft,
    setExtraCertDraft,
    resetExtraCertDraft,
  };
};
