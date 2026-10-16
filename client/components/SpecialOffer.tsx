import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Check, Clock, Copy, Sparkles, X } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';
import { useEscapeKey } from '../../shared/ui/useEscapeKey';
import {
  popupFrequency, popupIsLive, popupTheme, popupWasSeen, type PopupTheme,
} from '../../shared/siteOffers';

/**
 * The pop-up marketing sets in التسويق ← الخصومات: one discount, put in front
 * of everyone who opens the site. What it says, the discount, the code, the
 * course it points to, how long it runs and how often a visitor sees it are
 * all theirs (see shared/siteOffers). Staff never see it on the live site —
 * `?previewPopup=1` shows it to them on purpose, which is what the
 * «معاينة» button in the admin opens.
 */
const THEMES: Record<PopupTheme, { bg: string; glow: string; accent: string; ink: string }> = {
  royal:   { bg: 'linear-gradient(135deg,#1e1b4b 0%,#4338ca 55%,#7c3aed 100%)', glow: '#a78bfa', accent: '#fbbf24', ink: '#1e1b4b' },
  sunset:  { bg: 'linear-gradient(135deg,#7f1d1d 0%,#dc2626 50%,#f59e0b 100%)', glow: '#fca5a5', accent: '#fde68a', ink: '#7f1d1d' },
  emerald: { bg: 'linear-gradient(135deg,#064e3b 0%,#059669 55%,#14b8a6 100%)', glow: '#6ee7b7', accent: '#fde047', ink: '#064e3b' },
};

const SEEN_KEY = 'mahad.offer.seen';
const PATHS_WITHOUT_POPUP = ['/checkout', '/payment', '/auth', '/pay', '/certificate'];

const readSeen = (frequency: string) => {
  try {
    const raw = (frequency === 'session' ? sessionStorage : localStorage).getItem(SEEN_KEY);
    return raw ? (JSON.parse(raw) as { at: number; version: string }) : null;
  } catch { return null; }
};
const writeSeen = (frequency: string, version: string) => {
  try {
    (frequency === 'session' ? sessionStorage : localStorage).setItem(SEEN_KEY, JSON.stringify({ at: Date.now(), version }));
  } catch { /* private window: it simply shows again next time */ }
};

