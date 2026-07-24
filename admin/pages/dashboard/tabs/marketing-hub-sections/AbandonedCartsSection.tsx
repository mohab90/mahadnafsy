import { Receipt, MessageCircle, Mail } from 'lucide-react';
import type { AbandonedCart } from './shared';

interface Props {
  abandonedCarts: AbandonedCart[];
  abandonedLoading: boolean;
}

export function AbandonedCartsSection({ abandonedCarts, abandonedLoading }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-bold text-gray-900 flex items-center gap-2"><Receipt size={18} className="text-rose-500" />السلات المتروكة</h3>
          <p className="text-xs text-gray-500">طلبات بدأت الدفع ولم تُكمل (أقدم من ساعتين، آخر 30 يوم) — تواصل لاستردادها.</p>
        </div>
        <span className="text-sm font-bold text-rose-600 bg-rose-50 px-3 py-1 rounded-full">{abandonedCarts.length} سلة</span>
      </div>
      {abandonedLoading ? (
        <p className="text-sm text-gray-400 py-10 text-center">جارٍ التحميل…</p>
      ) : abandonedCarts.length === 0 ? (
        <p className="text-sm text-gray-400 py-10 text-center">لا توجد سلات متروكة 🎉</p>
      ) : (
        <div className="space-y-2">
          {abandonedCarts.map(c => {
            const phone = (c.customer_phone || '').replace(/\D/g, '');
            const msg = encodeURIComponent(`مرحبًا ${c.customer_name || ''}، لاحظنا أنك بدأت حجز «${c.item_title}» ولم تُكمله. يسعدنا مساعدتك لإتمام التسجيل.`);
            return (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl p-3">
                <div className="min-w-0">
                  <div className="font-bold text-gray-800 text-sm">{c.customer_name || '—'} <span className="text-gray-400 font-normal">• {c.customer_phone || c.customer_email || ''}</span></div>
                  <div className="text-xs text-gray-500">{c.item_title} — {Number(c.amount).toLocaleString()} {c.currency} • {new Date(c.created_at).toLocaleDateString('ar-EG')}</div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {phone && <a href={`https://wa.me/${phone}?text=${msg}`} target="_blank" rel="noopener noreferrer" className="bg-green-500 hover:bg-green-600 text-white rounded-lg px-3 py-1.5 text-xs font-bold flex items-center gap-1"><MessageCircle size={13} />واتساب</a>}
                  {c.customer_email && <a href={`mailto:${c.customer_email}?subject=${encodeURIComponent('أكمل حجزك في المعهد')}&body=${msg}`} className="bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg px-3 py-1.5 text-xs font-bold flex items-center gap-1"><Mail size={13} />إيميل</a>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
