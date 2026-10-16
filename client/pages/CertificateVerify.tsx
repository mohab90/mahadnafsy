import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BadgeCheck, Clock3, Fingerprint, GraduationCap, Hourglass, Landmark, Search, ShieldAlert, ShieldX, Sparkles } from 'lucide-react';
import QRCode from 'qrcode';
import { CAIRO_TIME_ZONE } from '../../shared/cairoDate';
import { setCanonical } from '../lib/useSeo';
import PageHeader from '../components/PageHeader';

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

// Only a gentle rise when the result appears, and the ticket-stub notches. No
// looping motion: this page is read by an employer checking a document.
const STYLES = `
@keyframes cv-rise { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
.cv-card { animation: cv-rise .5s cubic-bezier(.2,.8,.2,1) both }
.cv-stub { -webkit-mask: radial-gradient(circle 9px at 0 50%, transparent 98%, #000) left / 51% 100% no-repeat, radial-gradient(circle 9px at 100% 50%, transparent 98%, #000) right / 51% 100% no-repeat; mask: radial-gradient(circle 9px at 0 50%, transparent 98%, #000) left / 51% 100% no-repeat, radial-gradient(circle 9px at 100% 50%, transparent 98%, #000) right / 51% 100% no-repeat }
@media (prefers-reduced-motion: reduce) { .cv-card { animation: none !important } }
`;

const TONES = {
  valid: { bar: 'bg-green-600', seal: 'bg-green-600 text-white', ring: 'ring-green-100', chip: 'bg-green-50 text-green-700 ring-green-200', label: 'شهادة موثّقة', sub: 'VERIFIED · الشهادة صادرة فعلاً عن المعهد' },
  pending: { bar: 'bg-gold', seal: 'bg-gold-light text-ink', ring: 'ring-gold-pale/40', chip: 'bg-paper text-gold-deep ring-line', label: 'الشهادة لسه قيد الإصدار', sub: 'PENDING · الكود صحيح لكن الشهادة لم تصدر بعد' },
  revoked: { bar: 'bg-red-600', seal: 'bg-red-600 text-white', ring: 'ring-red-100', chip: 'bg-red-50 text-red-700 ring-red-200', label: 'الشهادة ملغاة', sub: 'REVOKED · لم تعد صالحة للتحقق' },
} as const;

const dayText = (iso: string | null) => (iso
  ? new Date(iso).toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric', timeZone: CAIRO_TIME_ZONE })
  : '—');

function SearchBox({ initial, onSearch, busy }: { initial: string; onSearch: (code: string) => void; busy?: boolean }) {
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [initial]);
  return (
    <form onSubmit={event => { event.preventDefault(); if (value.trim()) onSearch(value.trim()); }}
      className="mx-auto flex w-full max-w-xl items-center gap-2 rounded-2xl border border-line-strong bg-white p-1.5 shadow-[0_20px_40px_-30px_rgba(26,15,18,.4)] transition focus-within:border-primary-600 focus-within:ring-4 focus-within:ring-primary-600/10">
      <Search size={18} className="mr-2 shrink-0 text-muted-soft" />
      <input value={value} onChange={event => setValue(event.target.value)} dir="ltr" autoComplete="off" spellCheck={false}
        placeholder="اكتب كود الشهادة، مثل MAHAD…" aria-label="كود الشهادة"
        className="min-h-[44px] min-w-0 flex-1 bg-transparent px-2 text-left font-mono text-[15px] tracking-wider text-ink outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-muted-faint" />
      <button type="submit" disabled={busy || !value.trim()}
        className="inline-flex min-h-[46px] shrink-0 items-center justify-center rounded-xl bg-primary-700 px-5 font-black text-white transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-50 sm:px-7">
        {busy ? '…' : 'تحقق'}
      </button>
    </form>
  );
}

function Field({ label, value, sub, ltr }: { label: string; value: string; sub?: string; ltr?: boolean }) {
  if (!value) return null;
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <p className="text-[12px] font-bold text-muted">{label}</p>
      <p className={`mt-0.5 break-words text-lg font-black leading-snug text-ink ${ltr ? 'text-left' : ''}`} dir={ltr ? 'ltr' : undefined}>{value}</p>
      {sub && <p className="break-words text-sm font-semibold text-muted-body" dir="ltr" style={{ textAlign: 'left' }}>{sub}</p>}
    </div>
  );
}