const SpecialOffer: React.FC = () => {
  const { content, courses, currency, isAdmin, isStaff } = useSiteData();
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const preview = /[?&]previewPopup=1\b/.test(search);
  const frequency = popupFrequency(content);
  const version = String(content['popup.version'] || '');
  const live = popupIsLive(content);
  const blockedPath = PATHS_WITHOUT_POPUP.some(prefix => pathname.startsWith(prefix));
  const allowed = live && !blockedPath && (preview || (!isAdmin && !isStaff));
  const delayMs = Math.min(60, Math.max(0, Number(content['popup.delaySeconds']) || 3)) * 1000;

  useEffect(() => {
    if (!allowed) { setOpen(false); return undefined; }
    if (!preview && popupWasSeen(content, readSeen(frequency))) return undefined;
    const id = setTimeout(() => {
      setOpen(true);
      if (!preview) writeSeen(frequency, version);
    }, preview ? 300 : delayMs);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, preview, frequency, version, delayMs]);

  const endsAt = content['popup.endsAt'] ? new Date(content['popup.endsAt']).getTime() : NaN;
  const hasEnd = Number.isFinite(endsAt);
  useEffect(() => {
    if (!open || !hasEnd) return undefined;
    const id = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 1000);
    return () => clearInterval(id);
  }, [open, hasEnd]);

  useEscapeKey(() => setOpen(false), open);

  const course = useMemo(() => courses.find(c => c.id === content['popup.courseId']) || null, [courses, content]);
  if (!open || !allowed) return null;

  const theme = THEMES[popupTheme(content)];
  const pct = Math.min(99, Math.max(0, Number(content['popup.discountPercent']) || 0));
  const code = String(content['popup.code'] || '').trim();
  const sym = currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : '$';
  const coursePrice = course ? Number(course.price?.[currency]) || 0 : 0;
  const prices = course && pct && coursePrice > 0 ? { oldPrice: coursePrice, newPrice: Math.round(coursePrice * (1 - pct / 100)) } : null;
  const cta = String(content['popup.ctaText'] || '').trim() || (course ? 'احجز الآن بالخصم' : 'استفد بالعرض');
  const link = String(content['popup.ctaLink'] || '').trim();
  const to = course ? `/course/${course.id}` : link || '/courses';
  const external = !course && /^https?:\/\//i.test(link);
  const left = hasEnd ? Math.max(0, endsAt - now) : null;
  const clock = left === null ? null : {
    d: Math.floor(left / 86400000),
    h: Math.floor((left % 86400000) / 3600000),
    m: Math.floor((left % 3600000) / 60000),
    s: Math.floor((left % 60000) / 1000),
  };

  const close = () => setOpen(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  };

  const ctaClass = 'block w-full text-center font-extrabold text-base rounded-2xl py-3.5 shadow-xl transition hover:scale-[1.02] active:scale-95';
  const ctaStyle = { background: theme.accent, color: theme.ink } as const;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true"
      aria-label={content['popup.title'] || 'عرض خاص'} dir="rtl">
      <button type="button" aria-label="إغلاق" onClick={close}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-default" tabIndex={-1} />
      <div className="relative w-full max-w-md rounded-[28px] overflow-hidden shadow-[0_30px_80px_-10px_rgba(0,0,0,.6)] text-white animate-[offerRise_.45s_cubic-bezier(.2,.9,.3,1.2)]"
        style={{ background: theme.bg }}>
        <style>{'@keyframes offerRise{from{opacity:0;transform:translateY(24px) scale(.92)}to{opacity:1;transform:none}}@keyframes offerShine{0%{transform:translateX(-120%) skewX(-20deg)}100%{transform:translateX(320%) skewX(-20deg)}}'}</style>
        <div className="absolute -top-20 -left-20 w-64 h-64 rounded-full opacity-30 blur-3xl" style={{ background: theme.glow }} />
        <div className="absolute -bottom-24 -right-16 w-72 h-72 rounded-full opacity-25 blur-3xl" style={{ background: theme.accent }} />
        <button type="button" onClick={close} aria-label="إغلاق العرض" autoFocus
          className="absolute top-3 left-3 z-10 w-9 h-9 rounded-full bg-white/15 hover:bg-white/30 flex items-center justify-center transition">
          <X size={18} />
        </button>

        <div className="relative px-7 pt-9 pb-7 text-center">
          <div className="inline-flex items-center gap-1.5 bg-white/15 border border-white/25 rounded-full px-3.5 py-1 text-xs font-bold mb-5">
            <Sparkles size={13} style={{ color: theme.accent }} /> عرض خاص لزوار الموقع
          </div>

          {pct > 0 && (
            <div className="relative mx-auto mb-5 w-36 h-36 rounded-full flex flex-col items-center justify-center overflow-hidden"
              style={{ background: 'radial-gradient(circle at 30% 25%,#fff 0%,' + theme.accent + ' 45%,' + theme.accent + 'cc 100%)', color: theme.ink, boxShadow: '0 0 0 6px rgba(255,255,255,.18),0 0 50px ' + theme.accent + '88' }}>
              <span className="absolute inset-y-0 w-10 bg-white/50" style={{ animation: 'offerShine 2.8s ease-in-out infinite' }} />
              <span className="relative text-5xl font-black leading-none tabular-nums">{pct}%</span>
              <span className="relative text-sm font-extrabold mt-1">خصم</span>
            </div>
          )}

          {content['popup.title'] && <h2 className="text-2xl font-black leading-snug mb-2">{content['popup.title']}</h2>}
          {content['popup.body'] && <p className="text-white/85 text-sm leading-6 mb-4 whitespace-pre-line">{content['popup.body']}</p>}

          {course && (
            <div className="rounded-2xl bg-white/12 border border-white/20 px-4 py-3 mb-4">
              <p className="text-xs text-white/70 mb-0.5">على كورس</p>
              <p className="font-bold text-sm">{course.title}</p>
              {prices && (
                <p className="mt-1.5 flex items-center justify-center gap-3">
                  <span className="line-through text-white/55">{prices.oldPrice} {sym}</span>
                  <span className="text-2xl font-black" style={{ color: theme.accent }}>{prices.newPrice} {sym}</span>
                </p>
              )}
            </div>
          )}

          {code && (
            <button type="button" onClick={() => void copy()}
              className="w-full mb-4 flex items-center justify-between gap-3 rounded-2xl border-2 border-dashed border-white/50 bg-white/10 hover:bg-white/20 px-4 py-2.5 transition">
              <span className="text-xs text-white/75">كود الخصم</span>
              <span className="font-mono text-xl font-black tracking-[.2em]" style={{ color: theme.accent }}>{code}</span>
              <span className="text-xs flex items-center gap-1 font-bold">{copied ? <><Check size={14} /> تم النسخ</> : <><Copy size={14} /> نسخ</>}</span>
            </button>
          )}

          {clock && left !== null && left > 0 && (
            <div className="mb-4">
              <p className="text-xs text-white/75 mb-2 flex items-center justify-center gap-1"><Clock size={12} /> ينتهي العرض بعد</p>
              <div className="flex justify-center gap-2" dir="ltr">
                {[
                  ...(clock.d > 0 ? [{ v: clock.d, l: 'يوم' }] : []),
                  { v: clock.h, l: 'ساعة' }, { v: clock.m, l: 'دقيقة' }, { v: clock.s, l: 'ثانية' },
                ].map(unit => (
                  <div key={unit.l} className="w-16 rounded-xl bg-black/25 border border-white/15 py-1.5">
                    <div className="text-xl font-black font-mono tabular-nums">{String(unit.v).padStart(2, '0')}</div>
                    <div className="text-[10px] text-white/70">{unit.l}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {external
            ? <a href={to} target="_blank" rel="noopener noreferrer" onClick={close} className={ctaClass} style={ctaStyle}>{cta}</a>
            : <Link to={to} onClick={close} className={ctaClass} style={ctaStyle}>{cta}</Link>}
          <button type="button" onClick={close} className="mt-3 text-xs text-white/60 hover:text-white transition">لا شكراً، ربما لاحقاً</button>
        </div>
      </div>
    </div>
  );
};

export default SpecialOffer;
