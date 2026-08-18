import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X, Globe, LogIn, LogOut, User } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';
import GlobalSearch from './GlobalSearch';

const FALLBACK_LOGO = 'https://h.top4top.io/p_3734xfq501.png';

const Header: React.FC = () => {
  const { currency, authUser, logout, content } = useSiteData();
  const logoUrl = content['institute.logo'] || FALLBACK_LOGO;
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

  return (
    <header className="bg-white shadow-md sticky top-0 z-50">
      <div className="container mx-auto px-4 py-3">
        <div className="flex justify-between items-center">
          {/* Logo */}
          <Link to="/" className="flex items-center">
            <img src={logoUrl} alt="معهد الدراسات النفسية" className="h-14 w-auto object-contain" />
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-6 text-gray-700 font-medium text-sm">
            <Link to="/" className="hover:text-primary-600 transition">الرئيسية</Link>
            <Link to="/about" className="hover:text-primary-600 transition">عن المعهد</Link>
            <Link to="/courses" className="hover:text-primary-600 transition">الكورسات</Link>
            <Link to="/bundles" className="hover:text-primary-600 transition">المسارات والباقات</Link>
            <Link to="/instructors" className="hover:text-primary-600 transition">الخبراء والمدربين</Link>
            <Link to="/consultations" className="hover:text-primary-600 transition">استشارات</Link>
            <Link to="/community" className="hover:text-primary-600 transition">المجتمع</Link>
          </nav>

          {/* Actions */}
          <div className="hidden lg:flex items-center gap-4">
            <GlobalSearch />
            {/* Not a picker. Pricing currency is decided by the server from the
                visitor's location and cannot be chosen in the browser, so this
                is a label — but bordered, pill-shaped and carrying a globe it
                read as a dropdown, and the tester filed it as one that does not
                open. The tooltip explaining it never appears on touch. */}
            <div
              className="flex items-center gap-1 text-sm text-gray-500 bg-gray-50 px-3 py-1 rounded-md cursor-default select-none"
              title="العملة محددة تلقائيًا حسب موقع الاتصال"
            >
                <Globe size={16} />
                <span>{currency === 'EGP' ? 'مصر (EGP)' : currency === 'SAR' ? 'السعودية (SAR)' : 'دولي (USD)'}</span>
            </div>

            {authUser ? (
              <div className="flex items-center gap-2">
                <Link to="/my-account" className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded-lg transition text-sm">
                  <User size={16} />
                  <span>أهلاً، {displayName}</span>
                </Link>
                <button onClick={handleLogout} className="flex items-center gap-1 bg-primary-600 hover:bg-primary-700 text-white px-3 py-2 rounded-lg transition text-sm">
                  <LogOut size={15} />
                  <span>خروج</span>
                </button>
              </div>
            ) : (
              <Link to={loginHref} className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded-lg transition text-sm">
                <LogIn size={18} />
                <span>دخول</span>
              </Link>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button className="lg:hidden text-gray-700" onClick={() => setIsMenuOpen(!isMenuOpen)}>
            {isMenuOpen ? <X size={28} /> : <Menu size={28} />}
          </button>
        </div>

        {/* Mobile Nav */}
        {isMenuOpen && (
          <nav className="lg:hidden mt-4 pb-4 border-t pt-4 space-y-3">
            <div className="px-2"><GlobalSearch /></div>
            <Link to="/" className="block py-2 px-2 hover:bg-gray-50 rounded" onClick={() => setIsMenuOpen(false)}>الرئيسية</Link>
            <Link to="/about" className="block py-2 px-2 hover:bg-gray-50 rounded" onClick={() => setIsMenuOpen(false)}>عن المعهد</Link>
            <Link to="/courses" className="block py-2 px-2 hover:bg-gray-50 rounded" onClick={() => setIsMenuOpen(false)}>الكورسات</Link>
            <Link to="/bundles" className="block py-2 px-2 hover:bg-gray-50 rounded" onClick={() => setIsMenuOpen(false)}>المسارات والباقات</Link>
            <Link to="/instructors" className="block py-2 px-2 hover:bg-gray-50 rounded" onClick={() => setIsMenuOpen(false)}>الخبراء والمدربين</Link>
            <Link to="/consultations" className="block py-2 px-2 hover:bg-gray-50 rounded" onClick={() => setIsMenuOpen(false)}>استشارات</Link>
            <Link to="/community" className="block py-2 px-2 hover:bg-gray-50 rounded" onClick={() => setIsMenuOpen(false)}>المجتمع</Link>
            {authUser ? (
              <>
                <Link to="/my-account" className="flex items-center gap-2 py-2 px-2 text-primary-600 font-bold" onClick={() => setIsMenuOpen(false)}>
                  <User size={16} /> أهلاً، {displayName}
                </Link>
                <button onClick={() => { handleLogout(); setIsMenuOpen(false); }} className="flex items-center gap-2 py-2 px-2 text-red-600 font-bold w-full">
                  <LogOut size={16} /> تسجيل خروج
                </button>
              </>
            ) : (
              <Link to={loginHref} className="flex items-center gap-2 py-2 px-2 text-primary-600 font-bold" onClick={() => setIsMenuOpen(false)}>
                <LogIn size={16} /> تسجيل دخول
              </Link>
            )}
            <div className="flex items-center gap-2 pt-3 border-t text-sm text-gray-600">
              <Globe size={16} />
              <span>العملة حسب موقعك: {currency}</span>
            </div>
          </nav>
        )}
      </div>
    </header>
  );
};

export default Header;
