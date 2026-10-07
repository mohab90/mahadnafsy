/**
 * MASTER PERMISSIONS CONSTANTS — Frontend
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for ALL role/permission logic in the admin panel.
 * Dashboard.tsx, StaffProfile.tsx and any other page MUST import from here.
 * Backend equivalent: api/constants/permissions.js (keep in sync manually).
 */

// ── 1. ROLES ──────────────────────────────────────────────────────────────────
export const ROLES = {
  ADMIN:                    'admin',
  MANAGER:                  'manager',
  ONLINE_MANAGER:           'online_manager',
  SALES_COLLECTION_MANAGER: 'sales_collection_manager',
  SALES:                    'sales',
  COLLECTION:               'collection',
  SUPPORT:                  'support',
  DAQQI_MANAGER:            'daqqi_manager',
  RECEPTION_DAQQI:          'reception_daqqi',
  // The same two jobs at the Tagamoa branch (api/lib/physicalBranches.js).
  TAGAMOA_MANAGER:          'tagamoa_manager',
  RECEPTION_TAGAMOA:        'reception_tagamoa',
  HR:                       'hr',
  ACCOUNTANT:               'accountant',
  CONSULTANT:               'consultant',
  EXPERT:                   'expert',
  TRAINER:                  'trainer',
  INSTRUCTOR:               'instructor',
  OTHER:                    'other',
} as const;

export type RoleKey = typeof ROLES[keyof typeof ROLES];

// ── 2. ROLE LABELS (Arabic) ───────────────────────────────────────────────────
export const ROLE_LABELS: Record<RoleKey, string> = {
  admin:                    'مسؤول النظام',
  manager:                  'مدير عام',
  online_manager:           'مدير الأونلاين',
  sales_collection_manager: 'مدير المبيعات والتحصيل',
  sales:                    'مسئول مبيعات',
  collection:               'مسئول تحصيل',
  support:                  'خدمة عملاء',
  daqqi_manager:            'مدير الدقي',
  reception_daqqi:          'ريسبشن الدقي',
  tagamoa_manager:          'مدير التجمع',
  reception_tagamoa:        'ريسبشن التجمع',
  hr:                       'موارد بشرية',
  accountant:               'محاسب',
  consultant:               'مستشار',
  expert:                   'خبير',
  trainer:                  'مدرب',
  instructor:               'محاضر',
  other:                    'موظف',
};

