import type { LeadStatus } from '../../../types';

// ── Default lead sources ─────────────────────────────────────────────────────
export const DEFAULT_SOURCES = [
  'واتساب', 'فيسبوك', 'إنستغرام', 'توصية', 'الموقع', 'شات الـAI', 'جوجل', 'تسجيل دخول', 'Google Sheet', 'أخرى',
];

// ── Online sources — excluded from CRM pipeline (belong to subscribers section) ─
// Add any new online-import source here to keep it out of CRM automatically
export const ONLINE_EXCLUDED_SOURCES = ['أونلاين 2025', 'تحويل من عملاء الأونلاين'];
export const isOnlineSource = (src?: string | null): boolean =>
  !!src && ONLINE_EXCLUDED_SOURCES.includes(src);

// ── Empty lead draft (shared default shape) ──────────────────────────────────
export const EMPTY_LEAD_DRAFT = {
  name: '',
  phone: '',
  email: '',
  notes: '',
  status: 'new' as LeadStatus,
  interestLevel: 'medium' as 'high' | 'medium' | 'low',
  source: '' as string,
  assignedSalesId: '' as string,
  autoAssign: true as boolean,
  tags: [] as string[],
  branch: '' as string,
};
