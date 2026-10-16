import React from 'react';
import { Link } from 'react-router-dom';
import { X, Gift } from 'lucide-react';
import { Modal } from '../../../shared/ui/Modal';
import type { Bundle, Currency } from '../../types';
import { cdnImg } from '../../lib/img';
import { formatPrice } from '../../../shared/priceFormat';

interface CourseUpsellModalProps {
  courseTitle: string;
  completionCert: string | null;
  relatedBundles: Bundle[];
  currency: Currency;
  onClose: () => void;
}

export const CourseUpsellModal: React.FC<CourseUpsellModalProps> = ({ courseTitle, completionCert, relatedBundles, currency, onClose }) => {
  return (
    // hideClose + bodyClassName="p-0": this is a celebration, not a form. Its
    // gradient header runs edge to edge and carries its own ×, so Modal supplies
    // the shell — Escape, focus, the backdrop, the layer — and nothing else.
    // It was on z-[200], a level invented for this one dialog.
    <Modal open onClose={onClose} hideClose bodyClassName="p-0" layer="over">
        {/* Header */}
        <div className="relative bg-gradient-to-br from-primary-700 via-primary-800 to-[#4c0519] p-6 text-center text-white">
          <button onClick={onClose} aria-label="إغلاق" className="absolute left-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-white/15 transition hover:bg-white/30"><X size={16} /></button>
          <div className="text-5xl mb-2">🎓</div>
          <h2 className="text-xl font-black">مبروك! أتممت الكورس</h2>
          <p className="mt-1 text-sm text-white/70">{courseTitle}</p>
        </div>
        <div className="p-5 sm:p-6">
          {completionCert && (
            <div className="mb-4 rounded-2xl bg-paper p-4 text-center ring-1 ring-line">
              <p className="mb-1 text-xs font-bold text-gold-deep">كود شهادتك الرقمية</p>
              <p className="font-mono text-lg font-extrabold tracking-wider text-ink">{completionCert}</p>
              <p className="mt-1 text-xs text-muted-soft">احتفظ بهذا الكود للتحقق من الشهادة</p>
            </div>
          )}
          {relatedBundles.length > 0 ? (
            <>
              <p className="mb-3 flex items-center gap-2 font-bold text-ink"><Gift size={16} className="text-primary-700" /> ارتقِ بمهاراتك — باقات تشمل هذا الكورس:</p>
              <div className="space-y-3">
                {relatedBundles.slice(0, 2).map(b => (
                  <div key={b.id} className="flex items-center gap-3 rounded-2xl border border-line p-3 transition hover:border-ink/30">
                    <img loading="lazy" decoding="async" src={cdnImg(b.thumbnail, 160)} alt="" width={56} height={48} className="h-12 w-14 flex-shrink-0 rounded-xl bg-sand object-cover" />
                    <div className="flex-1 min-w-0">
                      <p className="line-clamp-1 text-sm font-extrabold text-ink">{b.title}</p>
                      <p className="text-sm font-black tabular-nums text-ink">{formatPrice(b.price?.[currency], currency)}</p>
                    </div>
                    <Link to={`/bundle/${b.id}`} onClick={onClose} className="inline-flex min-h-[44px] flex-shrink-0 items-center rounded-xl bg-primary-700 px-4 text-sm font-black text-white transition hover:bg-primary-800">
                      عرض
                    </Link>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="py-2 text-center text-sm text-muted">استمر في تعلمك وتطوير مهاراتك!</p>
          )}
          <button onClick={onClose} className="mt-4 min-h-[48px] w-full rounded-2xl border-[1.5px] border-ink/15 text-sm font-extrabold text-ink transition hover:border-ink/40">
            إغلاق
          </button>
        </div>
    </Modal>
  );
};
