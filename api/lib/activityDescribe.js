'use strict';

// «سجل النظام محتاج … يسجل تفاصيل اكتر وكل حاجة بتحصل واسم المسئول مش ايميله
// ومحتاجين يضاف القسم». The audit middleware wrote «create /api/admin/leads/
// move-to-archive» under an email. This turns a request into what a person
// reads: which part of the system, what was done, and the department of whoever
// did it — for new rows at write time, and for the 70,000 old ones at read time
// from the path their label kept.

/** The part of the system, by the first segment of /api/admin/<segment>. */
const AREAS = [
  [/^(leads|crm|crm-settings|registrations|lead-sources)$/, 'العملاء المحتملين'],
  [/^(subscribers|subscriber|enrollments|create-account|client-code|bulk-assign-collection|subscriber-requests)$/, 'العملاء'],
  [/^(subscriber-payments|payments|payment-proofs|finance|orders|expenses|incoming-transfers|installments|fx-rates)$/, 'الحسابات والمدفوعات'],
  [/^(certificate-requests|certificates|course-completions)$/, 'الشهادات'],
  [/^(refund-requests|refund_requests)$/, 'الاستردادات'],
  [/^(consultations|consultation-requests|therapists)$/, 'الاستشارات'],
  [/^(daqqi-rounds|dokki|daqqi)$/, 'الدقي'],
  [/^(hr|staff|staff-account|force-reset-password|sales-targets)$/, 'الموظفين'],
  [/^(courses|lectures|chapters|bundles|quizzes|live-streams)$/, 'الكورسات'],
  [/^(content|community|testimonials|discounts|seo|media)$/, 'محتوى الموقع'],
  [/^(sys-config|branches|section-tabs|messaging|otp-provider|notification-settings|settings|backups)$/, 'الإعدادات'],
  [/^(tickets|inbox|contact-messages|customer-inbox)$/, 'الدعم وخدمة العملاء'],
  [/^(reports|ai|ai-autopilot)$/, 'التقارير والذكاء الاصطناعي'],
  [/^(notifications)$/, 'الإشعارات'],
];
const areaOf = entity => (AREAS.find(([pattern]) => pattern.test(String(entity || ''))) || [null, 'عام'])[1];

