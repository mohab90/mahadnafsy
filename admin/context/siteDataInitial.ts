/**
 * Initial-state bootstrap for SiteDataContext, extracted to keep the provider lean.
 * Pure: reads localStorage + seed data only, no component state. Safe to unit-test.
 */
import { COURSES } from '../constants';
import { LeadItem, SubscriberItem } from '../types';
import { defaultContent, seedData } from './siteDataSeed';

export const STORAGE_KEY = 'mahad-admin-site-data-v1';
export const DATA_VERSION = 3; // bumped to clear seed bundles b1/b2/b3 from localStorage cache

// Computes the provider's initial state from localStorage cache (falling back to
// seed data), migrating legacy lead `source` formats and stripping stale fields.
export function computeInitialSiteData(): typeof seedData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return seedData;
    }
    const parsed = JSON.parse(raw);
    // Reject stale Firebase-era cache — force fresh MySQL fetch
    if (parsed._dataVersion !== DATA_VERSION) {
      localStorage.removeItem(STORAGE_KEY);
      return seedData;
    }
    // Migrate old-format source strings to structured fields
    const migratedLeads: LeadItem[] = (parsed.leads || seedData.leads).map((lead: LeadItem) => {
      if (!lead.source) return lead;
      // Old format: "طلب كورس - {courseTitle} - {branch}"
      if (lead.source.startsWith('طلب كورس - ')) {
        const withoutPrefix = lead.source.replace('طلب كورس - ', '');
        const lastDash = withoutPrefix.lastIndexOf(' - ');
        const courseTitle = lastDash > 0 ? withoutPrefix.slice(0, lastDash) : withoutPrefix;
        const branchRaw = lastDash > 0 ? withoutPrefix.slice(lastDash + 3) : '';
        const matchedCourse = COURSES.find((c) => c.title === courseTitle);
        return {
          ...lead,
          source: 'تسجيل اهتمام',
          leadType: 'course' as const,
          enrolledCourseId: matchedCourse?.id || lead.enrolledCourseId || '',
          branch: (branchRaw as LeadItem['branch']) || lead.branch,
        };
      }
      // Old format: "عرض الرئيسية - {branch}"
      if (lead.source.startsWith('عرض الرئيسية - ')) {
        const branchRaw = lead.source.replace('عرض الرئيسية - ', '');
        return { ...lead, source: 'عرض 24 ساعة', branch: (branchRaw as LeadItem['branch']) || lead.branch };
      }
      // Old format: "تسجيل حساب - ..."
      if (lead.source.startsWith('تسجيل حساب - ')) {
        return { ...lead, source: 'تسجيل دخول' };
      }
      return lead;
    });
    // Security migration: strip loginPassword from all leads
    const sanitizedLeads = migratedLeads.map(({ loginPassword: _pw, ...rest }: LeadItem & { loginPassword?: string }) => rest as LeadItem);
    const filteredLeads = sanitizedLeads;
    const allSubs: SubscriberItem[] = parsed.subscribers || seedData.subscribers;
    const filteredSubs = allSubs;
    // ── clientCode: do NOT assign codes locally from localStorage.
    // Codes are assigned server-side atomically. We pass data through unchanged;
    // the "تخصيص كود" button in Dashboard triggers the server to assign missing codes.
    const codedSubs = filteredSubs;
    const codedLeads = filteredLeads;
    return {
      ...seedData,
      ...parsed,
      leads: codedLeads,
      subscribers: codedSubs,
      content: { ...defaultContent, ...(parsed.content || {}) },
    } as typeof seedData;
  } catch {
    return seedData;
  }
}
