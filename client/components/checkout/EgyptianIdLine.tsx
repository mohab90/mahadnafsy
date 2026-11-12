import React from 'react';
import { Loader2 } from 'lucide-react';

interface Props {
  open: boolean;
  value: string;
  /** Set once the server priced the order for an Egyptian: his price, the last three digits of the ID on his record, and whether it came from his account. */
  applied: { price: number; masked: string; auto: boolean } | null;
  message: string;
  loading: boolean;
  currencySymbol: string;
  onOpen: () => void;
  onChange: (value: string) => void;
  onApply: () => void;
  onClear: () => void;
}

/**
 * «مصري؟ اكتب الرقم القومي وخد سعر المصريين» — the one line the Egypt site adds to the checkout while the owner has the two prices on
 * (api/lib/egyptianPricing.js). It takes its own row, so opening the input moves nothing but what is below it.
 */
const EgyptianIdLine: React.FC<Props> = ({ open, value, applied, message, loading, currencySymbol, onOpen, onChange, onApply, onClear }) => (
  <div className="mb-4" data-testid="egyptian-id-line">
    {applied ? (
      <div className="flex items-center justify-between gap-3 rounded-xl bg-green-50 px-3 py-2.5 text-[13px] font-bold text-green-800 ring-1 ring-green-200">
        <span>
          سعر المصري {applied.price} {currencySymbol}
          {applied.auto ? ' — من بيانات حسابك' : applied.masked ? ` — الرقم القومي ${applied.masked}` : ''}
        </span>
        {!applied.auto && <button type="button" onClick={onClear} className="flex-none text-xs font-extrabold text-muted underline">إلغاء</button>}
      </div>
    ) : open ? (
      <div>
        <label htmlFor="egyptian-national-id" className="mb-1 block text-[13px] font-bold text-muted-strong">الرقم القومي (14 رقم)</label>
        <div className="flex gap-2">
          <input id="egyptian-national-id" value={value} dir="ltr" inputMode="numeric" autoComplete="off" maxLength={20}
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onApply(); } }}
            aria-describedby={message ? 'egyptian-national-id-msg' : undefined}
            className="min-h-[46px] min-w-0 flex-1 rounded-xl border border-line-strong bg-paper px-3 font-mono text-[15px] text-ink outline-none focus:border-primary-600 focus:bg-white" />
          <button type="button" onClick={onApply} disabled={!value.trim() || loading}
            className="min-h-[46px] flex-none rounded-xl bg-ink px-4 text-sm font-extrabold text-white disabled:opacity-50">
            {loading ? <Loader2 size={16} className="animate-spin" /> : 'تطبيق'}
          </button>
        </div>
      </div>
    ) : (
      <button type="button" onClick={onOpen} className="min-h-[44px] w-full text-start text-[13px] font-bold text-primary-700 underline">
        مصري؟ اكتب الرقم القومي وخد سعر المصريين
      </button>
    )}
    {message && <p id="egyptian-national-id-msg" role="status" className="mt-1.5 text-xs font-bold text-red-600">{message}</p>}
  </div>
);

export default EgyptianIdLine;
