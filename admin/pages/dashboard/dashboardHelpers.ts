/**
 * dashboardHelpers.ts — pure, state-free helpers extracted from Dashboard.tsx.
 */
import type { FacebookLeadAdsConfig } from '../../types';

/** Default/empty Facebook Lead Ads integration config. */
export const defaultFbDraft = (): FacebookLeadAdsConfig => ({
  enabled: false, pageId: '', pageAccessToken: '', appId: '', webhookVerifyToken: '',
  adForms: [], defaultLeadType: 'course', defaultStatus: 'new',
  defaultInterestedCourseId: '', defaultAssignedSalesId: '',
  autoSyncEnabled: false, totalImported: 0, updatedAt: '',
});

/**
 * lectureProgress is stored as { [lectureId]: percent } where 100 = complete.
 * It is keyed by lectureId (not courseId), so it passes through unchanged.
 */
export const normalizeLectureProgress = (
  _enrolledCourseIds: string[],
  currentMap: Record<string, number> = {},
): Record<string, number> => currentMap;