// ── 3. PERMISSIONS ────────────────────────────────────────────────────────────
export const PERMISSIONS = {
  VIEW_DASHBOARD:           'view_dashboard',
  VIEW_LEADS:               'view_leads',
  MANAGE_LEADS:             'manage_leads',
  DELETE_LEADS:             'delete_leads',
  EXPORT_LEADS:             'export_leads',
  VIEW_SUBSCRIBERS:         'view_subscribers',
  MANAGE_SUBSCRIBERS:       'manage_subscribers',
  DELETE_SUBSCRIBERS:       'delete_subscribers',
  EXPORT_SUBSCRIBERS:       'export_subscribers',
  VIEW_COURSES:             'view_courses',
  MANAGE_COURSES:           'manage_courses',
  MANAGE_LECTURES:          'manage_lectures',
  MANAGE_INSTRUCTORS:       'manage_instructors',
  MANAGE_BUNDLES:           'manage_bundles',
  MANAGE_TESTIMONIALS:      'manage_testimonials',
  MANAGE_DISCOUNTS:         'manage_discounts',
  VIEW_CONSULTATIONS:       'view_consultations',
  MANAGE_CONSULTATIONS:     'manage_consultations',
  VIEW_COMMUNITY:           'view_community',
  MANAGE_COMMUNITY:         'manage_community',
  VIEW_STAFF:               'view_staff',
  MANAGE_STAFF:             'manage_staff',
  VIEW_HR:                  'view_hr',
  MANAGE_HR:                'manage_hr',
  VIEW_ORDERS:              'view_orders',
  MANAGE_ORDERS:            'manage_orders',
  MANAGE_PAYMENTS:          'manage_payments',
  SET_CLIENT_PRICE:         'set_client_price',
  APPROVE_REFUNDS:          'approve_refunds',
  VIEW_FINANCIAL:           'view_financial',
  MANAGE_FINANCIAL:         'manage_financial',
  VIEW_REPORTS:             'view_reports',
  VIEW_ACTIVITY:            'view_activity',
  MANAGE_SALES_TEAM:        'manage_sales_team',
  MANAGE_CERTIFICATES:      'manage_certificates',
  MANAGE_INBOX:             'manage_inbox',
  MANAGE_NOTIFICATIONS:     'manage_notifications',
  MANAGE_CHANNEL_SETTINGS:  'manage_channel_settings',
  BULK_WHATSAPP:            'bulk_whatsapp',
  VIEW_JOIN_US:             'view_join_us',
  MANAGE_JOIN_US:           'manage_join_us',
  VIEW_CONTACTS:            'view_contacts',
  MANAGE_CONTACTS:          'manage_contacts',
  MANAGE_CONTENT:           'manage_content',
  MANAGE_DAQQI:             'manage_daqqi',
  VIEW_CLIENT_DB:           'view_client_db',
  ASK_AI:                   'ask_ai',
  MANAGE_AI_SETTINGS:       'manage_ai_settings',
  AI_DEV:                   'ai_dev',
  MANAGE_AUTOMATION:        'manage_automation',
  VIEW_SECURITY:            'view_security',
  MANAGE_SECURITY:          'manage_security',
  VIEW_SETTINGS:            'view_settings',
  MANAGE_SETTINGS:          'manage_settings',
  // One department's team and how it is doing, without the department itself.
  // See the note in api/constants/permissions.js — the two registries are
  // pinned to each other by test.
  VIEW_PERF_SALES:          'view_perf_sales',
  VIEW_PERF_ONLINE:         'view_perf_online',
  VIEW_PERF_DAQQI:          'view_perf_daqqi',
  VIEW_PERF_CX:             'view_perf_cx',
} as const;

export type PermissionKey = typeof PERMISSIONS[keyof typeof PERMISSIONS];

