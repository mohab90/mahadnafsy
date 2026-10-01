// The name cell of the clients table: display name, phone, and status badge.
//
// The table renders rows two ways — flat, and grouped with a rowSpan — and this
// was written out in full for both, identical down to the badge maps. A label
// changed in one layout would have been wrong in the other.

import type { SubscriberItem } from '../../../../types';
import { waLink } from '../../../../lib/whatsappLink';

export default function ClientNameCell({ row, clientCode, navigate, onCall }: {
  row: SubscriberItem;
  clientCode: string;
  navigate: (to: string) => void;
  /** The call is also the place to log it: the dialer opens, and so does «تواصل». */
  onCall?: () => void;
}) {
  return (
    <div className="min-w-0">
      {(() => {
        const isEnglish = /^[a-zA-Z\s]+$/.test(row.name.trim());
        const displayName = isEnglish ? row.name.trim().split(/\s+/).slice(0,2).join(' ') : row.name;
        return <button onClick={()=>navigate(`/client/${clientCode}`)} className="font-bold text-gray-800 hover:text-primary-700 text-[11px] block truncate max-w-[110px]" dir={isEnglish?'ltr':'rtl'}>{displayName}</button>;
      })()}
      <a href={`tel:${row.phone}`} onClick={onCall} className="text-xs font-semibold text-blue-600">{row.phone}</a>
      {/* No payment is taken for a client who cannot be reached (the server
          refuses it), so the number to fix is shown before anyone tries. */}
      {!waLink(row.phone) && (
        <span className="block text-[9px] font-bold text-red-600" title="عدّل الرقم قبل تسجيل أي دفعة">⚠ بدون رقم صالح</span>
      )}
      {row.clientStatus && row.clientStatus !== 'active' && (() => {
        const csBadge: Record<string,string> = {finished:'bg-green-100 text-green-700',paused:'bg-amber-100 text-amber-700',refunded:'bg-red-100 text-red-700',refund_pending:'bg-orange-100 text-orange-700',leads:'bg-purple-100 text-purple-700'};
        const csLabel: Record<string,string> = {finished:'✅ منتهي',paused:'⏸ متوقف',refunded:'↩️ مسترد',refund_pending:'⏳ استرداد معلق',leads:'👥 محتمل'};
        return <span className={`inline-block mt-0.5 text-[9px] font-bold rounded-full px-1.5 py-0.5 ${csBadge[row.clientStatus]||'bg-gray-100 text-gray-500'}`}>{csLabel[row.clientStatus]||row.clientStatus}</span>;
      })()}
    </div>
  );
}
