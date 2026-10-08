import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { mysqlAdmin, type SalesPulse } from '../../../../lib/mysqlapi';
import { useVisibleInterval } from '../../../../../shared/useVisibleInterval';
import { CAIRO_TIME_ZONE } from '../../../../../shared/cairoDate';
import { CRM_CHANGED_EVENT } from '../../../../lib/crmChanged';
import { ConfettiBurst } from '../../../../components/ConfettiBurst';
import { playChime } from '../../../../lib/chime';
import { MOOD_FACE, badgesFor, messagesFor, milestonesReached, moodOf, progressOf, type Mood, type PulseNumbers } from '../../../../lib/salesMood';

/**
 * «إحصائياتي» for a sales rep (8 Oct 2026): «صفحه تفاعليه اقوي بكتير تفرح مع كل
 * حجز … وتزعل لما التارجيت يكون بعيد تشجعه كل شوية … وتتفاعل معاه في كل حجز وكل
 * عميل جديد». It reads the rep's own figures every half minute and after every
 * write, celebrates each booking and new client it has not shown before (kept per
 * rep in this browser), and each milestone of the target once.
 */

type Celebration = { id: string; emoji: string; title: string; subtitle: string; tone: 'big' | 'win' | 'soft' };

const MOOD_STYLE: Record<Mood, { card: string; bubble: string; motion: string }> = {
  champion: { card: 'from-amber-400 via-yellow-400 to-orange-500', bubble: 'text-amber-800', motion: 'pulse-dance' },
  fire: { card: 'from-emerald-500 via-teal-500 to-cyan-500', bubble: 'text-emerald-800', motion: 'pulse-dance' },
  good: { card: 'from-indigo-500 via-violet-500 to-purple-500', bubble: 'text-indigo-800', motion: 'pulse-bob' },
  worried: { card: 'from-orange-400 via-amber-500 to-rose-400', bubble: 'text-orange-800', motion: 'pulse-sway' },
  sad: { card: 'from-slate-500 via-slate-600 to-rose-500', bubble: 'text-rose-800', motion: 'pulse-sway' },
  no_target: { card: 'from-sky-500 via-indigo-500 to-violet-500', bubble: 'text-indigo-800', motion: 'pulse-bob' },
};

const money = (value: number) => Math.round(value).toLocaleString('ar-EG-u-nu-latn');
const cairoHour = () => Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: CAIRO_TIME_ZONE }).format(new Date())) % 24;
const ago = (at: string) => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60000));
  if (minutes < 1) return 'دلوقتي';
  if (minutes < 60) return `من ${minutes} دقيقة`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `من ${hours} ساعة` : `من ${Math.round(hours / 24)} يوم`;
};

const readSet = (key: string): Set<string> | null => {
  try { const raw = localStorage.getItem(key); return raw ? new Set(JSON.parse(raw) as string[]) : null; } catch { return null; }
};
const writeSet = (key: string, values: Set<string>) => {
  try { localStorage.setItem(key, JSON.stringify([...values].slice(-200))); } catch { /* private window */ }
};

/** A number that counts up to its value when it changes. */
function CountUp({ value, format = money }: { value: number; format?: (value: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 900);
      const eased = 1 - (1 - t) ** 3;
      setShown(origin + (value - origin) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(shown)}</>;
}

function Ring({ share }: { share: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, share));
  return (
    <svg viewBox="0 0 128 128" className="w-36 h-36 -rotate-90">
      <circle cx="64" cy="64" r={radius} stroke="rgba(255,255,255,0.25)" strokeWidth="12" fill="none" />
      <circle cx="64" cy="64" r={radius} stroke="white" strokeWidth="12" fill="none" strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - clamped)}
        style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(.2,.8,.2,1)' }} />
    </svg>
  );
}

