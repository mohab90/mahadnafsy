import type { PaymentDraft } from '../components/PaymentModal';

export type PhotoNeed = 'required' | 'optional';

const isDocumentation = (text: string) => /توثيق|document|attest/i.test(text);
const isBoard = (text: string) => /بورد|board/i.test(text);

/**
 * What a draft asks for. «شهادة البورد لازم صورة، والكارنيه لازم صورة، واي توثيق
 * لازم صورة الهوية» — required; any other certificate has the space, optional.
 * `labelOf` names a certificate type as the catalogue does.
 */
export function photoNeeds(draft: Pick<PaymentDraft, 'paymentType' | 'certType' | 'extraItems'>, labelOf: (type?: string | null) => string): { personal: PhotoNeed | null; id: PhotoNeed | null } {
  let personal: PhotoNeed | null = null;
  let id: PhotoNeed | null = null;
  const rows = [
    { type: draft.paymentType, certType: draft.certType },
    ...(draft.extraItems || []).filter(item => Number(item.amount) > 0).map(item => ({ type: item.type, certType: item.certType })),
  ];
  for (const row of rows) {
    if (row.type === 'carneh') personal = 'required';
    if (row.type !== 'certificate') continue;
    const text = `${row.certType || ''} ${labelOf(row.certType)}`;
    if (isDocumentation(text)) id = 'required';
    else if (isBoard(text)) personal = 'required';
    else personal ||= 'optional';
  }
  return { personal, id };
}
