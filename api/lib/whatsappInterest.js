'use strict';

// How interested a customer reads in their own WhatsApp messages — «يحاول يقرا
// الرسايل ويحدد درجة اهتمام العميل».
//
// Read from what the customer wrote, never from what the rep sent: words that
// mean they are about to book (a booking, a transfer, a start date), words that
// ask what it costs, words that ask what it is, and words that close the door.
// A closing word in their latest message settles it whatever came before. Each
// reason is returned with the score so the screen can say why, and a rep can
// disagree with it from the same screen.
//
// No model call: the AI provider is off on this tenant, and a rule the desk can
// read is the honest version until it is on.

const normalize = text => String(text || '')
  .toLowerCase()
  .replace(/[ً-ٰٟ]/g, '')           // tashkeel
  .replace(/[أإآٱ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/ؤ/g, 'و')
  .replace(/ئ/g, 'ي')
  .replace(/ـ/g, '')
  .replace(/\s+/g, ' ');

const SIGNALS = [
  { key: 'book', weight: 30, label: 'عايز يحجز أو يدفع', words: [
    'احجز', 'حجز', 'هحجز', 'اشترك', 'اسجل', 'سجلني', 'ادفع', 'الدفع', 'دفعت', 'هدفع', 'حولت', 'تحويل', 'فودافون كاش',
    'انستاباي', 'انستا باي', 'رقم الحساب', 'ابعتلي اللينك', 'امتي يبدا', 'امتي هيبدا', 'اول محاضره', 'موافق'] },
  { key: 'price', weight: 20, label: 'بيسأل عن السعر', words: [
    'سعر', 'بكام', 'كام سعر', 'تكلفه', 'التكلفه', 'المصاريف', 'قسط', 'تقسيط', 'الخصم', 'خصم', 'عرض', 'كام الكورس'] },
  { key: 'info', weight: 10, label: 'بيسأل عن التفاصيل', words: [
    'تفاصيل', 'معلومات', 'محتوي', 'المده', 'مده الكورس', 'شهاده', 'معتمده', 'اونلاين', 'حضوري', 'الفرع', 'العنوان',
    'مكان', 'مواعيد', 'ميعاد', 'ممكن اعرف', 'عايز اعرف', 'عاوز اعرف', 'استفسار', 'ازاي', 'المحاضرات'] },
];
const CLOSING = [
  'مش مهتم', 'مش مهتمه', 'مش عايز', 'مش عاوز', 'مش عايزه', 'لا شكرا', 'لا متشكر', 'غالي', 'مش مناسب', 'مش دلوقتي',
  'بعدين', 'الغي', 'الغاء', 'متبعتش', 'بلاش', 'مش محتاج', 'امسح رقمي', 'متكلمنيش', 'شيلني',
].map(normalize);

const LEVELS = [
  { min: 60, level: 'hot', label: 'مهتم جداً' },
  { min: 30, level: 'warm', label: 'مهتم' },
  { min: 1, level: 'cold', label: 'بيسأل بس' },
];

/**
 * @param {Array<{fromMe: boolean, body: string}>} messages oldest first
 * @returns {{score: number, level: 'hot'|'warm'|'cold'|'lost', label: string, reasons: string[]} | null}
 *   null when the customer has written nothing yet
 */
function scoreInterest(messages) {
  const theirs = (messages || []).filter(message => !message.fromMe && String(message.body || '').trim());
  if (!theirs.length) return null;
  const latest = normalize(theirs[theirs.length - 1].body);
  if (CLOSING.some(word => latest.includes(word))) {
    return { score: 0, level: 'lost', label: 'مش مهتم', reasons: ['آخر رسالة منه بتقفل الموضوع'] };
  }
  const all = theirs.map(message => normalize(message.body)).join(' \n ');
  let score = 0;
  const reasons = [];
  for (const signal of SIGNALS) {
    if (signal.words.some(word => all.includes(normalize(word)))) {
      score += signal.weight;
      reasons.push(signal.label);
    }
  }
  const engagement = Math.min(theirs.length * 3, 15);
  if (engagement) { score += engagement; reasons.push(`بعت ${theirs.length} رسالة`); }
  if (/[?؟]/.test(all)) { score += 5; reasons.push('بيسأل'); }
  score = Math.max(0, Math.min(100, score));
  const band = LEVELS.find(item => score >= item.min) || LEVELS[LEVELS.length - 1];
  return { score, level: band.level, label: band.label, reasons };
}

module.exports = { scoreInterest, normalize };
