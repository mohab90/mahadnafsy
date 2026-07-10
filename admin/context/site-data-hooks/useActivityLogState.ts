import { useState } from 'react';
import type { ActivityLogItem, AuthUser } from '../../types';

export function nowLabel() {
  return new Date().toLocaleString('ar-EG-u-nu-latn', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// `track` is called by nearly every CRUD function across domains — kept as a single
// shared hook so all domain hooks can accept it as a plain parameter.
export function useActivityLogState(authUser: AuthUser | null | undefined, initialActivityLogs: ActivityLogItem[]) {
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>(initialActivityLogs);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistActivityLogToCollection = (_item: ActivityLogItem) => { /* PG-only */ };

  const track = (action: string, entity: string, label: string) => {
    const actor = authUser?.email || authUser?.uid || 'unknown';
    const actorName = authUser?.email?.split('@')[0] || actor;
    // Auto-derive section from entity
    const sectionMap: Record<string, string> = {
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
    const section = sectionMap[entity] || 'عام';
    const newLog = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      action,
      entity,
      label,
      at: nowLabel(),
      actor,
      actorName,
      section,
    };
    setActivityLogs((prev) => [newLog, ...prev]);
    persistActivityLogToCollection(newLog);
  };

  return { activityLogs, setActivityLogs, track };
}
