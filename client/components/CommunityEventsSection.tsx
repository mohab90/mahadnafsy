import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Calendar, MapPin, MonitorPlay, Users } from 'lucide-react';

import { cairoDateOnly } from '../../shared/cairoDate';
import { cdnImg, cdnSrcSet } from '../lib/img';
import { eventPath, eventSpeakers, eventWhen, isUpcoming } from '../lib/communityEvents';
import type { CommunityEventItem } from '../types';

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const whenKey = (event: CommunityEventItem) => `${event.eventDate || '9999'}${event.eventTime || ''}`;

function DateBadge({ event }: { event: CommunityEventItem }) {
  if (!event.eventDate) return null;
  const [, month, day] = event.eventDate.split('-').map(Number);
  return (
    <div className="absolute right-3 top-3 rounded-2xl bg-white px-3 py-1.5 text-center shadow-[0_10px_20px_-10px_rgba(26,15,18,.5)]">
      <p className="text-xl font-black leading-none tabular-nums text-primary-700">{day}</p>
      <p className="mt-0.5 text-[11px] font-extrabold text-muted">{MONTHS[month - 1]}</p>
    </div>
  );
}

function EventCard({ event }: { event: CommunityEventItem }) {
  const speakers = event.speakers || [];
  return (
    <Link to={eventPath(event)} className="group flex flex-col overflow-hidden rounded-[24px] border border-line bg-white transition duration-300 hover:-translate-y-1 hover:shadow-[0_30px_50px_-25px_rgba(26,15,18,.35)]">
      <div className="relative aspect-[16/9] overflow-hidden bg-gradient-to-br from-primary-700 via-primary-800 to-[#4c0519]">
        {event.imageUrl
          ? <img src={cdnImg(event.imageUrl, 640)} srcSet={cdnSrcSet(event.imageUrl, [400, 640])} sizes="(min-width: 640px) 360px, 100vw" alt={event.title} loading="lazy" decoding="async" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
          : <div className="flex h-full items-center justify-center text-5xl">📅</div>}
        <DateBadge event={event} />
        <span className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-ink/80 px-2.5 py-1 text-[11px] font-bold text-white">
          {event.isOnline === false ? <><MapPin size={11} /> حضور</> : <><MonitorPlay size={11} /> أونلاين</>}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <span className="mb-2 w-fit rounded-full bg-primary-50 px-2.5 py-0.5 text-[11px] font-extrabold text-primary-700 ring-1 ring-primary-100">{event.eventType || 'فعالية'}</span>
        <h4 className="mb-1 line-clamp-2 text-[17px] font-black leading-snug text-ink group-hover:text-primary-700">{event.title}</h4>
        <p className="mb-2 text-xs font-bold text-muted">{eventWhen(event)}</p>
        {event.description && <p className="mb-3 line-clamp-2 text-sm leading-relaxed text-muted-body">{event.description}</p>}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex -space-x-2 space-x-reverse">
              {speakers.slice(0, 3).map(person => (person.image
                ? <img key={person.id} src={cdnImg(person.image, 80)} alt={person.name} width={28} height={28} loading="lazy" decoding="async" className="h-7 w-7 rounded-full border-2 border-white bg-sand object-cover" />
                : <span key={person.id} className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-primary-50 text-[11px] font-black text-primary-700">{person.name.slice(0, 1)}</span>))}
            </div>
            <span className="truncate text-xs text-muted">{eventSpeakers(event)}</span>
          </div>
          <span className="flex shrink-0 items-center gap-1 text-xs font-extrabold text-primary-700">التفاصيل والتسجيل <ArrowLeft size={13} /></span>
        </div>
        {!!event.registrations && <p className="mt-2 flex items-center gap-1 text-[11px] font-bold text-muted-strong"><Users size={11} className="text-primary-700" /> {event.registrations} شخص مهتم</p>}
      </div>
    </Link>
  );
}

const daysUntil = (date: string, today: string) =>
  Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

/**
 * The next event, at the top of the community's front page above «إضافة
 * بوست»: «لما يبقي في فعاليه او ندوة تظهر كارت بتصميم مميز».
 */
export function FeaturedEventCard({ events }: { events: CommunityEventItem[] }) {
  const today = cairoDateOnly();
  const next = events.filter(event => event.eventDate && isUpcoming(event, today))
    .sort((a, b) => whenKey(a).localeCompare(whenKey(b)))[0];
  if (!next?.eventDate) return null;
  const days = daysUntil(next.eventDate, today);
  const soon = days <= 0 ? 'النهارده' : days === 1 ? 'بكرة' : days === 2 ? 'بعد يومين' : `بعد ${days} ${days <= 10 ? 'أيام' : 'يوم'}`;
  return (
    <Link to={eventPath(next)} className="group relative block overflow-hidden rounded-[24px] bg-gradient-to-br from-primary-700 via-primary-800 to-[#4c0519] text-white shadow-[0_30px_50px_-30px_rgba(76,5,25,.7)] transition hover:-translate-y-0.5">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[.1]" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.7) 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
      <div className="relative flex flex-col sm:flex-row">
        {next.imageUrl && (
          <div className="aspect-[16/9] shrink-0 overflow-hidden bg-primary-900 sm:aspect-auto sm:w-56">
            <img src={cdnImg(next.imageUrl, 500)} alt={next.title} loading="lazy" decoding="async" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
            <span className="rounded-full bg-gold-light px-2.5 py-0.5 font-black text-ink">✨ {next.eventType || 'فعالية'} قادمة · {soon}</span>
            <span className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 ring-1 ring-white/20">
              {next.isOnline === false ? <><MapPin size={11} /> حضور</> : <><MonitorPlay size={11} /> أونلاين</>}
            </span>
          </div>
          <h3 className="text-lg font-black leading-snug sm:text-xl">{next.title}</h3>
          <p className="flex items-center gap-1.5 text-sm text-white/80"><Calendar size={14} className="text-gold-light" /> {eventWhen(next)}</p>
          {eventSpeakers(next) && <p className="text-xs text-white/65">مع {eventSpeakers(next)}</p>}
          <div className="mt-auto flex flex-wrap items-center gap-3 pt-2">
            <span className="inline-flex min-h-[44px] items-center rounded-xl bg-white px-4 text-sm font-black text-primary-700 transition group-hover:bg-paper">🙋 سجّل اهتمامك</span>
            {!!next.registrations && <span className="flex items-center gap-1 text-xs text-white/75"><Users size={12} /> {next.registrations} شخص مهتم</span>}
          </div>
        </div>
      </div>
    </Link>
  );
}

/** «الفعاليات»: what is coming as cards, each opening its own page; what is over, below. */
export function CommunityEventsSection({ events }: { events: CommunityEventItem[] }) {
  const today = cairoDateOnly();
  const upcoming = events.filter(event => isUpcoming(event, today)).sort((a, b) => whenKey(a).localeCompare(whenKey(b)));
  const past = events.filter(event => !isUpcoming(event, today)).sort((a, b) => whenKey(b).localeCompare(whenKey(a)));
  return (
    <div className="animate-fade-in space-y-8">
      <section>
        <h3 className="mb-4 flex items-center gap-2 text-xl font-black text-ink"><Calendar size={20} className="text-primary-700" />الفعاليات القادمة</h3>
        {upcoming.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-line-deep bg-white py-14 text-center text-muted">
            <Calendar size={36} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">مفيش فعاليات قادمة دلوقتي — تابعنا، الجديد بيتنزل هنا.</p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">{upcoming.map(event => <EventCard key={event.id} event={event} />)}</div>
        )}
      </section>
      {past.length > 0 && (
        <section>
          <h3 className="mb-3 text-base font-extrabold text-muted">فعاليات سابقة</h3>
          <div className="divide-y divide-line overflow-hidden rounded-[24px] border border-line bg-white">
            {past.map(event => (
              <Link key={event.id} to={eventPath(event)} className="flex items-center gap-3 p-3 transition hover:bg-paper">
                {event.imageUrl
                  ? <img src={cdnImg(event.imageUrl, 160)} alt="" width={64} height={48} loading="lazy" decoding="async" className="h-12 w-16 flex-none rounded-xl bg-sand object-cover opacity-80" />
                  : <span className="flex h-12 w-16 flex-none items-center justify-center rounded-xl bg-sand">📅</span>}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold text-ink">{event.title}</p>
                  <p className="text-xs text-muted-soft">{eventWhen(event)}</p>
                </div>
                <ArrowLeft size={14} className="flex-none text-muted-faint" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
