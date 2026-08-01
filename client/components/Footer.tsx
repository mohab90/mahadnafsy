import React from 'react';
import { Facebook, Youtube, Instagram, Mail, Phone, MapPin, MessageCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSiteData } from '../context/SiteDataContext';
import { toDialable } from '../lib/whatsappLink';

const Footer: React.FC<{ mini?: boolean }> = ({ mini }) => {
  const { content, bundles } = useSiteData();
  const topBundles = bundles.slice(0, 7);

  const phone = content['footer.phone'] || '+20 100 000 0000';
  const email = content['footer.email'] || 'info@psy-institute.com';
  const address = content['footer.address'] || 'القاهرة، مصر الجديدة';
  const facebook = content['footer.facebook'] || '';
  const instagram = content['footer.instagram'] || '';
  const youtube = content['footer.youtube'] || '';
  const whatsapp = content['footer.whatsapp'] || '';
  const description = content['footer.description'] || 'نعمل تحت شعار "رحلة علم ووعي، تغير حياتك للأفضل". نقدم دبلومات معتمدة في الصحة النفسية والعلاج النفسي للمتخصصين وغير المتخصصين.';

  // ── Mini footer (2 lines) — shown in dashboard / payment pages ─────────
  if (mini) {
    return (
      <footer className="bg-gray-900 border-t border-gray-800 py-3 text-xs text-gray-500 text-center" dir="rtl">
        <p>&copy; {new Date().getFullYear()} معهد الدراسات النفسية — جميع الحقوق محفوظة.</p>
        <p className="mt-1 flex items-center justify-center gap-3 flex-wrap">
          <Link to="/policies" className="hover:text-gray-300 transition">سياسات المعهد</Link>
          <span className="opacity-30">|</span>
          <Link to="/contact" className="hover:text-gray-300 transition">تواصل معنا</Link>
          {whatsapp && (
            <>
              <span className="opacity-30">|</span>
              <a href={`https://wa.me/${toDialable(whatsapp)}`} target="_blank" rel="noreferrer" className="text-green-500 hover:text-green-400 transition">واتساب</a>
            </>
          )}
        </p>
      </footer>
    );
  }

  // ── Full footer ────────────────────────────────────────────────────────
  return (
    <footer className="bg-gray-900 text-gray-300 pt-16 pb-8 border-t border-gray-800">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          <div>
            <Link to="/">
              <img src={content['institute.logo'] || 'https://h.top4top.io/p_3734xfq501.png'} alt="معهد الدراسات النفسية" className="h-16 w-auto object-contain mb-4" />
            </Link>
            <p className="text-sm leading-relaxed mb-4 text-gray-400">{description}</p>
            <div className="flex gap-3">
              {facebook && <a href={facebook} target="_blank" rel="noreferrer" className="w-9 h-9 rounded-full bg-gray-800 hover:bg-blue-600 flex items-center justify-center transition"><Facebook size={16} /></a>}
              {instagram && <a href={instagram} target="_blank" rel="noreferrer" className="w-9 h-9 rounded-full bg-gray-800 hover:bg-pink-600 flex items-center justify-center transition"><Instagram size={16} /></a>}
              {youtube && <a href={youtube} target="_blank" rel="noreferrer" className="w-9 h-9 rounded-full bg-gray-800 hover:bg-red-600 flex items-center justify-center transition"><Youtube size={16} /></a>}
              {whatsapp && <a href={`https://wa.me/${toDialable(whatsapp)}`} target="_blank" rel="noreferrer" className="w-9 h-9 rounded-full bg-gray-800 hover:bg-green-600 flex items-center justify-center transition"><MessageCircle size={16} /></a>}
            </div>
          </div>

          <div>
            <h4 className="text-white font-bold mb-6 text-lg">روابط هامة</h4>
            <ul className="space-y-3 text-sm">
              <li><Link to="/courses" className="hover:text-primary-500 transition">الدبلومات والبرامج</Link></li>
              <li><Link to="/community" className="hover:text-primary-500 transition">المجتمع النفسي</Link></li>
              <li><Link to="/institute-gallery" className="hover:text-primary-500 transition">معرض صور المعهد</Link></li>
              <li><Link to="/policies" className="hover:text-primary-500 transition">سياسات المعهد</Link></li>
              <li><Link to="/contact" className="hover:text-primary-500 transition">تواصل معنا</Link></li>
              <li><Link to="/join" className="hover:text-primary-500 transition">انضم إلينا</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-bold mb-6 text-lg">المسارات والباقات المتاحة</h4>
            <ul className="space-y-3 text-sm">
              {topBundles.length > 0 ? topBundles.map(b => (
                <li key={b.id}>
                  <Link to={`/bundle/${b.slug || b.id}`} className="hover:text-primary-500 transition">{b.title}</Link>
                </li>
              )) : (
                <li><Link to="/bundles" className="hover:text-primary-500 transition">استعرض جميع المسارات</Link></li>
              )}
            </ul>
          </div>

          <div>
            <h4 className="text-white font-bold mb-6 text-lg">تواصل معنا</h4>
            <p className="text-xs text-gray-500 mb-4">نحن هنا للإجابة على استفساراتك. <Link to="/contact" className="text-primary-400 hover:underline font-bold">أرسل رسالة</Link> أو <Link to="/join" className="text-secondary-400 hover:underline font-bold">انضم لفريقنا</Link>.</p>
            <ul className="space-y-4 text-sm">
              <li className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-primary-500 flex-shrink-0"><Phone size={15} /></div>
                <a href={`tel:${phone}`} className="hover:text-primary-400 transition">{phone}</a>
              </li>
              <li className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-primary-500 flex-shrink-0"><Mail size={15} /></div>
                <a href={`mailto:${email}`} className="hover:text-primary-400 transition">{email}</a>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-primary-500 flex-shrink-0 mt-0.5"><MapPin size={15} /></div>
                <span>{address}</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-800 pt-8 text-center text-sm text-gray-500">
          <p>&copy; {new Date().getFullYear()} معهد الدراسات النفسية. جميع الحقوق محفوظة.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
