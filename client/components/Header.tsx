import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Menu, X, Globe, LogIn, LogOut, User } from 'lucide-react';
import { Currency } from '../types';
import { useSiteData } from '../context/SiteDataContext';
import GlobalSearch from './GlobalSearch';

const FALLBACK_LOGO = 'https://h.top4top.io/p_3734xfq501.png';

const Header: React.FC = () => {
  const { currency, setCurrency, authUser, isAdmin, logout, content } = useSiteData();
  const logoUrl = content['institute.logo'] || FALLBACK_LOGO;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const currencyRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Close currency dropdown when clicking outside
  useEffect(() => {
    if (!currencyOpen) return;
    const handler = (e: MouseEvent) => {
      if (currencyRef.current && !currencyRef.current.contains(e.target as Node)) {
        setCurrencyOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [currencyOpen]);

  const selectCurrency = (c: Currency) => {
    setCurrency(c);
    setCurrencyOpen(false);
  };

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
            {isAdmin && (
            <div className="relative" ref={currencyRef}>
              <button
                onClick={() => setCurrencyOpen(p => !p)}
                className="flex items-center gap-1 text-sm text-gray-600 hover:text-primary-600 border px-3 py-1 rounded-full"
              >
                <Globe size={16} />
                <span>{currency === 'EGP' ? '🇪🇬 مصر' : currency === 'SAR' ? '🇸🇦 السعودية' : '🌐 دولي'}</span>
              </button>
              {currencyOpen && (
                <div className="absolute top-full left-0 mt-1 w-40 bg-white shadow-xl rounded-xl overflow-hidden border border-gray-100 z-50">
                  <button onClick={() => selectCurrency('EGP')} className={`flex items-center gap-2 w-full text-right px-4 py-2.5 hover:bg-gray-50 text-sm ${currency === 'EGP' ? 'bg-primary-50 text-primary-700 font-bold' : ''}`}>🇪🇬 مصر (EGP)</button>
                  <button onClick={() => selectCurrency('SAR')} className={`flex items-center gap-2 w-full text-right px-4 py-2.5 hover:bg-gray-50 text-sm ${currency === 'SAR' ? 'bg-primary-50 text-primary-700 font-bold' : ''}`}>🇸🇦 السعودية (SAR)</button>
                  <button onClick={() => selectCurrency('USD')} className={`flex items-center gap-2 w-full text-right px-4 py-2.5 hover:bg-gray-50 text-sm ${currency === 'USD' ? 'bg-primary-50 text-primary-700 font-bold' : ''}`}>🌐 دولي (USD)</button>
                </div>
              )}
            </div>
            )}

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
              <Link to="/auth" className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded-lg transition text-sm">
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
              <Link to="/auth" className="flex items-center gap-2 py-2 px-2 text-primary-600 font-bold" onClick={() => setIsMenuOpen(false)}>
                <LogIn size={16} /> تسجيل دخول
              </Link>
            )}
            {isAdmin && (
            <div className="flex gap-2 pt-2 border-t">
              <button onClick={() => { selectCurrency('EGP'); setIsMenuOpen(false); }} className={`flex-1 py-2 text-center text-sm rounded ${currency === 'EGP' ? 'bg-primary-100 text-primary-800 font-bold' : 'bg-gray-100'}`}>🇪🇬 مصر</button>
              <button onClick={() => { selectCurrency('SAR'); setIsMenuOpen(false); }} className={`flex-1 py-2 text-center text-sm rounded ${currency === 'SAR' ? 'bg-primary-100 text-primary-800 font-bold' : 'bg-gray-100'}`}>🇸🇦 السعودية</button>
              <button onClick={() => { selectCurrency('USD'); setIsMenuOpen(false); }} className={`flex-1 py-2 text-center text-sm rounded ${currency === 'USD' ? 'bg-primary-100 text-primary-800 font-bold' : 'bg-gray-100'}`}>🌐 دولي</button>
            </div>
            )}
          </nav>
        )}
      </div>
    </header>
  );
};

export default Header;
