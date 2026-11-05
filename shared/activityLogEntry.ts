import { CAIRO_TIME_ZONE } from './cairoDate';

/**
 * One entry of the activity log, built the same way by the admin panel and the public site (they each carried this word for word, 5 Nov 2026):
 * who did it (the signed-in account's address, or its id), when (Cairo's clock), and the section of the panel the entity belongs to.
 */
function nowLabel() {
  return new Date().toLocaleString('ar-EG-u-nu-latn', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: CAIRO_TIME_ZONE});
}

const SECTION_OF_ENTITY: Record<string, string> = {
  course: 'إدارة الأكاديمية', lecture: 'إدارة الأكاديمية', chapter: 'إدارة الأكاديمية',
  bundle: 'إدارة الأكاديمية', quiz: 'إدارة الأكاديمية', live_stream: 'إدارة الأكاديمية',
  institute_gallery: 'إدارة الأكاديمية', testimonial: 'إدارة الأكاديمية',
  subscriber: 'إدارة العملاء', lead: 'إدارة العملاء', clientCode: 'إدارة العملاء',
  consultation: 'الاستشارات', therapist: 'المحاضرون',
  order: 'المالية', financial: 'المالية', discount: 'المالية',
  staff: 'إدارة الفريق', content: 'إعدادات الموقع',
  community_post: 'المجتمع', community_library: 'المجتمع',
  community_video: 'المجتمع', community_event: 'المجتمع',
};

export function buildActivityLog(
  authUser: { email?: string | null; uid?: string | null } | null | undefined,
  action: string, entity: string, label: string,
) {
  const actor = authUser?.email || authUser?.uid || 'unknown';
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    action,
    entity,
    label,
    at: nowLabel(),
    actor,
    actorName: authUser?.email?.split('@')[0] || actor,
    section: SECTION_OF_ENTITY[entity] || 'عام',
  };
}
