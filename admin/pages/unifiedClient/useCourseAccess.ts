import { useState } from 'react';
import { useSiteData } from '../../context/SiteDataContext';
import { mysqlAdmin } from '../../lib/mysqlapi';
import type { SubscriberItem, CourseAccessSetting } from '../../types';

/**
 * Per-course access-level editing for a subscriber (full / limited lecture limit),
 * with preset buttons + per-course save state. Extracted verbatim from
 * UnifiedClientPage; returns everything with identical names so the render is unchanged.
 */
export function useCourseAccess(subscriber?: SubscriberItem) {
  const { content, updateSubscriber } = useSiteData();
  const [accessSaving, setAccessSaving] = useState<Record<string, boolean>>({});
  const [accessMsg, setAccessMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  // per-course custom lecture limits for preset buttons (preset1=مقدم, preset2=أول قسط)
  const [accessPresets, setAccessPresets] = useState<Record<string, { p1: number; p2: number }>>({});
  const getPreset = (courseId: string) => accessPresets[courseId] ?? { p1: Number(content['access.videos_on_deposit'] || 20), p2: Number(content['access.videos_per_payment'] || 15) };
  // manual direct input for lecture limit per course
  const [manualLimitDraft, setManualLimitDraft] = useState<Record<string, string>>({});

  const applyAccessLevel = async (courseId: string, mode: 'full' | 'limited', lectureLimit?: number) => {
    if (!subscriber) return;
    setAccessSaving(p => ({ ...p, [courseId]: true }));
    setAccessMsg(p => ({ ...p, [courseId]: { ok: true, text: '' } }));
    try {
      await mysqlAdmin.updateEnrollmentAccess(subscriber.id, courseId, mode, lectureLimit);
      const updatedAccess: CourseAccessSetting = mode === 'full' ? { mode: 'full' } : { mode: 'limited', lectureLimit: lectureLimit ?? 1 };
      updateSubscriber({
        ...subscriber,
        courseAccess: { ...(subscriber.courseAccess ?? {}), [courseId]: updatedAccess },
      });
      setAccessMsg(p => ({ ...p, [courseId]: { ok: true, text: '✓ تم التحديث' } }));
      setTimeout(() => setAccessMsg(p => ({ ...p, [courseId]: { ok: true, text: '' } })), 2500);
    } catch {
      setAccessMsg(p => ({ ...p, [courseId]: { ok: false, text: '✗ فشل الحفظ' } }));
    } finally {
      setAccessSaving(p => ({ ...p, [courseId]: false }));
    }
  };

  return {
    accessSaving, setAccessSaving, accessMsg, setAccessMsg,
    accessPresets, setAccessPresets, getPreset,
    manualLimitDraft, setManualLimitDraft, applyAccessLevel,
  };
}
