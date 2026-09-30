// What each team's report table shows, in the words the owner used — shared by
// «تقارير الإدارة» and each team's own screen (api/lib/teamReports.js).
export type TeamKey = 'sales' | 'online' | 'support' | 'daqqi';
export type TeamColumn = { key: string; label: string; money?: boolean };

export const TEAM_LABELS: Record<TeamKey, string> = {
  sales: 'المبيعات', online: 'الأونلاين (التحصيل)', support: 'خدمة العملاء', daqqi: 'الدقي',
};

export const TEAM_COLUMNS: Record<TeamKey, TeamColumn[]> = {
  sales: [
    { key: 'calls', label: 'مكالمات' }, { key: 'whatsapp', label: 'واتساب' }, { key: 'leadsContacted', label: 'عملاء اتكلموا' },
    { key: 'newLeads', label: 'ليدز استلمها' }, { key: 'followUpsDue', label: 'متابعات' }, { key: 'followUpsOverdue', label: 'متأخرة' },
    { key: 'bookings', label: 'حجوزات' }, { key: 'installments', label: 'أقساط' }, { key: 'moneyEgp', label: 'الفلوس', money: true },
  ],
  online: [
    { key: 'calls', label: 'مكالمات' }, { key: 'whatsapp', label: 'واتساب' }, { key: 'reached', label: 'عملاء اتكلموا' },
    { key: 'clients', label: 'عملاء مسئول عنهم' }, { key: 'received', label: 'اتسلموا في الفترة' },
    { key: 'payments', label: 'دفعات' }, { key: 'installments', label: 'أقساط' },
    { key: 'collectedEgp', label: 'اللي اتحصّل', money: true }, { key: 'pendingReview', label: 'مستنية مراجعة' },
  ],
  support: [
    { key: 'calls', label: 'مكالمات' }, { key: 'whatsapp', label: 'واتساب' }, { key: 'clientsReviewed', label: 'عملاء راجعهم' },
    { key: 'problemsResolved', label: 'مشاكل حلها' }, { key: 'replies', label: 'ردود على مشاكل' },
    { key: 'certificatesHandled', label: 'شهادات اشتغل عليها' }, { key: 'ratings', label: 'تقييمات العملاء' },
    { key: 'ratingAvg', label: 'متوسط التقييم' }, { key: 'refundsEscalated', label: 'استردادات رفعها' },
  ],
  daqqi: [
    { key: 'calls', label: 'مكالمات' }, { key: 'whatsapp', label: 'واتساب' }, { key: 'newClients', label: 'عملاء جدد سجلهم' },
    { key: 'payments', label: 'دفعات سجلها' }, { key: 'moneyEgp', label: 'فلوس سجلها', money: true },
    { key: 'leadsReceived', label: 'ليدز استلمها' }, { key: 'leadsConverted', label: 'اتحولوا' },
  ],
};

// The headline of each team, above its table.
export const TEAM_TOTAL_LABELS: Record<TeamKey, Record<string, string>> = {
  sales: { newLeads: 'ليدز جديدة', newLeadsUnassigned: 'مستنية توزيع', calls: 'مكالمات', bookings: 'حجوزات', moneyEgp: 'فلوس (ج.م)', followUpsOverdue: 'متابعات متأخرة' },
  online: { clients: 'عملاء الفريق', received: 'اتوزعوا في الفترة', collectedEgp: 'اتحصّل (ج.م)', onlineMoneyEgp: 'كل دخل الأونلاين (ج.م)' },
  support: {
    problemsOpened: 'مشاكل جديدة', problemsResolved: 'اتحلت', problemsOpen: 'لسه مفتوحة',
    certificatesRequested: 'شهادات اتطلبت', certificatesIssued: 'اتصدرت', certificatesWaiting: 'مستنية',
    contactMessages: 'رسائل تواصل', consultationsRequested: 'طلبات استشارة', refundsRequested: 'طلبات استرداد',
    surveysSent: 'استبيانات رضا اتبعتت', surveysAnswered: 'اتردت',
  },
  daqqi: { newClients: 'عملاء جدد', allClients: 'كل عملاء الدقي', payments: 'دفعات', moneyEgp: 'فلوس (ج.م)', activeRounds: 'روندات شغالة' },
};

export const REPORT_RANGES = [
  { key: 'today', label: 'النهارده', days: 1, offset: 0 },
  { key: 'yesterday', label: 'أمس', days: 1, offset: 1 },
  { key: '7', label: '7 أيام', days: 7, offset: 0 },
  { key: '15', label: '15 يوم', days: 15, offset: 0 },
  { key: '30', label: '30 يوم', days: 30, offset: 0 },
] as const;
export type RangeKey = typeof REPORT_RANGES[number]['key'];

export const REPORT_NOTE = 'المكالمات والواتساب بتتحسب من «سجل التواصل» اللي الموظف بيسجله على العميل أو الليد — اللي مش بيسجل مكالماته بيظهر صفر. التحصيل بيتحسب لمسئول التحصيل بتاع العميل، والفلوس للسيلز بتاع العميل.';
