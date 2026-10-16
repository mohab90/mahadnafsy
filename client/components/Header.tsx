import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X, Globe, LogIn, LogOut, User } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';
import GlobalSearch from './GlobalSearch';
import { BRAND_LOGO, logoFallback, useLogoUrl } from '../lib/brand';

const Header: React.FC = () => {
  const { currency, authUser, logout, content } = useSiteData();
  const logoUrl = useLogoUrl(content['institute.logo'], BRAND_LOGO);
  // Signing in should return you to the page you were reading, not the
  // home page. Checkout already passed this; nothing else did.
  const location = useLocation();
  const loginHref = `/auth?redirect=${encodeURIComponent(location.pathname + location.search)}`;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const displayName = authUser?.displayName || authUser?.email?.split('@')[0] || 'مستخدم';

  const here = location.pathname;
  const isActive = (to: string) => (to === '/' ? here === '/' : here === to || here.startsWith(`${to}/`));
  const navClass = (to: string) => `relative py-2 transition hover:text-primary-700 ${isActive(to) ? 'text-primary-700 after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-primary-700' : ''}`;
  const mobileClass = (to: string) => `flex min-h-[48px] items-center rounded-xl px-3 text-base font-bold transition ${isActive(to) ? 'bg-primary-50 text-primary-700' : 'text-ink hover:bg-paper'}`;
  const close = () => setIsMenuOpen(false);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
      <div className="container mx-auto px-4 py-2.5">
        <div className="flex items-center justify-between gap-4">
          {/* Logo */}
          <Link to="/" className="flex flex-none items-center">
            <img src={logoUrl} onError={logoFallback} alt="معهد الدراسات النفسية" width={160} height={48} className="h-11 w-auto object-contain sm:h-12" />
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden items-center gap-5 text-[15px] font-bold text-muted-strong lg:flex xl:gap-7">
            <Link to="/" className={navClass('/')}>الرئيسية</Link>
            <Link to="/about" className={navClass('/about')}>عن المعهد</Link>
            <Link to="/courses" className={navClass('/courses')}>الكورسات</Link>
            <Link to="/bundles" className={navClass('/bundles')}>المسارات والباقات</Link>
            <Link to="/instructors" className={navClass('/instructors')}>الخبراء والمدربين</Link>
            <Link to="/consultations" className={navClass('/consultations')}>استشارات</Link>
            <Link to="/community" className={navClass('/community')}>المجتمع</Link>
          </nav>

          {/* Actions */}
          <div className="hidden items-center gap-2.5 lg:flex">
            <GlobalSearch />
            {/* Not a picker. Pricing currency is decided by the server from the
                visitor's location and cannot be chosen in the browser, so this
                is a label — but bordered, pill-shaped and carrying a globe it
                read as a dropdown, and the tester filed it as one that does not
                open. The tooltip explaining it never appears on touch. */}
            <div
              className="hidden cursor-default select-none items-center gap-1 rounded-md px-2 py-1 text-[13px] text-muted xl:flex"
              title="العملة محددة تلقائيًا حسب موقع الاتصال"
            >
                <Globe size={15} />
                <span>{currency === 'EGP' ? 'مصر (EGP)' : currency === 'SAR' ? 'السعودية (SAR)' : 'دولي (USD)'}</span>
            </div>

            {authUser ? (
              <div className="flex items-center gap-2">
                <Link to="/my-account" className="flex items-center gap-2 rounded-xl bg-paper px-3.5 py-2 text-sm font-bold text-ink ring-1 ring-line transition hover:bg-sand">
                  <User size={16} />
                  <span className="max-w-[120px] truncate">أهلاً، {displayName}</span>
                </Link>
                <button onClick={handleLogout} aria-label="خروج" title="خروج" className="flex h-10 w-10 items-center justify-center rounded-xl text-muted transition hover:bg-paper hover:text-primary-700">
                  <LogOut size={17} />
                </button>
              </div>
            ) : (
              <Link to={loginHref} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold text-ink transition hover:bg-paper">
                <LogIn size={17} />
                <span>دخول</span>
              </Link>
            )}
            <Link to="/enroll" className="inline-flex min-h-[44px] items-center rounded-xl bg-primary-700 px-5 text-sm font-black text-white shadow-[0_10px_24px_-12px_rgba(159,18,57,.9)] transition hover:bg-primary-800">
              احجز مكانك
            </Link>
          </div>

          {/* Mobile: booking stays one tap away, the rest is in the menu */}
          <div className="flex items-center gap-2 lg:hidden">
            <Link to="/enroll" onClick={close} className="inline-flex min-h-[42px] items-center rounded-xl bg-primary-700 px-4 text-sm font-black text-white">احجز مكانك</Link>
            <button
              type="button"
              aria-label={isMenuOpen ? 'إغلاق القائمة' : 'فتح القائمة'}
              aria-expanded={isMenuOpen}
              className="flex h-11 w-11 items-center justify-center rounded-xl text-ink ring-1 ring-line"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
              {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>

        {/* Mobile Nav */}
        {isMenuOpen && (
          <nav className="mt-3 max-h-[calc(100vh-80px)] space-y-1 overflow-y-auto border-t border-line pb-4 pt-3 lg:hidden">
            <div className="px-1 pb-2"><GlobalSearch /></div>
            <Link to="/" className={mobileClass('/')} onClick={close}>الرئيسية</Link>
            <Link to="/about" className={mobileClass('/about')} onClick={close}>عن المعهد</Link>
            <Link to="/courses" className={mobileClass('/courses')} onClick={close}>الكورسات</Link>
            <Link to="/bundles" className={mobileClass('/bundles')} onClick={close}>المسارات والباقات</Link>
            <Link to="/instructors" className={mobileClass('/instructors')} onClick={close}>الخبراء والمدربين</Link>
            <Link to="/consultations" className={mobileClass('/consultations')} onClick={close}>استشارات</Link>
            <Link to="/community" className={mobileClass('/community')} onClick={close}>المجتمع</Link>
            <div className="!mt-3 border-t border-line pt-3">
              {authUser ? (
                <>
                  <Link to="/my-account" className="flex min-h-[48px] items-center gap-2 rounded-xl px-3 font-bold text-primary-700" onClick={close}>
                    <User size={18} /> أهلاً، {displayName}
                  </Link>
                  <button onClick={() => { handleLogout(); close(); }} className="flex min-h-[48px] w-full items-center gap-2 rounded-xl px-3 font-bold text-red-600">
                    <LogOut size={18} /> تسجيل خروج
                  </button>
                </>
              ) : (
                <Link to={loginHref} className="flex min-h-[48px] items-center gap-2 rounded-xl px-3 font-bold text-primary-700" onClick={close}>
                  <LogIn size={18} /> تسجيل دخول
                </Link>
              )}
              <div className="flex items-center gap-2 px-3 pt-2 text-sm text-muted">
                <Globe size={16} />
                <span>العملة حسب موقعك: {currency}</span>
              </div>
            </div>
          </nav>
        )}
      </div>
    </header>
  );
};

export default Header;
