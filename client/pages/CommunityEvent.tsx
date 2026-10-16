import React, { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, CalendarDays, CalendarPlus, CheckCircle, Copy, MapPin, MonitorPlay, Share2, Users } from 'lucide-react';

import { useSiteData } from '../context/SiteDataContext';
import { mysqlClient } from '../lib/mysqlapi';
import { useSeo } from '../lib/useSeo';
import { cdnImg, cdnSrcSet } from '../lib/img';
import { downloadEventCalendar, eventPath, eventSpeakers, eventWhen, isUpcoming } from '../lib/communityEvents';
import type { CommunityEventItem } from '../types';

const SITE = 'https://mahadnafsy.com';
const absolute = (url?: string) => (url && url.startsWith('/') ? `${SITE}${url}` : url);

/**
 * One community event, at its own address: the picture, when and where, the
 * lecturers, the full text, and «أنا مهتم» — a name and a number, no account.
 */
const CommunityEvent: React.FC = () => {
  const { slug = '' } = useParams();
  const { communityEvents, loadCommunity, authUser } = useSiteData();
  const fromList = communityEvents.find(event => event.slug === slug || event.id === slug);
  const [event, setEvent] = useState<CommunityEventItem | null>(fromList || null);
  const [missing, setMissing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState(authUser?.displayName || '');
  const [phone, setPhone] = useState('');
  const [studiedBefore, setStudiedBefore] = useState<boolean | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<'new' | 'again' | null>(null);
  const [copied, setCopied] = useState(false);
  const [showLink, setShowLink] = useState(false);

  useEffect(() => { void loadCommunity(); }, [loadCommunity]);
  useEffect(() => { if (fromList && !event) setEvent(fromList); }, [fromList, event]);
  // Fresh from the server as well: the count of who registered moves.
  useEffect(() => {
    let cancelled = false;
    mysqlClient.getCommunityEvent(slug)
      .then(found => { if (!cancelled) setEvent(found); })
      .catch(() => { if (!cancelled && !fromList) setMissing(true); });
    return () => { cancelled = true; };
    // fromList only matters for the first answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useSeo({
    title: event ? `${event.title} | فعاليات معهد الدراسات النفسية` : 'الفعاليات | معهد الدراسات النفسية',
    description: event?.description || event?.content?.slice(0, 180) || 'فعاليات وندوات معهد الدراسات النفسية.',
    path: event ? eventPath(event) : `/community/events/${slug}`,
    image: absolute(event?.imageUrl),
    type: 'article',
  });

  if (missing && !event) {
    return (
      <div className="bg-paper" dir="rtl">
        <div className="mx-auto max-w-2xl px-4 py-24 text-center">
          <p className="mb-3 text-5xl">📅</p>
          <h1 className="mb-2 text-2xl font-black text-ink sm:text-3xl">الفعالية دي مش موجودة</h1>
          <p className="mb-6 text-muted-body">ممكن تكون اتلغت أو اللينك اتغير.</p>
          <Link to="/community/events" className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-primary-700 px-7 font-black text-white transition hover:bg-primary-800">كل الفعاليات</Link>
        </div>
      </div>
    );
  }
  if (!event) {
    return <div className="flex min-h-[60vh] items-center justify-center bg-paper"><span className="h-8 w-8 animate-spin rounded-full border-2 border-primary-700 border-t-transparent" /></div>;
  }

  const upcoming = isUpcoming(event);
  const where = event.isOnline === false ? (event.locationName || 'حضور — يُعلن المكان') : `أونلاين${event.platform ? ` · ${event.platform}` : ''}`;
  const url = `${SITE}${eventPath(event)}`;
  const count = (event.registrations || 0) + (done === 'new' ? 1 : 0);

  const register = async (submit: FormEvent<HTMLFormElement>) => {
    submit.preventDefault();
    if (studiedBefore === null) { setError('اختار: درست في المعهد قبل كده ولا لأ؟'); return; }
    setError('');
    setSending(true);
    try {
      const result = await mysqlClient.registerForCommunityEvent(event.id, { name: name.trim(), phone: phone.trim(), studiedBefore });
      setDone(result.alreadyRegistered ? 'again' : 'new');
    } catch (failure) {
      setError(failure instanceof Error && !/^HTTP /.test(failure.message) ? failure.message : 'تعذّر التسجيل، حاول تاني.');
    } finally { setSending(false); }
  };

  // «زر انا مهتم كمان يظهر تحت المحتوي»: the same form, opened and brought into view.
  const openForm = () => {
    setFormOpen(true);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // Where the clipboard is refused, the link is shown to copy by hand.
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setShowLink(true); }
  };

  const fieldClass = 'min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10';
  const primaryBtn = 'inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 px-7 font-black text-white transition hover:bg-primary-800';

  return (
    <div className="bg-paper pb-20" dir="rtl">
      <div className="mx-auto max-w-6xl px-4 pt-6">
        <Link to="/community/events" className="mb-4 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-extrabold text-primary-700 hover:underline">
          <ArrowRight size={16} /> كل الفعاليات
        </Link>

        <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-primary-700 via-primary-800 to-[#4c0519] shadow-[0_40px_80px_-45px_rgba(26,15,18,.6)]">
          {event.imageUrl && <img src={cdnImg(event.imageUrl, 1200)} srcSet={cdnSrcSet(event.imageUrl, [640, 1000, 1200])} sizes="(min-width: 1152px) 1120px, 100vw" alt={event.title} fetchPriority="high" decoding="async" className="h-64 w-full bg-primary-900 object-cover sm:h-96" />}
          <div className={`${event.imageUrl ? 'absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/90 via-ink/50 to-transparent' : ''} p-6 sm:p-10`}>
            <div className="mb-3 flex flex-wrap gap-2 text-xs font-bold">
              <span className="rounded-full bg-white px-3 py-1 font-extrabold text-primary-700">{event.eventType || 'فعالية'}</span>
              <span className="flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-white ring-1 ring-white/20">
                {event.isOnline === false ? <><MapPin size={12} /> حضور</> : <><MonitorPlay size={12} /> أونلاين</>}
              </span>
              {!upcoming && <span className="rounded-full bg-ink/70 px-3 py-1 text-white">انتهت</span>}
            </div>
            <h1 className="text-balance text-2xl font-black leading-snug text-white sm:text-4xl">{event.title}</h1>
            {event.description && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/80 sm:text-base">{event.description}</p>}
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="min-w-0 space-y-6">
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { icon: CalendarDays, label: 'الموعد', value: eventWhen(event) },
                { icon: event.isOnline === false ? MapPin : MonitorPlay, label: 'المكان', value: where },
                { icon: Users, label: 'المهتمين', value: count ? `${count} شخص مهتم` : 'كن أول المهتمين' },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-start gap-3 rounded-[20px] border border-line bg-white p-4">
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700"><Icon size={18} /></span>
                  <div className="min-w-0"><p className="text-xs text-muted">{label}</p><p className="text-sm font-extrabold text-ink">{value}</p></div>
                </div>
              ))}
            </div>

            {(event.speakers?.length || event.speaker) && (
              <section className="rounded-[24px] border border-line bg-white p-5 sm:p-6">
                <h2 className="mb-4 text-xl font-black text-ink">{(event.speakers?.length || 0) + (event.speaker ? 1 : 0) > 1 ? 'المحاضرين' : 'المحاضر'}</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(event.speakers || []).map(person => (
                    <Link key={person.id} to={`/instructor/${person.id}`} className="flex items-center gap-3 rounded-2xl border border-line p-3 transition hover:border-line-deep hover:bg-paper">
                      {person.image
                        ? <img src={cdnImg(person.image, 120)} alt={person.name} width={56} height={56} loading="lazy" decoding="async" className="h-14 w-14 flex-none rounded-full bg-sand object-cover object-top" />
                        : <span className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-primary-50 text-lg font-black text-primary-700">{person.name.slice(0, 1)}</span>}
                      <div className="min-w-0"><p className="truncate font-black text-ink">{person.name}</p><p className="truncate text-xs text-muted">{person.title}</p></div>
                    </Link>
                  ))}
                  {event.speaker && (
                    <div className="flex items-center gap-3 rounded-2xl border border-line p-3">
                      <span className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-ink text-lg font-black text-gold-pale">{event.speaker.slice(0, 1)}</span>
                      <div className="min-w-0"><p className="font-black text-ink">{event.speaker}</p><p className="text-xs text-muted">ضيف الفعالية</p></div>
                    </div>
                  )}
                </div>
              </section>
            )}

            <section className="rounded-[24px] border border-line bg-white p-5 sm:p-7">
              <h2 className="mb-3 text-xl font-black text-ink">عن الفعالية</h2>
              <div className="whitespace-pre-line break-words text-[15px] leading-8 text-muted-body">
                {event.content || event.description || 'التفاصيل هتتنشر قريب.'}
              </div>
              {upcoming && !done && (
                <button type="button" onClick={openForm}
                  className="mt-6 inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 text-lg font-black text-white transition hover:bg-primary-800 sm:w-auto sm:px-10">
                  🙋 أنا مهتم
                </button>
              )}
            </section>
          </div>

          <aside className="min-w-0 space-y-4 lg:sticky lg:top-24 lg:self-start">
            <div ref={formRef} className="rounded-[24px] bg-white p-5 shadow-[0_30px_60px_-35px_rgba(26,15,18,.45)] ring-1 ring-line sm:p-6">
              {!upcoming ? (
                <div className="text-center">
                  <p className="mb-1 text-lg font-black text-ink">الفعالية دي انتهت</p>
                  <p className="mb-4 text-sm text-muted">تابع الفعاليات الجاية وسجّل فيها.</p>
                  <Link to="/community/events" className={primaryBtn}>الفعاليات الجاية</Link>
                </div>
              ) : done ? (
                <div className="text-center">
                  <CheckCircle size={44} className="mx-auto mb-2 text-green-600" />
                  <p className="text-lg font-black text-ink">{done === 'again' ? 'انت مسجّل قبل كده ✓' : 'تم تسجيلك ✓'}</p>
                  <p className="mt-1 text-sm text-muted">هنتواصل معاك على الرقم ده بتفاصيل الحضور.</p>
                </div>
              ) : formOpen ? (
                <form onSubmit={register} className="space-y-3">
                  <p className="text-lg font-black text-ink">سجّل اهتمامك</p>
                  <input value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={120} placeholder="الاسم"
                    className={fieldClass} />
                  <input value={phone} onChange={e => setPhone(e.target.value)} required inputMode="tel" dir="ltr" placeholder="رقم الموبايل / الواتساب"
                    className={`${fieldClass} text-right`} />
                  <fieldset>
                    <legend className="mb-1.5 text-[13px] font-bold text-muted-strong">درست في المعهد قبل كده؟</legend>
                    <div className="grid grid-cols-2 gap-2">
                      {([[true, 'نعم'], [false, 'لا']] as const).map(([value, text]) => (
                        <button key={text} type="button" onClick={() => setStudiedBefore(value)} aria-pressed={studiedBefore === value}
                          className={`min-h-[48px] rounded-xl border-2 text-sm font-extrabold transition ${studiedBefore === value ? 'border-primary-700 bg-primary-50/60 text-primary-800' : 'border-line bg-white text-ink hover:border-line-deep'}`}>
                          {text}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  {error && <p className="text-sm font-bold text-red-600">{error}</p>}
                  <button type="submit" disabled={sending} className={`${primaryBtn} disabled:opacity-60`}>
                    {sending ? 'جاري التسجيل…' : 'تأكيد التسجيل'}
                  </button>
                </form>
              ) : (
                <div className="text-center">
                  <p className="mb-1 text-lg font-black text-ink">مهتم تحضر؟</p>
                  <p className="mb-4 text-sm text-muted">سيب اسمك ورقمك وهنبعتلك التفاصيل.</p>
                  <button type="button" onClick={openForm} className={`${primaryBtn} text-lg`}>
                    🙋 أنا مهتم
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs font-bold">
              <button type="button" onClick={() => { void copyLink(); }} className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-2xl border border-line bg-white p-3 text-ink transition hover:border-line-deep">
                <Copy size={16} /> {copied ? 'اتنسخ ✓' : 'نسخ اللينك'}
              </button>
              <a href={`https://wa.me/?text=${encodeURIComponent(`${event.title}\n${url}`)}`} target="_blank" rel="noreferrer"
                className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-2xl border border-line bg-white p-3 text-green-700 transition hover:border-line-deep">
                <Share2 size={16} /> واتساب
              </a>
              <button type="button" disabled={!event.eventDate} onClick={() => downloadEventCalendar(event)}
                className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-2xl border border-line bg-white p-3 text-ink transition hover:border-line-deep disabled:opacity-40">
                <CalendarPlus size={16} /> للتقويم
              </button>
            </div>
            {showLink && (
              <input readOnly value={url} onFocus={e => e.target.select()} dir="ltr" className="w-full rounded-xl border border-line-strong bg-white px-3 py-2.5 text-xs text-ink" />
            )}
            {eventSpeakers(event) && <p className="text-center text-xs text-muted-soft">مع {eventSpeakers(event)}</p>}
          </aside>
        </div>
      </div>
    </div>
  );
};

export default CommunityEvent;
