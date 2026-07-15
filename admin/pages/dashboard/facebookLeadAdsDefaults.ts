import type { FacebookLeadAdsConfig } from '../../types';

export function defaultFacebookLeadAdsConfig(): FacebookLeadAdsConfig {
  return {
    enabled: false,
    pageId: '',
    pageAccessToken: '',
    appId: '',
    webhookVerifyToken: '',
    adForms: [],
    defaultLeadType: 'course',
    defaultStatus: 'new',
    defaultInterestedCourseId: '',
    defaultAssignedSalesId: '',
    autoSyncEnabled: false,
    totalImported: 0,
    updatedAt: '',
  };
}
