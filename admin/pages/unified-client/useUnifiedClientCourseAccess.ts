import { useState } from 'react';
import { mysqlAdmin } from '../../lib/mysqlapi';
import type { SubscriberItem } from '../../types';

interface Params {
  subscriber?: SubscriberItem;
  content: Record<string, string>;
  reloadSubscribers: () => Promise<unknown>;
}

export function useUnifiedClientCourseAccess({ subscriber, content, reloadSubscribers }: Params) {
  const [showAccessModal, setShowAccessModal] = useState(false);
  const [showGrantFromCourses, setShowGrantFromCourses] = useState(false);
  const [grantFromCourseId, setGrantFromCourseId] = useState('');
  const [accessSaving, setAccessSaving] = useState<Record<string, boolean>>({});
  const [accessMsg, setAccessMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [accessPresets, setAccessPresets] = useState<Record<string, { p1: number; p2: number }>>({});
  const [manualLimitDraft, setManualLimitDraft] = useState<Record<string, string>>({});
  const getPreset = (courseId: string) => accessPresets[courseId] ?? {
    p1: Number(content['access.videos_on_deposit'] || 20),
    p2: Number(content['access.videos_per_payment'] || 15),
  };

  const applyAccessLevel = async (
    courseId: string,
    mode: 'full' | 'limited',
    lectureLimit?: number,
  ) => {
    if (!subscriber) return;
    setAccessSaving(current => ({ ...current, [courseId]: true }));
    setAccessMsg(current => ({ ...current, [courseId]: { ok: true, text: '' } }));
    try {
      await mysqlAdmin.updateEnrollmentAccess(subscriber.id, courseId, mode, lectureLimit);
      await reloadSubscribers();
      setAccessMsg(current => ({ ...current, [courseId]: { ok: true, text: '✓ تم التحديث' } }));
      window.setTimeout(() => {
        setAccessMsg(current => ({ ...current, [courseId]: { ok: true, text: '' } }));
      }, 2500);
    } catch {
      setAccessMsg(current => ({ ...current, [courseId]: { ok: false, text: '✗ فشل الحفظ' } }));
    } finally {
      setAccessSaving(current => ({ ...current, [courseId]: false }));
    }
  };

  return {
    showAccessModal, setShowAccessModal,
    showGrantFromCourses, setShowGrantFromCourses, grantFromCourseId, setGrantFromCourseId,
    accessSaving, accessMsg, accessPresets, setAccessPresets,
    manualLimitDraft, setManualLimitDraft, getPreset, applyAccessLevel,
  };
}