// What was done, most specific first. `m` is the HTTP method.
const ACTS = [
  [/^leads\/move-to-archive/, () => 'نقل ليدات للأرشيف'],
  [/^leads\/(bulk|assign)/, () => 'توزيع ليدات على الفريق'],
  [/^leads\/[^/]+\/convert/, () => 'تحويل ليد لعميل'],
  [/^leads(\/[^/]+)?$/, m => ({ POST: 'إضافة ليد', PUT: 'تعديل ليد', PATCH: 'تعديل ليد', DELETE: 'حذف ليد' }[m])],
  [/^crm\/leads\/[^/]+\/interactions/, m => (m === 'DELETE' ? 'حذف تواصل مع ليد' : 'تسجيل تواصل مع ليد')],
  [/^crm\/pipeline/, () => 'تعديل مراحل البيع'],
  [/^crm-settings/, () => 'تعديل إعدادات المبيعات'],
  [/^registrations\/[^/]+\/convert-online/, () => 'تحويل تسجيل لعميل أونلاين'],
  [/^registrations/, m => (m === 'DELETE' ? 'حذف تسجيل من الموقع' : 'تعديل تسجيل من الموقع')],
  [/^subscribers\/[^/]+\/restore/, () => 'استرجاع عميل من الأرشيف'],
  [/^subscribers\/[^/]+\/assign-collection/, () => 'تعيين مسئول تحصيل لعميل'],
  [/^subscribers\/[^/]+\/course-remove/, () => 'حذف كورس من عميل'],
  [/^subscribers\/[^/]+\/course-transfer/, () => 'تحويل كورس عميل لكورس تاني'],
  [/^subscribers\/[^/]+\/course-access\//, () => 'تعديل صلاحية كورس لعميل'],
  [/^subscribers\/[^/]+\/course-access/, () => 'قفل أو فتح كورس لعميل'],
  [/^subscribers\/[^/]+\/item-money/, () => 'تعديل سعر ومدفوع كورس لعميل'],
  [/^subscribers\/[^/]+\/communications/, () => 'تسجيل تواصل مع عميل'],
  [/^subscribers(\/[^/]+)?$/, m => ({ POST: 'حفظ بيانات عميل', PUT: 'تعديل بيانات عميل', PATCH: 'تعديل بيانات عميل', DELETE: 'أرشفة عميل' }[m])],
  [/^bulk-assign-collection/, () => 'توزيع عملاء على التحصيل'],
  [/^enrollments/, () => 'تسجيل عميل في كورس'],
  [/^create-account/, () => 'إنشاء حساب دخول لعميل'],
  [/^client-code/, () => 'إصدار كود عميل'],
  [/^subscriber-payments/, m => ({ POST: 'تسجيل دفعة', DELETE: 'حذف دفعة' }[m] || 'تعديل دفعة')],
  [/^payment-proofs/, () => 'مراجعة إيصال تحويل'],
  [/^payments\/[^/]+\/(approve|review)/, () => 'مراجعة دفعة'],
  [/^finance\/refunds\/[^/]+\/escalate/, () => 'رفع طلب استرداد للإدارة'],
  [/^finance\/refunds\/[^/]+\/mark-refunded/, () => 'تأكيد رد مبلغ استرداد'],
  [/^finance\/refunds\/[^/]+\/contact/, () => 'تواصل بخصوص طلب استرداد'],
  [/^finance\/refunds/, m => (m === 'DELETE' ? 'حذف طلب استرداد' : 'قرار في طلب استرداد')],
  [/^refund-requests/, () => 'طلب استرداد'],
  [/^orders/, m => (m === 'DELETE' ? 'حذف طلب' : 'تعديل طلب')],
  [/^expenses/, m => ({ POST: 'تسجيل مصروف', DELETE: 'حذف مصروف' }[m] || 'تعديل مصروف')],
  [/^certificate-requests\/[^/]+\/details/, () => 'تعديل بيانات شهادة'],
  [/^certificate-requests/, m => ({ POST: 'طلب شهادة', DELETE: 'حذف طلب شهادة' }[m] || 'تغيير حالة شهادة')],
  [/^consultations/, () => 'تعديل استشارة'],
  [/^daqqi-rounds/, m => (m === 'DELETE' ? 'حذف روند دقي' : 'حفظ روند دقي')],
  [/^dokki\/course-paths/, () => 'اختيار مسار الكورس في جدول الدقي'],
  [/^hr\/staff\/[^/]+\/messages/, () => 'رسالة لموظف'],
  [/^hr\/employees/, () => 'تعديل ملف موظف'],
  [/^staff\/[^/]+\/set-password/, () => 'تغيير باسورد موظف'],
  [/^staff-account/, () => 'إنشاء حساب موظف'],
  [/^force-reset-password/, () => 'إعادة تعيين باسورد'],
  [/^staff/, m => (m === 'DELETE' ? 'حذف موظف' : 'تعديل موظف')],
  [/^(courses|lectures|chapters|bundles)/, (m, path) => `${m === 'DELETE' ? 'حذف' : 'حفظ'} ${({ courses: 'كورس', lectures: 'محاضرة', chapters: 'فصل', bundles: 'مسار' })[path.split('/')[0]]}`],
  [/^content/, () => 'تعديل محتوى وإعدادات الموقع'],
  [/^community/, () => 'تعديل في المجتمع'],
  [/^therapists/, () => 'تعديل معالج'],
  [/^sys-config/, () => 'تعديل إعدادات النظام'],
  [/^branches/, () => 'تعديل فرع'],
  [/^section-tabs/, () => 'تعديل تبويبات الأقسام'],
  [/^messaging/, () => 'تعديل قنوات الرسائل'],
  [/^otp-provider/, () => 'إعدادات رسائل الدخول'],
  [/^tickets\/[^/]+\/reply/, () => 'رد على مشكلة عميل'],
  [/^tickets/, () => 'تعديل مشكلة عميل'],
  [/^join-us/, () => 'طلبات الانضمام'],
  [/^ai\/autopilot\/run/, () => 'تشغيل المساعد الذكي يدوياً'],
  [/^ai/, () => 'إعدادات الذكاء الاصطناعي'],
  [/^reports\/whatsapp/, () => 'إعدادات تقرير الواتساب اليومي'],
  [/^settings/, () => 'تعديل الإعدادات'],
];

const METHOD_WORD = { POST: 'إضافة', PUT: 'تعديل', PATCH: 'تعديل', DELETE: 'حذف' };

/** A request as a person reads it: { area, text }. */
function describeRequest(method, rawPath) {
  const path = String(rawPath || '').split('?')[0].replace(/^\/api\/(admin|staff)\//, '');
  const verb = String(method || '').toUpperCase();
  const hit = ACTS.find(([pattern]) => pattern.test(path));
  const text = (hit && hit[1](verb, path)) || `${METHOD_WORD[verb] || 'إجراء'} — ${path}`;
  return { area: areaOf(path.split('/')[0]), text };
}

/** An old row's label «create /api/admin/...» back into a request. */
const OLD_LABEL = /^(create|update|delete) (\/api\/\S+)/;
const OLD_VERB = { create: 'POST', update: 'PUT', delete: 'DELETE' };
function describeLabel(label, entity) {
  // The daily autopilot writes its results as JSON; the list says what it was.
  if (entity === 'ai-autopilot') return { area: areaOf(entity), text: 'تشغيل المساعد الذكي اليومي' };
  const match = OLD_LABEL.exec(String(label || ''));
  if (!match) return { area: areaOf(entity), text: String(label || entity || '') };
  return describeRequest(OLD_VERB[match[1]], match[2]);
}

/** The employee's department: their HR department when set, else their role's. */
const ROLE_DEPARTMENTS = {
  admin: 'الإدارة', manager: 'الإدارة',
  online_manager: 'الأونلاين', sales: 'المبيعات', sales_collection_manager: 'المبيعات والتحصيل',
  collection: 'التحصيل', support: 'خدمة العملاء',
  daqqi_manager: 'فرع الدقي', reception_daqqi: 'فرع الدقي',
  accountant: 'الحسابات', hr: 'الموارد البشرية',
  instructor: 'التدريب', trainer: 'التدريب', expert: 'التدريب', consultant: 'الاستشارات',
};
function departmentOf({ role, hrDepartment, isOwner = false } = {}) {
  if (hrDepartment) return String(hrDepartment);
  if (isOwner) return 'الإدارة';
  return ROLE_DEPARTMENTS[String(role || '').toLowerCase()] || null;
}

// What was sent, readable and safe: short values of up to twelve plain fields,
// never a secret.
const SECRET = /pass|token|secret|otp|key|card|cvv|pin|signature|credential/i;
function summarizeBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const parts = [];
  for (const [key, value] of Object.entries(body)) {
    if (parts.length >= 12) break;
    if (SECRET.test(key) || value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) { parts.push(`${key}: ${value.length} عنصر`); continue; }
    if (typeof value === 'object') continue;
    parts.push(`${key}: ${String(value).replace(/\s+/g, ' ').slice(0, 80)}`);
  }
  return parts.length ? parts.join(' · ') : null;
}

/** Rows written by the system itself, under a name a person reads. */
const SYSTEM_ACTORS = { 'ai-autopilot': 'المساعد الذكي (تلقائي)' };

module.exports = { SYSTEM_ACTORS, areaOf, departmentOf, describeLabel, describeRequest, summarizeBody };
