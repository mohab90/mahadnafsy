import { useState } from 'react';
import { useSiteData } from '../../context/SiteDataContext';
import { handleFetchFbFormsFn, handleFbApiSyncFn } from './dashboardCsvFbHandlers';
import { defaultFbDraft } from './dashboardHelpers';
import type { FacebookLeadAdsConfig } from '../../types';

/**
 * Facebook Lead Ads integration: the config draft + connect panel, fetching the
 * available lead forms from the Graph API, syncing leads in, and saving the
 * config. The handler bodies already live in ./dashboardCsvFbHandlers; this hook
 * owns the self-contained state and wires them. Extracted verbatim from
 * Dashboard; returns identical names so the render JSX is unchanged.
 */
export function useFacebookLeadAds() {
  const { leads, addLead, staffMembers, fbLeadAdsConfig, setFbLeadAdsConfig } = useSiteData();

  const [fbDraft, setFbDraft] = useState<FacebookLeadAdsConfig>(() => fbLeadAdsConfig || defaultFbDraft());
  const [fbIntegOpen, setFbIntegOpen] = useState(false);
  const [fbSyncLoading, setFbSyncLoading] = useState(false);
  const [fbSyncNotice, setFbSyncNotice] = useState('');
  const [fbFormsLoading, setFbFormsLoading] = useState(false);
  const [fbAvailableForms, setFbAvailableForms] = useState<{ id: string; name: string; status: string }[]>([]);

  // Facebook Lead Ads: Fetch available forms from Graph API
  const handleFetchFbForms = async () => {
    await handleFetchFbFormsFn({ fbDraft, setFbSyncNotice, setFbFormsLoading, setFbAvailableForms });
  };
  // Facebook Lead Ads: Sync leads from Graph API
  const handleFbApiSync = async () => {
    await handleFbApiSyncFn({ fbDraft, leads, addLead, staffMembers, fbLeadAdsConfig, setFbLeadAdsConfig, setFbDraft, setFbSyncLoading, setFbSyncNotice });
  };
  const handleSaveFbConfig = () => {
    setFbLeadAdsConfig({ ...fbDraft, updatedAt: new Date().toISOString() });
    setFbSyncNotice('✅ تم حفظ الإعدادات.');
    setTimeout(() => setFbSyncNotice(''), 3000);
  };

  return {
    fbDraft, setFbDraft, fbIntegOpen, setFbIntegOpen,
    fbSyncLoading, setFbSyncLoading, fbSyncNotice, setFbSyncNotice,
    fbFormsLoading, setFbFormsLoading, fbAvailableForms, setFbAvailableForms,
    handleFetchFbForms, handleFbApiSync, handleSaveFbConfig,
  };
}
