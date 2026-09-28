import { CAIRO_TIME_ZONE, cairoDateOnly, cairoDaysAhead, cairoInputToUtc } from '../../shared/cairoDate';
import type { CommunityEventItem } from '../types';

/** The event's own page. */
export const eventPath = (event: Pick<CommunityEventItem, 'id' | 'slug'>) =>
  `/community/events/${encodeURIComponent(event.slug || event.id)}`;

/** Not over yet: today's and later events, and ones whose date is still to come. */
export const isUpcoming = (event: CommunityEventItem, today = cairoDateOnly()) => !event.eventDate || event.eventDate >= today;

/** «الثلاثاء 6 أكتوبر 2026 · 7:00 م» — the day and hour in Cairo. */
export function eventWhen(event: CommunityEventItem): string {
  if (!event.eventDate) return event.dateLabel || 'الموعد يُعلن قريبًا';
  const day = new Date(`${event.eventDate}T12:00:00Z`).toLocaleDateString('ar-EG-u-nu-latn', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: CAIRO_TIME_ZONE,
  });
  if (!event.eventTime) return day;
  const [hours, minutes] = event.eventTime.split(':').map(Number);
  const hour = ((hours + 11) % 12) + 1;
  return `${day} · ${hour}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'ص' : 'م'}`;
}

/** Who is speaking: the instructors chosen, then a guest if there is one. */
export const eventSpeakers = (event: CommunityEventItem) =>
  [...(event.speakers || []).map(person => person.name), event.speaker].filter(Boolean).join('، ');

// The event as a calendar file, for whatever calendar the visitor already uses:
// at its hour when it has one (two hours long), else for the whole day.
export function downloadEventCalendar(event: CommunityEventItem) {
  if (!event.eventDate) return;
  const esc = (text: string) => String(text || '').replace(/([,;\\])/g, '\\$1').replace(/\r?\n/g, '\\n');
  const icsUtc = (ms: number) => `${new Date(ms).toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
  const utc = event.eventTime ? cairoInputToUtc(`${event.eventDate} ${event.eventTime}`) : '';
  const start = utc ? Date.parse(`${utc.replace(' ', 'T')}:00Z`) : NaN;
  const when = Number.isFinite(start)
    ? [`DTSTART:${icsUtc(start)}`, `DTEND:${icsUtc(start + 2 * 3600_000)}`]
    : [`DTSTART;VALUE=DATE:${event.eventDate.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${cairoDaysAhead(1, event.eventDate).replace(/-/g, '')}`];
  const where = event.isOnline === false ? event.locationName : event.platform;
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//mahadnafsy//community//AR',
    'BEGIN:VEVENT',
    `UID:community-${event.id}@mahadnafsy.com`,
    `DTSTAMP:${icsUtc(Date.now())}`,
    ...when,
    `SUMMARY:${esc(event.title)}`,
    `DESCRIPTION:${esc([event.description, eventSpeakers(event) && `المحاضر: ${eventSpeakers(event)}`,
      `https://mahadnafsy.com${eventPath(event)}`].filter(Boolean).join('\n'))}`,
    `LOCATION:${esc(where || '')}`,
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', `DESCRIPTION:${esc(event.title)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${event.title.slice(0, 40).replace(/[\\/:*?"<>|]/g, '') || 'event'}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
