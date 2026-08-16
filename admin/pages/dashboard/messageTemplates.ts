/**
 * Message-template definitions for the Settings editor. Keys, variables, and
 * default texts MUST stay in sync with api/lib/messageTemplates.js (the backend
 * renders these for the automated WhatsApp crons). Edits are saved to the content
 * blob under key `msg.templates` (JSON: { key: text }) via setContentValue.
 */
export type MsgTemplateDef = {
  key: string;
  label: string;
  desc: string;
  vars: { name: string; sample: string }[];
  default: string;
};

export const TEMPLATE_DEFS: MsgTemplateDef[] = [
  {
    key: 'installment_reminder',
    label: 'تذكير بقسط مستحق',
    desc: 'يُرسَل تلقائياً قبل 3 أيام من موعد القسط (واتساب).',
    vars: [
      { name: 'amount', sample: '1500' },
      { name: 'currency', sample: 'EGP' },
      { name: 'dueDate', sample: '2026-07-01' },
      { name: 'courseName', sample: 'دبلومة الإرشاد النفسي' },
    ],
    default: '⏰ تذكير: لديك قسط بمبلغ {{amount}} {{currency}} مستحق بعد 3 أيام ({{dueDate}}) - {{courseName}}. يرجى التواصل معنا لتسوية الدفع. — معهد مهاد',
  },
  {
    key: 'pending_payment_reminder',
    label: 'تذكير بدفعة معلّقة',
    desc: 'يُرسَل يومياً للعملاء بدفعات معلّقة أقدم من 3 أيام.',
    vars: [
      { name: 'amount', sample: '500' },
      { name: 'currency', sample: 'EGP' },
      { name: 'date', sample: '2026-06-10' },
    ],
    default: '⏰ تذكير: لديك دفعة معلّقة بمبلغ {{amount}} {{currency}} منذ {{date}}. يرجى إتمام الدفع أو التواصل معنا. — معهد مهاد 🌿',
  },
  {
    key: 'daqqi_session_reminder',
    label: 'تذكير بجلسة الدقي',
    desc: 'يُرسَل لحضور الدقي قبل موعد الجلسة القادمة.',
    vars: [
      { name: 'name', sample: 'سارة' },
      { name: 'courseTitle', sample: 'مهارات التواصل' },
      { name: 'sessionDate', sample: 'الإثنين 30 يونيو 2026' },
      { name: 'timeLabel', sample: 'المساء' },
    ],
    default: 'مرحباً {{name}} 💚\nتذكير بجلسة الدقي القادمة:\n📚 الكورس: {{courseTitle}}\n📅 التاريخ: {{sessionDate}}\n⏰ الوقت: {{timeLabel}}\n\nنتطلع لرؤيتك! 🌿\n— معهد الدراسات النفسية',
  },
  {
    key: 'lead_retargeting',
    label: 'إعادة استهداف العملاء المحتملين',
    desc: 'يُرسَل للعملاء المحتملين غير المحوَّلين بعد 30 يوماً.',
    vars: [{ name: 'name', sample: 'أحمد' }],
    default: 'أهلاً {{name}} 💜\nمعهد الدراسات النفسية — المعهد المتخصص في الصحة النفسية 🌱\n\nنحن هنا لدعمك في رحلتك نحو التطور المهني.\nتواصل معنا الآن لمعرفة أحدث البرامج المتاحة 📚\n\nللاستفسار تواصل معنا عبر الواتساب 💚',
  },
];

/** Render {{var}} (whitespace-tolerant) against `vars` for the live preview. */
export function renderPreview(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, name) => (name in vars ? vars[name] : ''));
}

/** Parse the saved `msg.templates` blob into a { key: text } map. */
export function parseTemplates(content: Record<string, string>): Record<string, string> {
  const raw = content['msg.templates'];
  if (!raw) return {};
  try { return typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, string>); }
  catch { return {}; }
}