// ── 4. PERMISSION LABELS (Arabic) ─────────────────────────────────────────────
export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  view_dashboard:          'عرض الداشبورد',
  view_leads:              'عرض الليدات (قراءة)',
  manage_leads:            'إدارة الليدات (تعديل)',
  delete_leads:            'حذف الليدات',
  export_leads:            'تصدير الليدات',
  view_subscribers:        'عرض عملاء الأونلاين (قراءة)',
  manage_subscribers:      'إدارة عملاء الأونلاين (تعديل)',
  delete_subscribers:      'حذف عملاء الأونلاين',
  export_subscribers:      'تصدير عملاء الأونلاين',
  view_courses:            'عرض الكورسات',
  manage_courses:          'إدارة الكورسات',
  manage_lectures:         'إدارة المحاضرات',
  manage_instructors:      'إدارة المحاضرين',
  manage_bundles:          'إدارة المسارات',
  manage_testimonials:     'إدارة التقييمات',
  manage_discounts:        'إدارة الخصومات',
  view_consultations:      'عرض الاستشارات',
  manage_consultations:    'إدارة الاستشارات',
  view_community:          'عرض المجتمع',
  manage_community:        'إدارة المجتمع',
  view_staff:              'عرض فريق العمل',
  manage_staff:            'إدارة فريق العمل',
  view_hr:                 'عرض الموارد البشرية',
  manage_hr:               'إدارة الموارد البشرية',
  view_perf_sales:         'أداء فريق المبيعات فقط (بدون تفاصيل القسم)',
  view_perf_online:        'أداء فريق الأونلاين فقط (بدون تفاصيل القسم)',
  view_perf_daqqi:         'أداء فريق الدقي فقط (بدون تفاصيل القسم)',
  view_perf_cx:            'أداء فريق خدمة العملاء فقط (بدون تفاصيل القسم)',
  view_orders:             'عرض الطلبات',
  manage_orders:           'إدارة الطلبات',
  manage_payments:         'تسجيل وتعديل المدفوعات',
  set_client_price:        'تحديد سعر مختلف للعميل في الحجز',
  approve_refunds:         'اعتماد أو رفض الاستردادات',
  view_financial:          'عرض المالية',
  manage_financial:        'إدارة المالية',
  view_reports:            'عرض التقارير',
  view_activity:           'عرض سجل النشاط',
  manage_sales_team:       'إدارة فريق المبيعات (التارجت والعروض)',
  manage_certificates:     'الشهادات (الأسعار والطلبات)',
  manage_inbox:            'إدارة الرسائل الواردة',
  manage_notifications:    'إدارة الإشعارات',
  manage_channel_settings: 'إعدادات قنوات التواصل',
  bulk_whatsapp:           'إرسال واتساب جماعي',
  view_join_us:            'عرض طلبات الانضمام',
  manage_join_us:          'إدارة طلبات الانضمام',
  view_contacts:           'عرض رسائل التواصل',
  manage_contacts:         'إدارة رسائل التواصل',
  manage_content:          'إدارة محتوى الموقع',
  manage_daqqi:            'إدارة الدقي',
  view_client_db:          'قاعدة بيانات العملاء الموحدة',
  ask_ai:                  'استخدام الذكاء الاصطناعي',
  manage_ai_settings:      'إعدادات الذكاء الاصطناعي',
  ai_dev:                  'وضع تطوير الذكاء الاصطناعي',
  manage_automation:       'إدارة الأتمتة',
  view_security:           'عرض الأمن والمراقبة',
  manage_security:         'إدارة الأمن والمراقبة',
  view_settings:           'عرض إعدادات النظام',
  manage_settings:         'إدارة إعدادات النظام',
};

// ── 5. PERMISSION CATEGORIES (for StaffProfile UI) ────────────────────────────
export const PERMISSION_CATEGORIES: { label: string; perms: PermissionKey[] }[] = [
  {
    label: 'الليدات (العملاء المحتملون)',
    perms: ['view_leads', 'manage_leads', 'export_leads', 'delete_leads'],
  },
  {
    label: 'عملاء الأونلاين',
    perms: ['view_subscribers', 'manage_subscribers', 'export_subscribers', 'delete_subscribers'],
  },
  {
    label: 'الطلبات والمالية',
    perms: ['view_orders', 'manage_orders', 'manage_payments', 'set_client_price', 'approve_refunds', 'view_financial', 'manage_financial'],
  },
  {
    label: 'الكورسات والمحتوى التعليمي',
    perms: ['view_courses', 'manage_courses', 'manage_lectures', 'manage_instructors', 'manage_bundles', 'manage_discounts'],
  },
  {
    label: 'الاستشارات والمجتمع',
    perms: ['view_consultations', 'manage_consultations', 'view_community', 'manage_community'],
  },
  {
    label: 'التقارير والتحليلات',
    perms: ['view_reports', 'view_activity', 'view_client_db'],
  },
  {
    label: 'إدارة المبيعات',
    perms: ['manage_sales_team'],
  },
  {
    // Each team's figures without the team's screen: how the HR manager reads
    // Dokki, online and customer service. Added with those screens and never
    // listed here, so the one grid that hands permissions out could not.
    label: 'أداء الفرق',
    perms: ['view_perf_sales', 'view_perf_online', 'view_perf_daqqi', 'view_perf_cx'],
  },
  {
    label: 'الشهادات',
    perms: ['manage_certificates'],
  },
  {
    label: 'فريق العمل والموارد البشرية',
    perms: ['view_staff', 'manage_staff', 'view_hr', 'manage_hr', 'view_join_us', 'manage_join_us', 'view_contacts', 'manage_contacts'],
  },
  {
    label: 'المراسلات والإشعارات',
    perms: ['manage_inbox', 'manage_notifications', 'manage_channel_settings', 'bulk_whatsapp'],
  },
  {
    label: 'إدارة الدقي',
    perms: ['manage_daqqi'],
  },
  {
    label: 'محتوى الموقع',
    perms: ['manage_content', 'manage_testimonials'],
  },
  {
    label: 'الذكاء الاصطناعي والأتمتة',
    perms: ['ask_ai', 'manage_ai_settings', 'ai_dev', 'manage_automation', 'view_security', 'manage_security', 'view_settings', 'manage_settings'],
  },
];

