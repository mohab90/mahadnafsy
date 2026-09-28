import React, { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, CalendarDays, CalendarPlus, CheckCircle, Copy, MapPin, MonitorPlay, Share2, Users } from 'lucide-react';

import { useSiteData } from '../context/SiteDataContext';
import { mysqlClient } from '../lib/mysqlapi';
import { useSeo } from '../lib/useSeo';
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
      <div className="mx-auto max-w-2xl px-4 py-24 text-center" dir="rtl">
        <p className="mb-3 text-5xl">📅</p>
        <h1 className="mb-2 text-2xl font-extrabold text-gray-900">الفعالية دي مش موجودة</h1>
        <p className="mb-6 text-gray-500">ممكن تكون اتلغت أو اللينك اتغير.</p>
        <Link to="/community/events" className="rounded-xl bg-primary-600 px-6 py-3 font-bold text-white">كل الفعاليات</Link>
      </div>
    );
  }
  if (!event) {
    return <div className="flex min-h-[60vh] items-center justify-center"><span className="h-8 w-8 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" /></div>;
  }

  const upcoming = isUpcoming(event);
  const where = event.isOnline === false ? (event.locationName || 'حضور — يُعلن المكان') : `أونلاين${event.platform ? ` · ${event.platform}` : ''}`;
  const url = `${SITE}${eventPath(event)}`;
  const count = (event.registrations || 0) + (done === 'new' ? 1 : 0);

  const register = async (submit: FormEvent<HTMLFormElement>) => {
    submit.preventDefault();
    setError('');
    setSending(true);
    try {
      const result = await mysqlClient.registerForCommunityEvent(event.id, { name: name.trim(), phone: phone.trim() });
      setDone(result.alreadyRegistered ? 'again' : 'new');
    } catch (failure) {
      setError(failure instanceof Error && !/^HTTP /.test(failure.message) ? failure.message : 'تعذّر التسجيل، حاول تاني.');
    } finally { setSending(false); }
  };

  // Where the clipboard is refused, the link is shown to copy by hand.
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setShowLink(true); }
  };

  return (
    <div className="bg-gray-50 pb-20" dir="rtl">
      <div className="mx-auto max-w-6xl px-4 pt-6">
        <Link to="/community/events" className="mb-4 inline-flex items-center gap-1.5 text-sm font-bold text-primary-700 hover:underline">
          <ArrowRight size={16} /> كل الفعاليات
        </Link>

        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-700 via-primary-600 to-violet-600 shadow-lg">
          {event.imageUrl && <img src={event.imageUrl} alt={event.title} className="h-64 w-full object-cover sm:h-96" />}
          <div className={`${event.imageUrl ? 'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent' : ''} p-6 sm:p-10`}>
            <div className="mb-3 flex flex-wrap gap-2 text-xs font-bold">
              <span className="rounded-full bg-white/90 px-3 py-1 text-primary-700">{event.eventType || 'فعالية'}</span>
              <span className="flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-white backdrop-blur">
                {event.isOnline === false ? <><MapPin size={12} /> حضور</> : <><MonitorPlay size={12} /> أونلاين</>}
              </span>
              {!upcoming && <span className="rounded-full bg-gray-900/60 px-3 py-1 text-white">انتهت</span>}
            </div>
            <h1 className="text-2xl font-extrabold leading-snug text-white sm:text-4xl">{event.title}</h1>
            {event.description && <p className="mt-2 max-w-3xl text-sm text-white/90 sm:text-base">{event.description}</p>}
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { icon: CalendarDays, label: 'الموعد', value: eventWhen(event) },
                { icon: event.isOnline === false ? MapPin : MonitorPlay, label: 'المكان', value: where },
                { icon: Users, label: 'المهتمين', value: count ? `${count} شخص مهتم` : 'كن أول المهتمين' },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-start gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                  <span className="rounded-xl bg-primary-50 p-2 text-primary-600"><Icon size={18} /></span>
                  <div><p className="text-xs text-gray-500">{label}</p><p className="text-sm font-bold text-gray-900">{value}</p></div>
                </div>
              ))}
            </div>

            {(event.speakers?.length || event.speaker) && (
              <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                <h2 className="mb-4 text-lg font-extrabold text-gray-900">{(event.speakers?.length || 0) + (event.speaker ? 1 : 0) > 1 ? 'المحاضرين' : 'المحاضر'}</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(event.speakers || []).map(person => (
                    <Link key={person.id} to={`/instructor/${person.id}`} className="flex items-center gap-3 rounded-xl border border-gray-100 p-3 transition hover:border-primary-200 hover:bg-primary-50/40">
                      {person.image
                        ? <img src={person.image} alt={person.name} className="h-14 w-14 rounded-full object-cover" />
                        : <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-100 text-lg font-bold text-primary-700">{person.name.slice(0, 1)}</span>}
                      <div className="min-w-0"><p className="truncate font-bold text-gray-900">{person.name}</p><p className="truncate text-xs text-gray-500">{person.title}</p></div>
                    </Link>
                  ))}
                  {event.speaker && (
                    <div className="flex items-center gap-3 rounded-xl border border-gray-100 p-3">
                      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-violet-100 text-lg font-bold text-violet-700">{event.speaker.slice(0, 1)}</span>
                      <div><p className="font-bold text-gray-900">{event.speaker}</p><p className="text-xs text-gray-500">ضيف الفعالية</p></div>
                    </div>
                  )}
                </div>
              </section>
            )}

            <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-7">
              <h2 className="mb-3 text-lg font-extrabold text-gray-900">عن الفعالية</h2>
              <div className="whitespace-pre-line text-[15px] leading-8 text-gray-700">
                {event.content || event.description || 'التفاصيل هتتنشر قريب.'}
              </div>
            </section>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-2xl border border-primary-100 bg-white p-5 shadow-md">
              {!upcoming ? (
                <div className="text-center">
                  <p className="mb-1 font-extrabold text-gray-900">الفعالية دي انتهت</p>
                  <p className="mb-4 text-sm text-gray-500">تابع الفعاليات الجاية وسجّل فيها.</p>
                  <Link to="/community/events" className="block rounded-xl bg-primary-600 py-3 font-bold text-white">الفعاليات الجاية</Link>
                </div>
              ) : done ? (
                <div className="text-center">
                  <CheckCircle size={44} className="mx-auto mb-2 text-emerald-500" />
                  <p className="font-extrabold text-gray-900">{done === 'again' ? 'انت مسجّل قبل كده ✓' : 'تم تسجيلك ✓'}</p>
                  <p className="mt-1 text-sm text-gray-500">هنتواصل معاك على الرقم ده بتفاصيل الحضور.</p>
                </div>
              ) : formOpen ? (
                <form onSubmit={register} className="space-y-3">
                  <p className="font-extrabold text-gray-900">سجّل اهتمامك</p>
                  <input value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={120} placeholder="الاسم"
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-primary-400 focus:outline-none" />
                  <input value={phone} onChange={e => setPhone(e.target.value)} required inputMode="tel" dir="ltr" placeholder="رقم الموبايل / الواتساب"
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 text-right text-sm focus:border-primary-400 focus:outline-none" />
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  <button type="submit" disabled={sending} className="w-full rounded-xl bg-primary-600 py-3 font-bold text-white hover:bg-primary-700 disabled:opacity-60">
                    {sending ? 'جاري التسجيل…' : 'تأكيد التسجيل'}
                  </button>
                </form>
              ) : (
                <div className="text-center">
                  <p className="mb-1 font-extrabold text-gray-900">مهتم تحضر؟</p>
                  <p className="mb-4 text-sm text-gray-500">سيب اسمك ورقمك وهنبعتلك التفاصيل.</p>
                  <button type="button" onClick={() => setFormOpen(true)} className="w-full rounded-xl bg-primary-600 py-3 text-lg font-bold text-white shadow hover:bg-primary-700">
                    🙋 أنا مهتم
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs font-bold">
              <button type="button" onClick={() => { void copyLink(); }} className="flex flex-col items-center gap-1 rounded-xl border border-gray-100 bg-white p-3 text-gray-700 hover:bg-gray-50">
                <Copy size={16} /> {copied ? 'اتنسخ ✓' : 'نسخ اللينك'}
              </button>
              <a href={`https://wa.me/?text=${encodeURIComponent(`${event.title}\n${url}`)}`} target="_blank" rel="noreferrer"
                className="flex flex-col items-center gap-1 rounded-xl border border-gray-100 bg-white p-3 text-emerald-700 hover:bg-emerald-50">
                <Share2 size={16} /> واتساب
              </a>
              <button type="button" disabled={!event.eventDate} onClick={() => downloadEventCalendar(event)}
                className="flex flex-col items-center gap-1 rounded-xl border border-gray-100 bg-white p-3 text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                <CalendarPlus size={16} /> للتقويم
              </button>
            </div>
            {showLink && (
              <input readOnly value={url} onFocus={e => e.target.select()} dir="ltr" className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs" />
            )}
            {eventSpeakers(event) && <p className="text-center text-xs text-gray-400">مع {eventSpeakers(event)}</p>}
          </aside>
        </div>
      </div>
    </div>
  );
};

export default CommunityEvent;
