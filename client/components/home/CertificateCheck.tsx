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
    <form onSubmit={go} className="relative mt-8 overflow-hidden rounded-[28px] bg-ink p-5 text-white sm:p-7 lg:mt-10">
      <div aria-hidden="true" className="absolute -left-16 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(closest-side,rgba(227,182,90,.35),transparent)]" />
      <div className="relative flex flex-wrap items-center gap-5 lg:gap-8">
        <div className="flex min-w-[260px] flex-1 items-center gap-4">
          <span className="flex h-14 w-14 flex-none items-center justify-center rounded-[18px] bg-gradient-to-br from-gold-pale to-gold text-ink shadow-lg"><ShieldCheck size={28} /></span>
          <span>
            <b className="mb-0.5 block text-xl sm:text-[22px]">اتأكد من أي شهادة صادرة من المعهد</b>
            <span className="text-[15px] text-white/65">كل شهادة ليها كود خاص. اكتبه وشوف بياناتها في ثواني.</span>
          </span>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2.5 sm:w-auto">
          <label htmlFor="home-cert-code" className="sr-only">كود الشهادة</label>
          <input
            id="home-cert-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\s/g, '').toUpperCase())}
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            placeholder="MAHAD1"
            className="min-h-[52px] w-full min-w-0 rounded-xl border-0 bg-white px-4 text-center font-mono text-lg font-black uppercase tracking-[0.25em] text-gray-900 outline-none placeholder:font-bold placeholder:tracking-[0.25em] placeholder:text-gray-300 focus:ring-4 focus:ring-gold-light/40 sm:w-44"
          />
          <button type="submit" className="min-h-[52px] w-full rounded-xl bg-gold-light px-8 text-base font-black text-ink transition hover:brightness-105 sm:w-auto">تحقق</button>
        </div>
      </div>
    </form>
  );
};

export default CertificateCheck;
