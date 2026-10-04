'use strict';

/**
 * One name per box the money arrives on.
 *
 * payments.payment_method is free text typed over the years, so one box reads
 * several ways: «فودافون كاش 7722» twice (a stray space or an invisible
 * direction mark), «فودفوان كاس 1010» (a typo), «تحويل لأحمد السعودية» beside
 * «احمد السعودية», and cash as «كاش», «نقدي», «خزنة الدقي», «خزنة الدقي - كاش».
 * The finance screens grouped on the raw text and listed each as its own
 * channel: «مكررة كتير محتاجه دمج للمكرر … وكل الكاش في الدقي فقط».
 *
 * The stored rows are not rewritten — a payment record is evidence of what was
 * entered — so the merge happens on the way out: every spelling maps to one
 * channel, and filtering by that channel matches all of its spellings.
 *
 * A wallet named without its number («فودافون كاش») stays a channel of its own:
 * which of the institute's numbers it went to is not in the record.
 */

const CASH_BOX = 'خزنة الدقي - كاش';

const INVISIBLE = /[‎‏‪-‮⁦-⁩﻿ ]/g;

const fold = value => String(value ?? '')
  .replace(INVISIBLE, ' ')
  .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
  .replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[ً-ٟـ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

// Provider by what the text says, after typos are folded in. First match wins.
const PROVIDERS = [
  ['أحمد السعودية', /احمد.*سعودي|سعودي.*احمد/],
  ['البنك السعودي', /بنك.*سعودي|سعودي.*بنك/],
  ['فودافون كاش', /فود[اف]?[وف]?[او]ن|فودفون|vodafone/],
  ['انستا باي', /انستا|انستاباي|instapay|insta pay/],
  ['اورانج كاش', /اورانج|orange/],
  ['وي باي', /وي باي|محفظه وي|we ?pay/],
  ['اتصالات كاش', /اتصالات|etisalat/],
  ['تحويل بنكي', /بنكي|بنك|bank/],
  ['فوري', /فوري|fawry/],
  ['أونلاين', /paymob|باي ?موب|online|اونلاين/],
];

const isCash = text => /^(كاش|نقد|نقدي|نقدا|cash)$/.test(text) || /خزن/.test(text);

/**
 * The channel a payment_method belongs to, as shown and filtered.
 * @param {string|null} method
 * @returns {string}
 */
function canonicalChannel(method) {
  const text = fold(method);
  if (!text) return 'غير محدد';
  if (isCash(text)) return CASH_BOX;
  // «كاس» is «كاش» typed without the dots; only the word, never inside another.
  const healed = text.replace(/(^|\s)كاس(\s|$)/g, '$1كاش$2');
  const provider = PROVIDERS.find(([, pattern]) => pattern.test(healed));
  if (!provider) return String(method).replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  const [name] = provider;
  if (name === 'أحمد السعودية' || name === 'البنك السعودي' || name === 'أونلاين') return name;
  // The box's number: its last four digits, as the desk writes them.
  const digits = (healed.match(/\d{3,}/g) || []).pop();
  return digits ? `${name} ${digits.slice(-4)}` : name;
}

module.exports = { canonicalChannel, CASH_BOX };
