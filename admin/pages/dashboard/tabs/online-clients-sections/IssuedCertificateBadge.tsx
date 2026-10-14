import type { SubscriberCertificate } from '../../../../types';
import { cairoDay } from '../../../../../shared/cairoDate';

/**
 * The institute's certificate on the clients table. It read «🎓 MHAD-MG3K…-9F2A1C04»
 * beside an orange «جزئي» — the course's money, not the certificate — and a
 * revoked one looked issued. Now: what it is, issued or revoked, and the code on
 * hover. One still owed money says so, since it is issued at 90% paid.
 */
export function IssuedCertificateBadge({ cert, owes = false }: { cert: SubscriberCertificate; owes?: boolean }) {
  const revoked = cert.status === 'revoked';
  const title = [`كود الشهادة: ${cert.certificateNumber}`, cert.issuedAt ? `اتصدرت ${cairoDay(cert.issuedAt)}` : '', revoked && cert.revokeReason ? `اتلغت: ${cert.revokeReason}` : '']
    .filter(Boolean).join('\n');
  return (
    <span title={title} className="inline-flex flex-col items-center gap-0.5">
      <span className={`inline-flex items-center gap-0.5 whitespace-nowrap rounded-lg border px-1.5 py-0.5 text-[9px] font-bold ${revoked
        ? 'border-gray-200 bg-gray-50 text-gray-400 line-through'
        : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
        🎓 شهادة المعهد · {revoked ? 'اتلغت' : 'صادرة'}
      </span>
      {!revoked && owes && <span className="text-[9px] font-bold text-orange-600">لسه عليه باقي الكورس</span>}
    </span>
  );
}
