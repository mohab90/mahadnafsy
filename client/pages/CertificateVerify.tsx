import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BadgeCheck, Clock3, Fingerprint, GraduationCap, Hourglass, Landmark, Search, ShieldAlert, ShieldX, Sparkles } from 'lucide-react';
import QRCode from 'qrcode';
import { CAIRO_TIME_ZONE } from '../../shared/cairoDate';
import { setCanonical } from '../lib/useSeo';

// «التحقق من شهادة» — the public page the footer's search and every certificate's QR open.
// It covers every certificate the system issues (api/lib/certificateVerification.js): the
// institute's own course certificates and the ones arranged with other bodies, each by its code.

type Verified = {
  kind: 'course' | 'external';
  code: string;
  state: 'valid' | 'pending' | 'revoked';
  statusText?: string | null;
  holderAr: string; holderEn: string;
  title: string; titleEn?: string | null;
  subjectAr: string; subjectEn: string;
  hours: number | null;
  issuedAt: string | null;
  issuer: string;
};
type Outcome = { type: 'found'; cert: Verified } | { type: 'revoked'; cert?: Verified } | { type: 'missing' } | { type: 'error' };

const API_BASE = import.meta.env.VITE_API_URL || '/api';
async function lookup(code: string): Promise<Outcome> {
  try {
    const response = await fetch(`${API_BASE}/certificates/verify/${encodeURIComponent(code)}`, { credentials: 'omit' });
    if (response.status === 404) return { type: 'missing' };
    const body = await response.json().catch(() => null) as Verified | null;
    if (response.status === 410) return { type: 'revoked', cert: body && body.code ? body : undefined };
    if (!response.ok || !body) return { type: 'error' };
    return { type: 'found', cert: body };
  } catch { return { type: 'error' }; }
}

const STYLES = `
@keyframes cv-rise { from { opacity: 0; transform: translateY(22px) scale(.98) } to { opacity: 1; transform: none } }
@keyframes cv-spin { to { transform: rotate(360deg) } }
@keyframes cv-pulse { 0%,100% { box-shadow: 0 0 0 0 var(--cv-glow) } 50% { box-shadow: 0 0 0 18px transparent } }
@keyframes cv-sheen { 0% { background-position: -160% 0 } 100% { background-position: 260% 0 } }
@keyframes cv-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-8px) } }
.cv-card { animation: cv-rise .7s cubic-bezier(.2,.8,.2,1) both }
.cv-seal-ring { animation: cv-spin 22s linear infinite }
.cv-seal { animation: cv-pulse 2.6s ease-out infinite, cv-float 5s ease-in-out infinite }
.cv-sheen { background-image: linear-gradient(110deg, transparent 30%, rgba(255,255,255,.55) 50%, transparent 70%); background-size: 220% 100%; animation: cv-sheen 4.5s ease-in-out infinite }
.cv-stub { -webkit-mask: radial-gradient(circle 9px at 0 50%, transparent 98%, #000) left / 51% 100% no-repeat, radial-gradient(circle 9px at 100% 50%, transparent 98%, #000) right / 51% 100% no-repeat; mask: radial-gradient(circle 9px at 0 50%, transparent 98%, #000) left / 51% 100% no-repeat, radial-gradient(circle 9px at 100% 50%, transparent 98%, #000) right / 51% 100% no-repeat }
@media (prefers-reduced-motion: reduce) { .cv-card,.cv-seal-ring,.cv-seal,.cv-sheen { animation: none !important } }
`;

