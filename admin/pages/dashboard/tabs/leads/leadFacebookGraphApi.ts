import type { FacebookLeadAdsConfig, LeadItem, StaffMember } from '../../../../types';
import {
  leadFromFacebookGraphEntry,
  type FacebookGraphLeadEntry,
} from './leadCsvUtils';

export type FacebookLeadFormSummary = {
  id: string;
  name: string;
  status: string;
};

export async function fetchFacebookLeadForms(pageId: string, token: string): Promise<FacebookLeadFormSummary[]> {
  const url = `https://graph.facebook.com/v19.0/${pageId}/leadgen_forms?access_token=${encodeURIComponent(token)}&fields=id,name,status&limit=50`;
  const res = await fetch(url);
  const data = await res.json() as {
    data?: FacebookLeadFormSummary[];
    error?: { message: string };
  };
  if (data.error) throw new Error(data.error.message);
  return data.data || [];
}

export async function syncFacebookLeadAds(params: {
  config: FacebookLeadAdsConfig;
  leads: LeadItem[];
  staffMembers: StaffMember[];
  addLead: (lead: LeadItem) => void;
}): Promise<{ added: number; skipped: number; updatedConfig: FacebookLeadAdsConfig }> {
  const { config, leads, staffMembers, addLead } = params;
  const token = config.pageAccessToken.trim();
  let added = 0;
  let skipped = 0;

  for (const form of config.adForms.filter(f => f.enabled)) {
    let nextUrl: string | null =
      `https://graph.facebook.com/v19.0/${form.formId}/leads?fields=id,created_time,field_data&access_token=${encodeURIComponent(token)}&limit=100`;

    while (nextUrl) {
      const res = await fetch(nextUrl);
      const data = await res.json() as {
        data?: FacebookGraphLeadEntry[];
        paging?: { next?: string };
        error?: { message: string };
      };
      if (data.error) throw new Error(data.error.message);

      for (const entry of (data.data || [])) {
        const importedLead = leadFromFacebookGraphEntry(
          entry,
          form,
          config,
          leads,
          staffMembers.find(s => s.id === config.defaultAssignedSalesId)?.name || '',
        );
        if (!importedLead) {
          skipped++;
          continue;
        }
        addLead(importedLead);
        added++;
      }

      nextUrl = data.paging?.next || null;
    }
  }

  return {
    added,
    skipped,
    updatedConfig: {
      ...config,
      lastSyncAt: new Date().toISOString(),
      totalImported: (config.totalImported || 0) + added,
      updatedAt: new Date().toISOString(),
    },
  };
}
