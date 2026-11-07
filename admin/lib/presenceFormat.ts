/**
 * «مين فاتح السيستم دلوقتي»: how the presence screen words a time and a state (the thresholds are the server's: lib/staffPresence.js).
 */

export type PresenceStatus = 'online' | 'idle' | 'offline';

export const STATUS_LABELS: Record<PresenceStatus, string> = { online: 'أونلاين', idle: 'خامل', offline: 'غير متصل' };

// Egyptian Arabic counts: one and two have their own words, 3–10 take the plural, 11 and over the singular.
function counted(n: number, one: string, two: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  return n <= 10 ? `${n} ${few}` : `${n} ${many}`;
}

/** «دلوقتي» · «من دقيقة» · «من 7 دقايق» · «من ساعة» · «من يومين», from how long ago in milliseconds. */
export function agoAr(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return 'دلوقتي';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `من ${counted(minutes, 'دقيقة', 'دقيقتين', 'دقايق', 'دقيقة')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `من ${counted(hours, 'ساعة', 'ساعتين', 'ساعات', 'ساعة')}`;
  return `من ${counted(Math.floor(hours / 24), 'يوم', 'يومين', 'أيام', 'يوم')}`;
}

/** «من 7 دقايق» for an ISO time against `now`, or «—» when there is none. */
export function agoFrom(iso: string | null | undefined, now: number): string {
  if (!iso) return '—';
  const at = new Date(iso).getTime();
  return Number.isFinite(at) ? agoAr(now - at) : '—';
}
