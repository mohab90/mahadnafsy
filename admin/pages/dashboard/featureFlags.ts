/**
 * featureFlags.ts — SaaS-style module toggles.
 * Flags persist in site_config under key 'features' (JSON). Disabling a feature
 * hides its whole menu group / items for everyone. Settings stays always visible
 * so an admin can re-enable. Keep the menu group/item keys in sync with navigation.tsx.
 */
import type { DashboardMenuGroup } from './navigation';

export type FeatureKey =
  | 'finance' | 'daqqi' | 'hr' | 'cx' | 'marketing' | 'lms'
  | 'analytics' | 'consultations' | 'community';

export const FEATURE_DEFS: { key: FeatureKey; label: string; desc: string; groups?: string[]; items?: string[] }[] = [
  { key: 'finance',       label: 'الحسابات والمالية',        desc: 'النظام المحاسبي، التقارير، الطلبات',       groups: ['finance'] },
  { key: 'daqqi',         label: 'فرع الدقي',                desc: 'الجدول، الحضور، عملاء وفريق الدقي',         groups: ['daqqi'] },
  { key: 'hr',            label: 'الموارد البشرية',          desc: 'HR، الموظفون، الرواتب',                    items: ['hr_hub'] },
  { key: 'cx',            label: 'خدمة العملاء',             desc: 'التذاكر، الاستردادات، الشهادات',            groups: ['cx_group'] },
  { key: 'marketing',     label: 'التسويق',                  desc: 'الحملات ومركز التسويق',                    groups: ['marketing'] },
  { key: 'lms',           label: 'المحتوى التعليمي (LMS)',   desc: 'الكورسات، المحاضرات، الباقات',             groups: ['site_content'] },
  { key: 'analytics',     label: 'التحليلات والمؤشرات',      desc: 'KPIs، NPS، مصادر الإيراد',                items: ['analytics_hub'] },
  { key: 'consultations', label: 'الاستشارات',               desc: 'حجوزات وتقويم الاستشارات',                 items: ['consultations', 'consultation_calendar'] },
  { key: 'community',     label: 'المجتمع',                  desc: 'إدارة مجتمع الطلاب',                       items: ['community'] },
];

export const DEFAULT_FEATURES: Record<FeatureKey, boolean> = {
  finance: true, daqqi: true, hr: true, cx: true, marketing: true,
  lms: true, analytics: true, consultations: true, community: true,
};

/** Read+merge the flags from the loaded site_config content. */
export function parseFeatures(content: Record<string, string>): Record<FeatureKey, boolean> {
  try {
    const raw = content['features'] ? JSON.parse(content['features']) : {};
    return { ...DEFAULT_FEATURES, ...raw };
  } catch {
    return { ...DEFAULT_FEATURES };
  }
}

/** Remove menu groups/items whose feature is disabled; drop now-empty groups. */
export function filterMenuByFeatures(
  groups: DashboardMenuGroup[],
  flags: Record<string, boolean>,
): DashboardMenuGroup[] {
  const offGroups = new Set(FEATURE_DEFS.filter(f => flags[f.key] === false).flatMap(f => f.groups || []));
  const offItems = new Set(FEATURE_DEFS.filter(f => flags[f.key] === false).flatMap(f => f.items || []));
  return groups
    .filter(g => !offGroups.has(g.key))
    .map(g => ({ ...g, items: g.items.filter(it => !offItems.has(it.key)) }))
    .filter(g => g.items.length > 0);
}
