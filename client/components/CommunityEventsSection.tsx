import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Calendar, MapPin, MonitorPlay, Users } from 'lucide-react';

import { cairoDateOnly } from '../../shared/cairoDate';
import { eventPath, eventSpeakers, eventWhen, isUpcoming } from '../lib/communityEvents';
import type { CommunityEventItem } from '../types';

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const whenKey = (event: CommunityEventItem) => `${event.eventDate || '9999'}${event.eventTime || ''}`;

function DateBadge({ event }: { event: CommunityEventItem }) {
  if (!event.eventDate) return null;
  const [, month, day] = event.eventDate.split('-').map(Number);
  return (
    <div className="absolute right-3 top-3 rounded-xl bg-white/95 px-3 py-1.5 text-center shadow">
      <p className="text-xl font-extrabold leading-none text-primary-700">{day}</p>
      <p className="mt-0.5 text-[11px] font-bold text-gray-500">{MONTHS[month - 1]}</p>
    </div>
  );
}

function EventCard({ event }: { event: CommunityEventItem }) {
  const speakers = event.speakers || [];
  return (
    <Link to={eventPath(event)} className="group flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="relative aspect-[16/9] overflow-hidden bg-gradient-to-br from-primary-600 to-violet-600">
        {event.imageUrl
          ? <img src={event.imageUrl} alt={event.title} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
          : <div className="flex h-full items-center justify-center text-5xl">📅</div>}
        <DateBadge event={event} />
        <span className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">
          {event.isOnline === false ? <><MapPin size={11} /> حضور</> : <><MonitorPlay size={11} /> أونلاين</>}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <span className="mb-2 w-fit rounded-full border border-primary-100 bg-primary-50 px-2.5 py-0.5 text-[11px] font-bold text-primary-700">{event.eventType || 'فعالية'}</span>
        <h4 className="mb-1 line-clamp-2 font-extrabold leading-snug text-gray-900 group-hover:text-primary-700">{event.title}</h4>
        <p className="mb-2 text-xs font-medium text-gray-500">{eventWhen(event)}</p>
        {event.description && <p className="mb-3 line-clamp-2 text-sm text-gray-500">{event.description}</p>}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-gray-50 pt-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex -space-x-2 space-x-reverse">
              {speakers.slice(0, 3).map(person => (person.image
                ? <img key={person.id} src={person.image} alt={person.name} className="h-7 w-7 rounded-full border-2 border-white object-cover" />
                : <span key={person.id} className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-primary-100 text-[11px] font-bold text-primary-700">{person.name.slice(0, 1)}</span>))}
            </div>
            <span className="truncate text-xs text-gray-500">{eventSpeakers(event)}</span>
          </div>
          <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-primary-700">التفاصيل والتسجيل <ArrowLeft size={13} /></span>
        </div>
        {!!event.registrations && <p className="mt-2 flex items-center gap-1 text-[11px] text-emerald-700"><Users size={11} /> {event.registrations} شخص مهتم</p>}
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
        <h3 className="mb-4 flex items-center gap-2 text-lg font-extrabold text-gray-900"><Calendar size={20} className="text-primary-600" />الفعاليات القادمة</h3>
        {upcoming.length === 0 ? (
          <div className="rounded-2xl border border-gray-100 bg-white py-14 text-center text-gray-400 shadow-sm">
            <Calendar size={36} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">مفيش فعاليات قادمة دلوقتي — تابعنا، الجديد بيتنزل هنا.</p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">{upcoming.map(event => <EventCard key={event.id} event={event} />)}</div>
        )}
      </section>
      {past.length > 0 && (
        <section>
          <h3 className="mb-3 text-base font-extrabold text-gray-500">فعاليات سابقة</h3>
          <div className="divide-y divide-gray-50 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            {past.map(event => (
              <Link key={event.id} to={eventPath(event)} className="flex items-center gap-3 p-3 transition hover:bg-gray-50">
                {event.imageUrl
                  ? <img src={event.imageUrl} alt="" loading="lazy" className="h-12 w-16 rounded-lg object-cover opacity-80" />
                  : <span className="flex h-12 w-16 items-center justify-center rounded-lg bg-gray-100">📅</span>}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-gray-700">{event.title}</p>
                  <p className="text-xs text-gray-400">{eventWhen(event)}</p>
                </div>
                <ArrowLeft size={14} className="text-gray-300" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