// ── 6. ROLE DEFAULT PERMISSIONS ───────────────────────────────────────────────
// '*' = wildcard (full access). Keep in sync with api/constants/permissions.js
export const ROLE_DEFAULT_PERMISSIONS: Record<RoleKey, PermissionKey[] | '*'> = {
  admin:                    '*',
  manager:                  '*',
  online_manager: [
    'view_dashboard',
    'view_leads', 'manage_leads', 'export_leads',
    'view_subscribers', 'manage_subscribers', 'export_subscribers',
    'view_orders', 'manage_orders', 'manage_payments', 'set_client_price', 'approve_refunds',
    'view_financial', 'manage_financial', 'view_reports', 'view_activity',
    'manage_sales_team',
    'view_staff', 'view_client_db',
    'view_courses', 'manage_courses', 'manage_lectures',
    'view_consultations', 'manage_consultations',
    'manage_inbox', 'manage_notifications', 'bulk_whatsapp', 'ask_ai',
  ],
  daqqi_manager: [
    'view_dashboard',
    'view_leads', 'manage_leads', 'export_leads',
    'view_subscribers', 'manage_subscribers', 'export_subscribers',
    'view_orders', 'manage_orders', 'manage_payments', 'set_client_price', 'approve_refunds',
    'view_financial', 'manage_financial', 'view_reports', 'view_activity',
    'manage_sales_team',
    'view_staff', 'view_client_db',
    'view_consultations', 'manage_consultations',
    'manage_inbox', 'manage_notifications', 'manage_daqqi', 'bulk_whatsapp',
    'manage_certificates',
  ],

  // No delete_leads: deleting a client is reserved for admin and manager. See
  // the note on this role in api/constants/permissions.js — the two sides are
  // pinned to each other by test, so the rule cannot hold on one side only.
  sales_collection_manager: [
    'view_dashboard',
    'view_leads', 'manage_leads', 'export_leads',
    'view_subscribers', 'manage_subscribers', 'export_subscribers',
    'view_orders', 'manage_orders', 'manage_payments', 'set_client_price', 'approve_refunds',
    'view_financial', 'manage_financial',
    'view_reports', 'view_activity',
    'manage_sales_team',
    'view_staff',
    'view_client_db',
    'manage_inbox', 'manage_notifications',
    'bulk_whatsapp',
    'ask_ai',
  ],

  sales: [
    'view_dashboard',
    'view_leads', 'manage_leads', 'export_leads', 'bulk_whatsapp',
    'view_subscribers',
    'view_orders',
    // Mirrors api/constants/permissions.js — see the note there for why a rep
    // can hold this without manage_financial. The two lists must stay
    // identical; api/tests/permissionMatrixParity.test.js fails if they drift,
    // because a menu built from one and a route guarded by the other is how a
    // tab opens and the server refuses.
    'manage_payments',
    'view_consultations',
    'manage_inbox', 'manage_notifications',
    'ask_ai',
  ],

  collection: [
    'view_dashboard',
    // Mirrors api/constants/permissions.js — see the note there.
    'view_leads', 'manage_leads',
    'view_subscribers', 'manage_subscribers', 'export_subscribers',
    'view_orders', 'manage_orders', 'manage_payments', 'approve_refunds',
    'view_financial', 'manage_financial',
    'view_reports',
    'view_client_db',
    'manage_inbox', 'manage_notifications',
    'bulk_whatsapp',
    'ask_ai',
  ],

  support: [
    'view_dashboard',
    // Mirrors api/constants/permissions.js — see the note there.
    'view_subscribers', 'manage_subscribers',
    // The whole client database: a caller is looked up among every client,
    // lead, archive and site sign-up, not only among the subscribers.
    'view_client_db',
    'view_orders', 'manage_payments',
    'manage_daqqi',
    'manage_inbox',
    'manage_certificates',
    'view_consultations', 'manage_consultations',
    'view_contacts', 'manage_contacts',
    'bulk_whatsapp',
    'ask_ai',
  ],

  reception_daqqi: [
    'view_dashboard',
    'manage_payments',
    'view_leads', 'manage_leads',
    'view_subscribers', 'manage_subscribers',
    'view_orders', 'manage_orders',
    'manage_inbox',
    'manage_daqqi',
  ],

  hr: [
    'view_dashboard',
    'manage_payments',
    'view_staff', 'manage_staff', 'view_hr', 'manage_hr',
    'view_reports', 'view_activity',
    'view_join_us', 'manage_join_us',
    'view_contacts', 'manage_contacts',
    'ask_ai',
  ],

  accountant: [
    'view_dashboard',
    'view_orders', 'manage_orders', 'manage_payments', 'approve_refunds',
    'view_financial', 'manage_financial',
    'view_reports',
    'manage_inbox', 'manage_notifications',
  ],

  consultant: [
    'view_dashboard',
    'manage_payments',
    'view_consultations', 'manage_consultations',
    'view_subscribers',
    'view_leads',
    'view_reports',
  ],

  trainer: [
    'view_dashboard',
    'manage_payments',
    'view_courses', 'manage_lectures',
    'view_consultations', 'manage_consultations',
  ],

  expert: [
    'view_dashboard',
    'manage_payments',
    'view_courses',
    'view_consultations',
    // No view_subscribers — mirrors api/constants/permissions.js. The role's
    // data scope is 'none', so it returned nothing and only put an empty
    // «عملاء الأونلاين» in the sidebar.
    'view_reports',
  ],

  instructor: [
    'view_dashboard',
    'manage_payments',
    'view_courses', 'manage_lectures',
    'view_consultations', 'manage_consultations',
  ],

  other: [
    'view_dashboard',
    'manage_payments',
  ],
  // Exactly the Dokki jobs' permissions, filled in just below.
  tagamoa_manager: [],
  reception_tagamoa: [],
};
ROLE_DEFAULT_PERMISSIONS.tagamoa_manager = [...(ROLE_DEFAULT_PERMISSIONS.daqqi_manager as PermissionKey[])];
ROLE_DEFAULT_PERMISSIONS.reception_tagamoa = [...(ROLE_DEFAULT_PERMISSIONS.reception_daqqi as PermissionKey[])];