function CertificateCard({ cert }: { cert: Verified }) {
  const tone = TONES[cert.state];
  const [qr, setQr] = useState('');
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(`${window.location.origin}/certificate/${encodeURIComponent(cert.code)}`, { width: 140, margin: 1, color: { dark: '#4c0519', light: '#ffffff' } })
      .then(url => { if (!cancelled) setQr(url); }).catch(() => {});
    return () => { cancelled = true; };
  }, [cert.code]);
  const Icon = cert.state === 'valid' ? BadgeCheck : cert.state === 'pending' ? Hourglass : ShieldAlert;
  const KindIcon = cert.kind === 'course' ? GraduationCap : Landmark;

  return (
    <div className="cv-card mx-auto w-full max-w-2xl">
      <div className="overflow-hidden rounded-[32px] bg-white shadow-[0_40px_80px_-45px_rgba(26,15,18,.5)] ring-1 ring-line">
        {/* The state, at a glance, before anything is read. */}
        <div className={`h-1.5 ${tone.bar}`} />
        {/* A double rule, the way a printed certificate is framed. */}
        <div className="m-2.5 rounded-[26px] border border-gold/40 p-1 sm:m-4">
          <div className="rounded-[22px] border border-line px-4 pb-5 pt-8 sm:px-8 sm:pb-7">

            {/* The seal */}
            <div className="flex flex-col items-center text-center">
              <div className="relative h-28 w-28">
                <svg viewBox="0 0 120 120" className="absolute inset-0 h-full w-full" aria-hidden="true">
                  <defs><path id="cv-circle" d="M60,60 m-47,0 a47,47 0 1,1 94,0 a47,47 0 1,1 -94,0" /></defs>
                  <circle cx="60" cy="60" r="57" fill="none" className="stroke-gold" strokeWidth="1.2" strokeDasharray="2 4" />
                  <text fontSize="9.5" fontWeight="800" letterSpacing="3.2" className="fill-gold-deep"><textPath href="#cv-circle">INSTITUTE OF PSYCHOLOGICAL STUDIES ✦ CERTIFIED ✦ </textPath></text>
                </svg>
                <div className={`absolute inset-4 grid place-items-center rounded-full ${tone.seal} shadow-[0_14px_30px_-12px_rgba(26,15,18,.45)] ring-4 ${tone.ring}`}>
                  <Icon size={38} strokeWidth={2.2} />
                </div>
              </div>
              <h2 className="mt-5 text-2xl font-black leading-tight text-ink sm:text-3xl">{tone.label}</h2>
              <p className={`mt-2 inline-block max-w-full rounded-full px-3 py-1 text-[11px] font-extrabold tracking-[.12em] ring-1 ${tone.chip}`} dir="ltr">{tone.sub}</p>
              {cert.state === 'pending' && cert.statusText && (
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-paper px-3 py-1 text-xs font-extrabold text-muted-strong ring-1 ring-line"><Clock3 size={13} /> {cert.statusText}</p>
              )}
            </div>

            {/* The certificate's facts */}
            <div className="mt-7 rounded-[20px] border border-line bg-paper p-4 text-right sm:p-5">
              <div className="mb-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-line pb-3 text-center text-sm font-extrabold text-primary-700">
                <KindIcon size={16} className="flex-none" /> {cert.title}
                {cert.titleEn && <span className="font-serif text-xs font-semibold text-muted" dir="ltr">· {cert.titleEn}</span>}
              </div>
              <div className="divide-y divide-line">
                <Field label="اسم المتدرب" value={cert.holderAr} sub={cert.holderEn} />
                {!cert.holderAr && cert.holderEn && <Field label="Trainee" value={cert.holderEn} ltr />}
                <Field label={cert.kind === 'course' ? 'الكورس' : 'الكورس / المجال'} value={cert.subjectAr} sub={cert.subjectEn} />
                {cert.hours ? <Field label="عدد الساعات التدريبية" value={`${cert.hours} ساعة`} /> : null}
                <Field label={cert.state === 'valid' ? 'تاريخ الإصدار' : 'تاريخ الإصدار المتوقع'} value={cert.state === 'valid' ? dayText(cert.issuedAt) : ''} />
                <Field label="الجهة المُصدِرة" value={cert.issuer} />
              </div>
            </div>

            {/* The code: a ticket stub with its QR */}
            <div className="cv-stub mt-5 flex items-center gap-4 rounded-[20px] bg-ink p-4 text-white sm:px-6">
              {qr && <img src={qr} alt="QR" width={80} height={80} className="h-20 w-20 shrink-0 rounded-lg bg-white p-1" />}
              <div className="min-w-0 flex-1 text-right">
                <p className="flex items-center gap-1 text-[11px] font-bold text-gold-light"><Fingerprint size={13} /> كود الشهادة</p>
                <p className="mt-1 break-all font-mono text-lg font-black tracking-widest" dir="ltr" style={{ textAlign: 'left' }}>{cert.code}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-white/65">امسح الـQR أو اكتب الكود في «التحقق من شهادة» لتتأكد في أي وقت.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Message({ kind }: { kind: 'missing' | 'revoked' | 'error' | 'idle' }) {
  const cfg = {
    missing: { icon: ShieldX, title: 'مفيش شهادة بالكود ده', text: 'راجع الكود حرف بحرف (من غير مسافات)، أو اتأكد إن الشهادة اتصدرت من المعهد. لو الكود صح وبرضه مش بيظهر كلّمنا.', tone: 'bg-red-50 text-red-600 ring-red-100' },
    revoked: { icon: ShieldAlert, title: 'الشهادة ملغاة', text: 'الإدارة ألغت صلاحية الشهادة دي ومبقتش صالحة للتحقق.', tone: 'bg-red-50 text-red-600 ring-red-100' },
    error: { icon: ShieldAlert, title: 'تعذر التحقق دلوقتي', text: 'حصلت مشكلة في الاتصال. جرّب تاني بعد لحظات.', tone: 'bg-paper text-muted-strong ring-line' },
    idle: { icon: Sparkles, title: 'تحقق من أي شهادة صادرة من المعهد', text: 'اكتب كود الشهادة المطبوع عليها (تحت اسم الكورس) وهتظهر لك بياناتها الموثّقة: شهادات الكورسات وشهادات الجهات المعتمدة.', tone: 'bg-primary-50 text-primary-700 ring-primary-100' },
  }[kind];
  const Icon = cfg.icon;
  return (
    <div className="cv-card mx-auto max-w-lg rounded-[28px] border border-line bg-white p-6 text-center sm:p-8">
      <div className={`mx-auto grid h-20 w-20 place-items-center rounded-full ring-8 ${cfg.tone}`}><Icon size={36} /></div>
      <h2 className="mt-5 text-2xl font-black leading-tight text-ink">{cfg.title}</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-muted-body">{cfg.text}</p>
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
    if (!outcome || loading) return <div className="mx-auto h-10 w-10 rounded-full border-2 border-line border-t-primary-700 motion-safe:animate-spin" aria-label="جاري التحقق" />;
    if (outcome.type === 'found') return <CertificateCard cert={outcome.cert} />;
    if (outcome.type === 'revoked') return outcome.cert ? <CertificateCard cert={{ ...outcome.cert, state: 'revoked' }} /> : <Message kind="revoked" />;
    return <Message kind={outcome.type} />;
  }, [code, outcome, loading]);

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <style>{STYLES}</style>
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-1.5" dir="ltr"><BadgeCheck size={15} /> CERTIFICATE VERIFICATION</span>}
        title={<>التحقق من <span className="text-primary-700">شهادة</span></>}
        subtitle="معهد الدراسات النفسية"
      >
        <SearchBox initial={code || ''} busy={loading} onSearch={next => navigate(`/certificate/${encodeURIComponent(next.replace(/\s+/g, ''))}`)} />
      </PageHeader>
      <section className="px-4 py-12 sm:py-16">
        {content}
      </section>
    </div>
  );
};

export default CertificateVerify;
