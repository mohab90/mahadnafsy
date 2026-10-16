import React, { useState } from 'react';
import { Facebook, Youtube, Instagram, Mail, Phone, MapPin, MessageCircle, BadgeCheck, Search } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useSiteData } from '../context/SiteDataContext';
import { instituteWhatsApp } from '../lib/whatsappLink';
import { BRAND_LOGO, logoFallback, useLogoUrl } from '../lib/brand';

// «ايقونة البحث عن شهادة يكتب كود الشهادة تفتح توثيقها للعميل»: the code is typed here and the verification
// page opens (pages/CertificateVerify.tsx) — for every certificate the institute issues.
const CertificateCheck: React.FC = () => {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  return (
    <form
      onSubmit={event => { event.preventDefault(); const clean = code.replace(/\s+/g, ''); navigate(clean ? `/certificate/${encodeURIComponent(clean)}` : '/certificate'); }}
      className="mb-10 flex flex-col items-stretch gap-3 rounded-2xl border border-gold-light/30 bg-gradient-to-l from-gold/10 via-white/5 to-primary-500/10 p-4 sm:flex-row sm:items-center"
    >
      <div className="flex items-center gap-3 sm:w-72 sm:shrink-0">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-gold-pale to-gold text-ink shadow-lg"><BadgeCheck size={22} /></span>
        <div>
          <p className="font-extrabold text-white">التحقق من شهادة</p>
          <p className="text-xs text-white/60">اكتب كود الشهادة وتأكد من صحتها</p>
        </div>
      </div>
      <div className="flex flex-1 items-center gap-2 rounded-xl bg-white/[.06] p-1.5 ring-1 ring-white/10 focus-within:ring-2 focus-within:ring-gold-light/70">
        <Search size={17} className="mr-2 shrink-0 text-gold-pale" />
        <input value={code} onChange={event => setCode(event.target.value)} dir="ltr" autoComplete="off" spellCheck={false} aria-label="كود الشهادة"
          placeholder="MAHAD…" className="min-w-0 flex-1 bg-transparent px-1 py-2 text-left font-mono text-sm tracking-wider text-white placeholder:text-white/40 focus:outline-none" />
        <button type="submit" className="shrink-0 rounded-lg bg-gradient-to-l from-gold-light to-gold px-5 py-2 text-sm font-extrabold text-ink transition hover:brightness-110">تحقق</button>
      </div>
    </form>
  );
};

