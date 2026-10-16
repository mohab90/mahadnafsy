import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';

/**
 * «اتأكد من أي شهادة صادرة من المعهد» — sits right under the reasons to choose
 * the institute, because a verifiable certificate is the strongest of them. It
 * opens the public verification page (/certificate/:code) the footer search and
 * every certificate's QR already use.
 */
const CertificateCheck: React.FC = () => {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const go = (event: React.FormEvent) => {
    event.preventDefault();
    const clean = code.trim();
    navigate(clean ? `/certificate/${encodeURIComponent(clean)}` : '/certificate');
  };
  return (
    <form onSubmit={go} className="relative mt-6 flex flex-wrap items-center gap-5 overflow-hidden rounded-[28px] bg-[#1b0a12] p-5 text-white sm:p-8 lg:gap-8">
      <div aria-hidden="true" className="absolute -left-16 -top-16 h-52 w-52 rounded-full bg-primary-600 opacity-30" />
      <div className="relative flex min-w-[260px] flex-1 items-center gap-4">
        <span className="flex h-14 w-14 flex-none items-center justify-center rounded-[18px] bg-secondary-500 text-[#1b0a12]"><ShieldCheck size={28} /></span>
        <span>
          <b className="mb-0.5 block text-xl sm:text-[23px]">اتأكد من أي شهادة صادرة من المعهد</b>
          <span className="text-[15px] text-white/70">اكتب كود الشهادة وتحقق منها في ثواني.</span>
        </span>
      </div>
      <div className="relative flex min-w-[260px] flex-[1.2] flex-wrap gap-2.5">
        <label htmlFor="home-cert-code" className="sr-only">كود الشهادة</label>
        <input
          id="home-cert-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          dir="ltr"
          placeholder="كود الشهادة"
          className="min-h-[48px] min-w-0 flex-[1_1_180px] rounded-xl border-0 bg-white px-4 text-right text-base text-gray-900 outline-none focus:ring-4 focus:ring-primary-500/30"
        />
        <button type="submit" className="min-h-[48px] flex-[1_1_auto] rounded-xl bg-secondary-500 px-8 text-base font-black text-[#1b0a12] transition hover:brightness-105">تحقق</button>
      </div>
    </form>
  );
};

export default CertificateCheck;
