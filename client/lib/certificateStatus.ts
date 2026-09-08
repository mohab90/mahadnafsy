// One reading of a certificate request's status, shared by the dashboard's
// counter and the certificates tab's badge.
//
// Both used to test for 'issued' alone. The table records four states after
// that — SHIPPED, AT_BRANCH, DELIVERED (and IN_PROGRESS / NOT_SENT before it) —
// so a certificate the customer was already holding was not counted among their
// certificates and was labelled «قيد المراجعة» on the page where they track it.

export type CertRequestStatus =
  | 'pending' | 'priced' | 'paid' | 'in_progress' | 'not_sent'
  | 'issued' | 'shipped' | 'at_branch' | 'delivered';

export const CERT_STATUS_META: Record<CertRequestStatus, { label: string; badge: string }> = {
  pending:     { label: '⏳ قيد المراجعة',   badge: 'bg-gray-100 text-gray-600' },
  priced:      { label: '💰 تم التسعير',     badge: 'bg-amber-100 text-amber-700' },
  paid:        { label: '💳 مدفوعة',         badge: 'bg-blue-100 text-blue-700' },
  in_progress: { label: '🏛️ جاري الإصدار',   badge: 'bg-purple-100 text-purple-700' },
  not_sent:    { label: '⏳ في الانتظار',    badge: 'bg-orange-100 text-orange-700' },
  issued:      { label: '✅ صدرت',           badge: 'bg-green-100 text-green-700' },
  shipped:     { label: '🚚 تم الشحن',       badge: 'bg-cyan-100 text-cyan-700' },
  at_branch:   { label: '🏢 جاهزة في الفرع', badge: 'bg-teal-100 text-teal-700' },
  delivered:   { label: '🎓 تم الاستلام',    badge: 'bg-emerald-100 text-emerald-800' },
};

// Issued or further along: the certificate exists and belongs to the customer.
const EARNED = new Set<string>(['issued', 'shipped', 'at_branch', 'delivered']);

export const isCertificateEarned = (status?: string | null): boolean =>
  EARNED.has(String(status || '').toLowerCase());