const TONES = {
  valid: { glow: 'rgba(16,185,129,.45)', ring: 'from-amber-300 via-yellow-200 to-amber-500', seal: 'from-emerald-400 to-emerald-600', label: 'شهادة موثّقة', sub: 'VERIFIED · الشهادة صادرة فعلاً عن المعهد', badge: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/40' },
  pending: { glow: 'rgba(245,158,11,.45)', ring: 'from-amber-200 via-amber-400 to-orange-500', seal: 'from-amber-400 to-orange-500', label: 'الشهادة لسه قيد الإصدار', sub: 'PENDING · الكود صحيح لكن الشهادة لم تصدر بعد', badge: 'bg-amber-500/15 text-amber-200 ring-amber-400/40' },
  revoked: { glow: 'rgba(239,68,68,.45)', ring: 'from-red-300 via-rose-400 to-red-600', seal: 'from-rose-500 to-red-700', label: 'الشهادة ملغاة', sub: 'REVOKED · لم تعد صالحة للتحقق', badge: 'bg-red-500/15 text-red-200 ring-red-400/40' },
} as const;

const dayText = (iso: string | null) => (iso
  ? new Date(iso).toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric', timeZone: CAIRO_TIME_ZONE })
  : '—');

function SearchBox({ initial, onSearch, busy }: { initial: string; onSearch: (code: string) => void; busy?: boolean }) {
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [initial]);
  return (
    <form onSubmit={event => { event.preventDefault(); if (value.trim()) onSearch(value.trim()); }}
      className="mx-auto flex w-full max-w-xl items-center gap-2 rounded-2xl bg-white/10 p-1.5 ring-1 ring-white/20 backdrop-blur focus-within:ring-2 focus-within:ring-amber-300/70">
      <Search size={18} className="mr-3 shrink-0 text-amber-200" />
      <input value={value} onChange={event => setValue(event.target.value)} dir="ltr" autoComplete="off" spellCheck={false}
        placeholder="اكتب كود الشهادة — CERT-… أو PSY-C-…" aria-label="كود الشهادة"
        className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-left font-mono text-sm tracking-wider text-white placeholder:text-white/40 focus:outline-none" />
      <button type="submit" disabled={busy || !value.trim()}
        className="shrink-0 rounded-xl bg-gradient-to-l from-amber-400 to-amber-500 px-5 py-2.5 text-sm font-extrabold text-gray-900 shadow-lg transition hover:brightness-110 disabled:opacity-50">
        {busy ? '…' : 'تحقق'}
      </button>
    </form>
  );
}

function Field({ label, value, sub, ltr }: { label: string; value: string; sub?: string; ltr?: boolean }) {
  if (!value) return null;
  return (
    <div className="border-b border-dashed border-amber-900/15 pb-3 last:border-0 last:pb-0">
      <p className="text-[11px] font-bold tracking-wide text-amber-800/70">{label}</p>
      <p className={`mt-0.5 text-lg font-extrabold leading-snug text-gray-900 ${ltr ? 'text-left' : ''}`} dir={ltr ? 'ltr' : undefined}>{value}</p>
      {sub && <p className="text-sm font-semibold text-gray-500" dir="ltr" style={{ textAlign: 'left' }}>{sub}</p>}
    </div>
  );
}