// ── 7. DATA SCOPE PER ROLE ────────────────────────────────────────────────────
// Controls what rows the server returns from the unified /api/staff/subscribers endpoint.
export type DataScope = 'all' | 'assigned_sales' | 'assigned_cs' | 'none' | `branch:${string}`;

export const ROLE_DATA_SCOPE: Record<RoleKey, DataScope> = {
  admin:                    'all',
  manager:                  'all',
  online_manager:           'all',
  sales_collection_manager: 'all',
  daqqi_manager:            'branch:DAQQI',
  reception_daqqi:          'branch:DAQQI',
  tagamoa_manager:          'branch:TAGAMOA',
  reception_tagamoa:        'branch:TAGAMOA',
  sales:                    'assigned_sales',
  collection:               'assigned_cs',
  support:                  'all',
  hr:                       'none',
  accountant:               'all',
  consultant:               'assigned_sales',
  expert:                   'none',
  trainer:                  'none',
  instructor:               'none',
  other:                    'none',
};

// ── 8. FULL-ACCESS ROLES ──────────────────────────────────────────────────────
export const FULL_ACCESS_ROLES: RoleKey[] = [
  'admin', 'manager',
];

// ── 8b. RUNTIME ROLE OVERRIDES (editable from Settings → RBAC) ─────────────────
// Admins customize per-role default permissions from the UI; stored in site_config
// (key 'rbac.roleOverrides') and applied here at runtime. Full-access roles are
// NEVER restricted this way, so an admin can never lock themselves out.
let _roleOverrides: Partial<Record<RoleKey, PermissionKey[]>> = {};