export default function MySalesPulse({ staffId, staffName }: { staffId: string; staffName: string }) {
  const [pulse, setPulse] = useState<SalesPulse | null>(null);
  const [failed, setFailed] = useState(false);
  const [lineIndex, setLineIndex] = useState(0);
  const [queue, setQueue] = useState<Celebration[]>([]);
  const [confetti, setConfetti] = useState(0);
  const [sound, setSound] = useState(() => { try { return localStorage.getItem('pulse-sound') !== 'off'; } catch { return true; } });
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const seenKey = `pulse-seen:${staffId}`;
  const celebrate = useCallback((items: Celebration[]) => {
    if (!items.length) return;
    setQueue(current => [...current, ...items]);
  }, []);

  const load = useCallback(async () => {
    try {
      const fresh = await mysqlAdmin.getMyPulse();
      setFailed(false);
      setPulse(fresh);
      // Each booking and each new client, once. A first visit takes what is
      // already there as seen, so opening the page is not a false party.
      const seen = readSet(seenKey);
      const unseen = seen ? fresh.recent.filter(event => !seen.has(event.id)) : [];
      const next = new Set([...(seen || []), ...fresh.recent.map(event => event.id)]);
      writeSet(seenKey, next);
      const items: Celebration[] = unseen.slice(0, 5).reverse().map(event => event.kind === 'lead'
        ? { id: event.id, emoji: '🎯', title: 'عميل جديد وصلك!', subtitle: `${event.name || 'عميل جديد'} — كلّمه دلوقتي وهو سخن 📞`, tone: 'soft' as const }
        : { id: event.id, emoji: event.kind === 'installment' ? '💳' : '🎉', title: event.kind === 'installment' ? 'قسط جديد اتدفع!' : 'حجز جديد! مبروك',
            subtitle: `${event.name || 'عميل'}${event.item ? ` · ${event.item}` : ''} — ${money(event.amountEgp || 0)} ج.م`, tone: 'win' as const });
      // The target's milestones, each once a month.
      const milestoneKey = `pulse-milestones:${staffId}:${fresh.monthStart}`;
      const reached = milestonesReached(fresh.month.moneyEgp, fresh.target.revenue).map(String);
      const known = readSet(milestoneKey);
      const newlyReached = known ? reached.filter(step => !known.has(step)) : [];
      writeSet(milestoneKey, new Set([...(known || []), ...reached]));
      for (const step of newlyReached) {
        items.push(step === '100'
          ? { id: `m-${step}`, emoji: '🏆', title: 'حققت التارجت!!', subtitle: 'إنت بطل الشهر — كل جنيه بعد كده زيادة ليك', tone: 'big' }
          : { id: `m-${step}`, emoji: step === '75' ? '🥇' : '🥈', title: `وصلت ${step}% من التارجت!`, subtitle: 'كمّل… خط النهاية قرّب', tone: 'big' });
      }
      celebrate(items);
    } catch {
      setFailed(true);
    }
  }, [celebrate, seenKey, staffId]);

  useVisibleInterval(() => { void load(); }, 30_000);
  useEffect(() => {
    const onChanged = () => { void load(); };
    window.addEventListener(CRM_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CRM_CHANGED_EVENT, onChanged);
  }, [load]);

  // One celebration at a time: confetti, a sound, five seconds on screen.
  const current = queue[0] || null;
  useEffect(() => {
    if (!current) return undefined;
    setConfetti(value => value + 1);
    if (soundRef.current) playChime(current.tone);
    const timer = setTimeout(() => setQueue(list => list.slice(1)), 5000);
    return () => clearTimeout(timer);
  }, [current]);

  const numbers: PulseNumbers | null = useMemo(() => (pulse ? {
    revenue: pulse.month.moneyEgp, target: pulse.target.revenue, dayOfMonth: pulse.dayOfMonth,
    daysInMonth: pulse.daysInMonth, todayBookings: pulse.todayFigures.bookings, monthBookings: pulse.month.bookings,
    streak: pulse.streak, hour: cairoHour(),
  } : null), [pulse]);
  const mood = numbers ? moodOf(numbers) : 'good';
  const lines = useMemo(() => (numbers ? messagesFor(mood, numbers) : []), [mood, numbers]);
  useEffect(() => {
    const timer = setInterval(() => setLineIndex(index => index + 1), 12_000);
    return () => clearInterval(timer);
  }, []);

  if (!pulse || !numbers) {
    return (
      <div className="text-center py-20 text-gray-400" dir="rtl">
        {failed ? 'تعذر تحميل أرقامك — هنحاول تاني بعد شوية' : 'بنجهّز أرقامك… ⏳'}
      </div>
    );
  }

  const progress = progressOf(numbers);
  const style = MOOD_STYLE[mood];
  const badges = badgesFor(numbers);
  const line = lines.length ? lines[lineIndex % lines.length] : '';
  const firstName = (staffName || '').split(' ')[0];
  const paceMarker = Math.min(100, Math.round(progress.time * 100));

  return (
    <div className="space-y-4" dir="rtl">
      <style>{`
        @keyframes pulse-dance { 0%,100% { transform: translateY(0) rotate(0) } 25% { transform: translateY(-10px) rotate(-8deg) } 75% { transform: translateY(-6px) rotate(8deg) } }
        @keyframes pulse-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
        @keyframes pulse-sway { 0%,100% { transform: rotate(0) } 50% { transform: rotate(-6deg) translateY(3px) } }
        @keyframes pulse-pop { 0% { transform: scale(.6); opacity: 0 } 60% { transform: scale(1.08); opacity: 1 } 100% { transform: scale(1) } }
        @keyframes pulse-line { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
        .pulse-dance { animation: pulse-dance 1.6s ease-in-out infinite }
        .pulse-bob { animation: pulse-bob 2.4s ease-in-out infinite }
        .pulse-sway { animation: pulse-sway 3.2s ease-in-out infinite }
        .pulse-pop { animation: pulse-pop .5s cubic-bezier(.2,.8,.2,1) both }
        .pulse-line { animation: pulse-line .45s ease-out both }
        @media (prefers-reduced-motion: reduce) { .pulse-dance, .pulse-bob, .pulse-sway, .pulse-pop, .pulse-line { animation: none } }
      `}</style>
      <ConfettiBurst fire={confetti} />

      {current && (
        <button type="button" onClick={() => setQueue(list => list.slice(1))}
          className="fixed inset-x-0 top-24 mx-auto z-[80] w-[min(92vw,420px)] pulse-pop bg-white rounded-3xl shadow-2xl border-4 border-amber-300 p-6 text-center">
          <div className="text-6xl mb-2">{current.emoji}</div>
          <p className="text-xl font-extrabold text-gray-900">{current.title}</p>
          <p className="text-sm text-gray-600 mt-1">{current.subtitle}</p>
          <p className="text-[11px] text-gray-400 mt-3">اضغط لإغلاق</p>
        </button>
      )}

      {/* The face, its mood and what it says. */}
      <div className={`relative overflow-hidden rounded-3xl bg-gradient-to-l ${style.card} text-white p-5 sm:p-6 shadow-lg`}>
        <div className="flex flex-wrap items-center gap-5">
          <div className={`text-7xl sm:text-8xl select-none ${style.motion}`} aria-hidden="true">{MOOD_FACE[mood]}</div>
          <div className="flex-1 min-w-[220px]">
            <p className="text-sm text-white/80">أهلاً {firstName} 👋</p>
            <div key={lineIndex} className={`pulse-line mt-2 inline-block bg-white rounded-2xl rounded-tr-sm px-4 py-3 shadow ${style.bubble} font-bold text-sm sm:text-base`}>
              {line}
            </div>
          </div>
          <div className="relative flex items-center justify-center">
            <Ring share={progress.done} />
            <div className="absolute text-center">
              <p className="text-3xl font-extrabold"><CountUp value={Math.round(progress.done * 100)} format={value => String(Math.round(value))} />%</p>
              <p className="text-[11px] text-white/80">من التارجت</p>
            </div>
          </div>
          <button type="button" onClick={() => { const next = !sound; setSound(next); try { localStorage.setItem('pulse-sound', next ? 'on' : 'off'); } catch { /* ignore */ } if (next) playChime('soft'); }}
            title={sound ? 'كتم الصوت' : 'تشغيل الصوت'} className="absolute top-3 left-3 p-2 rounded-full bg-white/15 hover:bg-white/25">
            {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
        </div>

        {numbers.target > 0 && (
          <div className="mt-5">
            <div className="flex justify-between text-xs text-white/85 mb-1.5">
              <span>اتحقق <b className="text-white"><CountUp value={numbers.revenue} /></b> من {money(numbers.target)} ج.م</span>
              <span>{progress.left > 0 ? <>فاضلك <b className="text-white">{money(progress.left)}</b> · محتاج {money(progress.perDay)} في اليوم</> : 'التارجت اتقفل 🏆'}</span>
            </div>
            <div className="relative h-4 rounded-full bg-white/20 overflow-hidden">
              <div className="h-full rounded-full bg-white" style={{ width: `${Math.min(100, progress.done * 100)}%`, transition: 'width 1.2s cubic-bezier(.2,.8,.2,1)' }} />
              <div className="absolute top-0 bottom-0 w-0.5 bg-black/40" style={{ right: `${paceMarker}%` }} title="المفروض تكون هنا النهارده" />
            </div>
            <p className="text-[11px] text-white/75 mt-1">الخط الأسود = المفروض توصل له النهارده ({money(progress.expectedByToday)} ج.م)</p>
          </div>
        )}
      </div>

      {/* Today. */}
      <div>
        <p className="text-sm font-extrabold text-gray-700 mb-2">النهارده ☀️</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'حجوزات', value: pulse.todayFigures.bookings, emoji: '🎉', tone: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
            { label: 'فلوس دخلت (ج.م)', value: pulse.todayFigures.moneyEgp, emoji: '💰', tone: 'bg-amber-50 border-amber-200 text-amber-700' },
            { label: 'عملاء جدد وصلوك', value: pulse.todayFigures.newLeads, emoji: '🎯', tone: 'bg-sky-50 border-sky-200 text-sky-700' },
            { label: 'مكالمات وتواصل', value: pulse.todayFigures.contacts, emoji: '📞', tone: 'bg-violet-50 border-violet-200 text-violet-700' },
          ].map(card => (
            <div key={card.label} className={`rounded-2xl border p-4 ${card.tone}`}>
              <div className="text-2xl">{card.emoji}</div>
              <p className="text-2xl font-extrabold mt-1"><CountUp value={card.value} /></p>
              <p className="text-xs font-semibold opacity-80">{card.label}</p>
            </div>
          ))}
        </div>
        {pulse.todayFigures.followUpsOverdue > 0 && (
          <p className="mt-2 text-xs font-bold text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">
            ⏰ عندك {pulse.todayFigures.followUpsOverdue} متابعة متأخرة — دول أقرب ناس للحجز، ابدأ بيهم
          </p>
        )}
      </div>

      {/* The month. */}
      <div>
        <p className="text-sm font-extrabold text-gray-700 mb-2">الشهر ده 📅</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500">حجوزات الشهر</p>
            <p className="text-2xl font-extrabold text-gray-900"><CountUp value={pulse.month.bookings} /></p>
            {pulse.month.installments > 0 && <p className="text-[11px] text-gray-400">+ {pulse.month.installments} قسط</p>}
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500">عملاء جدد الشهر</p>
            <p className="text-2xl font-extrabold text-gray-900"><CountUp value={pulse.month.newLeads} /></p>
          </div>
          <div className={`rounded-2xl border p-4 ${pulse.streak >= 3 ? 'border-orange-300 bg-orange-50' : 'border-gray-200 bg-white'}`}>
            <p className="text-xs text-gray-500">أيام ورا بعض فيها حجز</p>
            <p className="text-2xl font-extrabold text-orange-600">🔥 {pulse.streak}</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500">أحسن يوم ليك الشهر ده</p>
            <p className="text-lg font-extrabold text-gray-900">{pulse.bestDay ? `${money(pulse.bestDay.moneyEgp)} ج.م` : '— لسه —'}</p>
            {pulse.bestDay && <p className="text-[11px] text-gray-400">{pulse.bestDay.day} · {pulse.bestDay.bookings} حجز</p>}
          </div>
        </div>
      </div>

      {/* Badges. */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm font-extrabold text-gray-700 mb-3">إنجازاتك 🏅</p>
        <div className="flex flex-wrap gap-2">
          {badges.map(badge => (
            <span key={badge.key} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold border transition ${badge.earned ? 'bg-amber-50 border-amber-300 text-amber-800 shadow-sm' : 'bg-gray-50 border-gray-200 text-gray-400 grayscale'}`}>
              <span className="text-base">{badge.emoji}</span>{badge.label}
            </span>
          ))}
        </div>
      </div>

      {/* The latest bookings and clients. */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm font-extrabold text-gray-700 mb-3">آخر أخبارك ⚡</p>
        {pulse.recent.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">لسه مفيش أخبار من يومين — أول حجز جاي هيظهر هنا ويحتفل معاك 🎉</p>
        ) : (
          <ul className="space-y-2">
            {pulse.recent.map(event => (
              <li key={event.id} className="flex items-center gap-3 rounded-xl px-3 py-2 bg-gray-50">
                <span className="text-xl">{event.kind === 'lead' ? '🎯' : event.kind === 'installment' ? '💳' : '🎉'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-800 truncate">
                    {event.kind === 'lead' ? `عميل جديد: ${event.name || '—'}` : `${event.kind === 'installment' ? 'قسط' : 'حجز'} — ${event.name || 'عميل'}`}
                  </p>
                  {event.kind !== 'lead' && <p className="text-[11px] text-gray-500 truncate">{event.item || ''}{event.item ? ' · ' : ''}{money(event.amountEgp || 0)} ج.م</p>}
                </div>
                <span className="text-[11px] text-gray-400 whitespace-nowrap">{ago(event.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