function CertificateCard({ cert }: { cert: Verified }) {
  const tone = TONES[cert.state];
  const [qr, setQr] = useState('');
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(`${window.location.origin}/certificate/${encodeURIComponent(cert.code)}`, { width: 140, margin: 1, color: { dark: '#4c0519', light: '#fffaf0' } })
      .then(url => { if (!cancelled) setQr(url); }).catch(() => {});
    return () => { cancelled = true; };
  }, [cert.code]);
  const Icon = cert.state === 'valid' ? BadgeCheck : cert.state === 'pending' ? Hourglass : ShieldAlert;
  const KindIcon = cert.kind === 'course' ? GraduationCap : Landmark;

  return (
    <div className="cv-card mx-auto w-full max-w-2xl" style={{ ['--cv-glow' as string]: tone.glow }}>
      {/* The gold frame: a gradient border around the card. */}
      <div className={`relative rounded-[28px] bg-gradient-to-br ${tone.ring} p-[3px] shadow-[0_30px_80px_-20px_rgba(0,0,0,.7)]`}>
        <div className="relative overflow-hidden rounded-[25px] bg-[#fffaf0]">
          <div className="cv-sheen pointer-events-none absolute inset-0 opacity-60" />
          <div className="pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full bg-amber-200/40 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -right-10 h-60 w-60 rounded-full bg-rose-200/40 blur-3xl" />

          {/* The seal */}
          <div className="relative flex flex-col items-center px-6 pb-2 pt-10 text-center">
            <div className="relative h-28 w-28">
              <svg viewBox="0 0 120 120" className="cv-seal-ring absolute inset-0 h-full w-full" aria-hidden="true">
                <defs><path id="cv-circle" d="M60,60 m-47,0 a47,47 0 1,1 94,0 a47,47 0 1,1 -94,0" /></defs>
                <circle cx="60" cy="60" r="57" fill="none" stroke="#d97706" strokeWidth="1.2" strokeDasharray="2 4" />
                <text fontSize="9.5" fontWeight="800" letterSpacing="3.2" fill="#9a3412"><textPath href="#cv-circle">INSTITUTE OF PSYCHOLOGICAL STUDIES ✦ CERTIFIED ✦ </textPath></text>
              </svg>
              <div className={`cv-seal absolute inset-4 grid place-items-center rounded-full bg-gradient-to-br ${tone.seal} text-white shadow-xl ring-4 ring-white/80`}>
                <Icon size={38} strokeWidth={2.2} />
              </div>
            </div>
            <h1 className="mt-5 text-2xl font-black text-gray-900 sm:text-3xl">{tone.label}</h1>
            <p className="mt-1 text-[11px] font-bold tracking-[.18em] text-amber-800/80" dir="ltr">{tone.sub}</p>
            {cert.state === 'pending' && cert.statusText && (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-extrabold text-amber-800"><Clock3 size={13} /> {cert.statusText}</p>
            )}
          </div>

          {/* The certificate's facts */}
          <div className="relative mx-6 mt-4 space-y-3 rounded-2xl border border-amber-900/10 bg-white/70 p-5 text-right backdrop-blur-sm sm:mx-10">
            <div className="mb-1 flex items-center justify-center gap-2 text-sm font-extrabold text-primary-700">
              <KindIcon size={16} /> {cert.title}
              {cert.titleEn && <span className="font-serif text-xs font-semibold text-gray-500" dir="ltr">· {cert.titleEn}</span>}
            </div>
            <Field label="اسم المتدرب" value={cert.holderAr} sub={cert.holderEn} />
            {!cert.holderAr && cert.holderEn && <Field label="Trainee" value={cert.holderEn} ltr />}
            <Field label={cert.kind === 'course' ? 'الكورس' : 'الكورس / المجال'} value={cert.subjectAr} sub={cert.subjectEn} />
            {cert.hours ? <Field label="عدد الساعات التدريبية" value={`${cert.hours} ساعة`} /> : null}
            <Field label={cert.state === 'valid' ? 'تاريخ الإصدار' : 'تاريخ الإصدار المتوقع'} value={cert.state === 'valid' ? dayText(cert.issuedAt) : ''} />
            <Field label="الجهة المُصدِرة" value={cert.issuer} />
          </div>

          {/* The code: a ticket stub with its QR */}
          <div className="cv-stub relative mx-4 mb-6 mt-6 flex items-center gap-4 rounded-2xl bg-gradient-to-l from-amber-100 to-orange-50 p-4 ring-1 ring-amber-900/10 sm:mx-8">
            {qr && <img src={qr} alt="QR" className="h-20 w-20 shrink-0 rounded-lg bg-white p-1 shadow" />}
            <div className="min-w-0 flex-1 text-right">
              <p className="flex items-center gap-1 text-[11px] font-bold text-amber-800/80"><Fingerprint size={13} /> كود الشهادة</p>
              <p className="mt-1 break-all font-mono text-lg font-black tracking-widest text-gray-900" dir="ltr" style={{ textAlign: 'left' }}>{cert.code}</p>
              <p className="mt-1 text-[11px] text-gray-500">امسح الـQR أو اكتب الكود في «التحقق من شهادة» لتتأكد في أي وقت.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Message({ kind }: { kind: 'missing' | 'revoked' | 'error' | 'idle' }) {
  const cfg = {
    missing: { icon: ShieldX, title: 'مفيش شهادة بالكود ده', text: 'راجع الكود حرف بحرف (من غير مسافات)، أو اتأكد إن الشهادة اتصدرت من المعهد. لو الكود صح وبرضه مش بيظهر كلّمنا.', tone: 'from-rose-500 to-red-700' },
    revoked: { icon: ShieldAlert, title: 'الشهادة ملغاة', text: 'الإدارة ألغت صلاحية الشهادة دي ومبقتش صالحة للتحقق.', tone: 'from-rose-500 to-red-700' },
    error: { icon: ShieldAlert, title: 'تعذر التحقق دلوقتي', text: 'حصلت مشكلة في الاتصال. جرّب تاني بعد لحظات.', tone: 'from-slate-500 to-slate-700' },
    idle: { icon: Sparkles, title: 'تحقق من أي شهادة صادرة من المعهد', text: 'اكتب كود الشهادة المطبوع عليها (تحت اسم الكورس) وهتظهر لك بياناتها الموثّقة: شهادات الكورسات وشهادات الجهات المعتمدة.', tone: 'from-amber-400 to-orange-600' },
  }[kind];
  const Icon = cfg.icon;
  return (
    <div className="cv-card mx-auto max-w-lg rounded-3xl bg-white/10 p-8 text-center text-white ring-1 ring-white/15 backdrop-blur">
      <div className={`mx-auto grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br ${cfg.tone} shadow-xl ring-4 ring-white/20`}><Icon size={36} /></div>
      <h2 className="mt-5 text-2xl font-black">{cfg.title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-white/70">{cfg.text}</p>
    </div>
  );
}

const CertificateVerify: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.title = 'التحقق من شهادة | معهد الدراسات النفسية';
    // Without this the canonical stays on whichever page loaded first.
    setCanonical('/certificate');
  }, []);

  useEffect(() => {
    if (!code) { setOutcome(null); return undefined; }
    let cancelled = false;
    setLoading(true);
    lookup(code).then(result => { if (!cancelled) setOutcome(result); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [code]);

  const content = useMemo(() => {
    if (!code) return <Message kind="idle" />;
    if (!outcome || loading) return <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-amber-300 border-t-transparent" aria-label="جاري التحقق" />;
    if (outcome.type === 'found') return <CertificateCard cert={outcome.cert} />;
    if (outcome.type === 'revoked') return outcome.cert ? <CertificateCard cert={{ ...outcome.cert, state: 'revoked' }} /> : <Message kind="revoked" />;
    return <Message kind={outcome.type} />;
  }, [code, outcome, loading]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#12060a] px-4 py-12 sm:py-16" dir="rtl">
      <style>{STYLES}</style>
      {/* Atmosphere: a crimson glow, a gold one, and a fine grid. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(190,18,60,.45),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(217,119,6,.28),transparent_50%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:44px_44px]" />
      <div className="relative mx-auto max-w-3xl space-y-8">
        <header className="text-center text-white">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1 text-xs font-bold tracking-widest text-amber-200 ring-1 ring-white/15" dir="ltr"><BadgeCheck size={14} /> CERTIFICATE VERIFICATION</p>
          <h1 className="mt-4 text-3xl font-black sm:text-4xl">التحقق من <span className="bg-gradient-to-l from-amber-200 to-amber-400 bg-clip-text text-transparent">شهادة</span></h1>
          <p className="mt-2 text-sm text-white/60">معهد الدراسات النفسية</p>
        </header>
        <SearchBox initial={code || ''} busy={loading} onSearch={next => navigate(`/certificate/${encodeURIComponent(next.replace(/\s+/g, ''))}`)} />
        {content}
      </div>
    </div>
  );
};

export default CertificateVerify;