export function setRoleOverrides(o: Partial<Record<RoleKey, PermissionKey[]>> | null | undefined): void {
  _roleOverrides = o && typeof o === 'object' ? o : {};
}

/** Role defaults after applying settings overrides (full-access roles stay untouched). */
export function getEffectiveRoleDefaults(role: RoleKey): PermissionKey[] | '*' {
  if (FULL_ACCESS_ROLES.includes(role)) return ROLE_DEFAULT_PERMISSIONS[role];
  const override = _roleOverrides[role];
  if (Array.isArray(override)) return override;
  return ROLE_DEFAULT_PERMISSIONS[role] ?? [];
}

// ── 9. HELPER: resolve effective permissions for a staff member ───────────────
/**
 * Returns the effective permissions for a staff member.
 * Priority: custom per-staff DB override > settings role override > role defaults.
 */
export function resolvePermissions(staff: {
  role: RoleKey;
  permissions?: PermissionKey[] | null;
}): PermissionKey[] | '*' {
  // A stored list is the override, empty included: an emptied grid means none,
  // and the API resolves it the same way. Null or absent means no override, so
  // the role's defaults apply — the two used to be one case here, which made
  // "revoke everything" read as "use the role defaults" on both sides.
  if (Array.isArray(staff.permissions)) return staff.permissions;
  return getEffectiveRoleDefaults(staff.role);
}

/**
 * Returns true if the staff member has the given permission.
 */
export function hasPermission(
  staff: { role: RoleKey; permissions?: PermissionKey[] } | null | undefined,
  permission: PermissionKey,
): boolean {
  if (!staff) return false;
  if (FULL_ACCESS_ROLES.includes(staff.role)) return true;
  const perms = resolvePermissions(staff);
  if (perms === '*') return true;
  return perms.includes(permission);
}

// The two message screens go by the job, not by the permission grid: «اي سيلز
// لازم يكون شغاله عنده صندوق البريد والواتس اب عشان في سيلز مش شغال عتدهم … اما
// مسئول التحصيل يظهرله واتسابي فقط انما صندوق البريد لا». Three reps' own grids
// (Donia Wael, Rawan Tamer, Shimaa Abid on 7 Oct) had lost manage_inbox, and
// both screens refused them. Everyone else still needs manage_inbox.
export function canUseChannel(
  staff: { role: RoleKey; permissions?: PermissionKey[] } | null | undefined,
  channel: 'inbox' | 'whatsapp',
): boolean {
  const role = String(staff?.role || '').toLowerCase();
  if (role === 'sales') return true;
  if (role === 'collection') return channel === 'whatsapp';
  return hasPermission(staff, 'manage_inbox' as PermissionKey);
}

/**
 * Returns default permissions as a plain array (never '*').
 * Useful for UI forms that need to pre-fill checkboxes.
 * Full-access roles return every known permission key.
 */
export function getDefaultPermsArray(role: string): PermissionKey[] {
  const def = ROLE_DEFAULT_PERMISSIONS[role as RoleKey];
  if (!def || def === '*') return Object.values(PERMISSIONS) as PermissionKey[];
  return def as PermissionKey[];
}