const Footer: React.FC<{ mini?: boolean }> = ({ mini }) => {
  const { content, bundles } = useSiteData();
  const logoUrl = useLogoUrl(content['institute.logo'], BRAND_LOGO);
  const topBundles = bundles.slice(0, 7);

  const phone = content['footer.phone'] || '+20 100 000 0000';
  const email = content['footer.email'] || 'info@psy-institute.com';
  const address = content['footer.address'] || 'القاهرة، مصر الجديدة';
  const facebook = content['footer.facebook'] || '';
  const instagram = content['footer.instagram'] || '';
  const youtube = content['footer.youtube'] || '';
  const whatsapp = instituteWhatsApp(content);
  const description = content['footer.description'] || 'نعمل تحت شعار "رحلة علم ووعي، تغير حياتك للأفضل". نقدم دبلومات معتمدة في الصحة النفسية والعلاج النفسي للمتخصصين وغير المتخصصين.';

  // ── Mini footer (2 lines) — shown in dashboard / payment pages ─────────
  if (mini) {
    // pb-24 on phones: the WhatsApp and «استفسر الآن» buttons are fixed at
    // bottom-6 and 56px tall, so they own the bottom 80px of the viewport.
    // With the old py-3 the copyright line sat 48px underneath them and was
    // unreadable on every page. Restored to the tight spacing from sm up,
    // where the buttons no longer sit over the content column.
    return (
      <footer className="bg-ink border-t border-white/10 pt-3 pb-24 sm:pb-3 text-xs text-white/50 text-center" dir="rtl">
        <p>&copy; {new Date().getFullYear()} معهد الدراسات النفسية — جميع الحقوق محفوظة.</p>
        <p className="mt-1 flex items-center justify-center gap-3 flex-wrap">
          <Link to="/policies" className="hover:text-white/75 transition">سياسات المعهد</Link>
          <span className="opacity-30">|</span>
          <Link to="/contact" className="hover:text-white/75 transition">تواصل معنا</Link>
          <span className="opacity-30">|</span>
          <Link to="/certificate" className="inline-flex items-center gap-1 text-gold-light hover:text-gold-pale transition"><Search size={12} /> التحقق من شهادة</Link>
          {whatsapp && (
            <>
              <span className="opacity-30">|</span>
              <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer" className="text-green-500 hover:text-green-400 transition">واتساب</a>
            </>
          )}
        </p>
      </footer>
    );
  }

  // ── Full footer ────────────────────────────────────────────────────────
  // Same clearance as the mini footer: the two fixed action buttons cover the
  // bottom 80px on a phone, and pb-8 left the copyright line under them.
  return (
    <footer className="bg-ink text-white/75 pt-16 pb-28 sm:pb-8 border-t border-white/10">
      <div className="container mx-auto px-4">
        <CertificateCheck />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          <div>
            <Link to="/">
              <img src={logoUrl} onError={logoFallback} alt="معهد الدراسات النفسية" className="h-14 w-auto object-contain mb-4 rounded-xl bg-white px-3 py-1.5" />
            </Link>
            <p className="text-sm leading-relaxed mb-4 text-white/60">{description}</p>
            <div className="flex gap-3">
              {facebook && <a href={facebook} target="_blank" rel="noreferrer" className="w-9 h-9 rounded-full bg-white/[.06] hover:bg-blue-600 flex items-center justify-center transition"><Facebook size={16} /></a>}
              {instagram && <a href={instagram} target="_blank" rel="noreferrer" className="w-9 h-9 rounded-full bg-white/[.06] hover:bg-pink-600 flex items-center justify-center transition"><Instagram size={16} /></a>}
              {youtube && <a href={youtube} target="_blank" rel="noreferrer" className="w-9 h-9 rounded-full bg-white/[.06] hover:bg-red-600 flex items-center justify-center transition"><Youtube size={16} /></a>}
              {whatsapp && <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer" className="w-9 h-9 rounded-full bg-white/[.06] hover:bg-green-600 flex items-center justify-center transition"><MessageCircle size={16} /></a>}
            </div>
          </div>

          <div>
            <h4 className="text-white font-black mb-5 text-lg">روابط هامة</h4>
            <ul className="space-y-3 text-sm">
              <li><Link to="/courses" className="hover:text-gold-light transition">الدبلومات والبرامج</Link></li>
              <li><Link to="/community" className="hover:text-gold-light transition">المجتمع النفسي</Link></li>
              <li><Link to="/institute-gallery" className="hover:text-gold-light transition">معرض صور المعهد</Link></li>
              <li><Link to="/certificate" className="hover:text-gold-light transition">التحقق من شهادة</Link></li>
              <li><Link to="/policies" className="hover:text-gold-light transition">سياسات المعهد</Link></li>
              <li><Link to="/contact" className="hover:text-gold-light transition">تواصل معنا</Link></li>
              {/* Two separate tracks: /join is the lecturer and consultant one,
                  /join-us is the jobs board. Only the first was in the footer,
                  so the open postings had no route in from any page a visitor
                  is likely to be on. */}
              <li><Link to="/join" className="hover:text-gold-light transition">انضم كمحاضر أو مستشار</Link></li>
              <li><Link to="/join-us" className="hover:text-gold-light transition">الوظائف المتاحة</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-black mb-5 text-lg">المسارات والباقات المتاحة</h4>
            <ul className="space-y-3 text-sm">
              {topBundles.length > 0 ? topBundles.map(b => (
                <li key={b.id}>
                  <Link to={`/bundle/${b.slug || b.id}`} className="hover:text-gold-light transition">{b.title}</Link>
                </li>
              )) : (
                <li><Link to="/bundles" className="hover:text-gold-light transition">استعرض جميع المسارات</Link></li>
              )}
            </ul>
          </div>

          <div>
            <h4 className="text-white font-black mb-5 text-lg">تواصل معنا</h4>
            <p className="text-xs text-white/50 mb-4">نحن هنا للإجابة على استفساراتك. <Link to="/contact" className="text-gold-light hover:underline font-bold">أرسل رسالة</Link> أو <Link to="/join" className="text-gold-pale hover:underline font-bold">انضم لفريقنا</Link>.</p>
            <ul className="space-y-4 text-sm">
              <li className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/[.06] flex items-center justify-center text-gold-light flex-shrink-0"><Phone size={15} /></div>
                <a href={`tel:${phone}`} className="hover:text-gold-light transition">{phone}</a>
              </li>
              <li className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/[.06] flex items-center justify-center text-gold-light flex-shrink-0"><Mail size={15} /></div>
                <a href={`mailto:${email}`} className="hover:text-gold-light transition">{email}</a>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-white/[.06] flex items-center justify-center text-gold-light flex-shrink-0 mt-0.5"><MapPin size={15} /></div>
                <span>{address}</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/10 pt-8 text-center text-sm text-white/50">
          <p>&copy; {new Date().getFullYear()} معهد الدراسات النفسية. جميع الحقوق محفوظة.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
