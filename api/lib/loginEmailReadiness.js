'use strict';

// Whether an account that signs in with an emailed code (lib/loginEmailCode.js) has an address the code can reach. The owner holds the
// real mailboxes, so this only separates the addresses that are certainly wrong from the ones somebody must confirm.

const PLACEHOLDER_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net', 'test.com', 'test.local', 'mahad.local', 'localhost', 'domain.com', 'email.com',
  'mail.com.invalid', 'invalid', 'noreply.com',
]);
const SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * @param {string|null|undefined} email the address the account signs in with
 * @param {{ sharedWith?: string[] }} [context] the other accounts that use the same address
 * @returns {{ status: 'missing'|'invalid'|'placeholder'|'phone_like'|'shared'|'check', reason: string }}
 *   `check` is an address that looks real: somebody still has to confirm it is read by its owner.
 */
function classifyLoginEmail(email, { sharedWith = [] } = {}) {
  const address = String(email ?? '').trim().toLowerCase();
  if (!address) return { status: 'missing', reason: 'مفيش إيميل — الكود مش هيوصل (EMAIL_CODE_NO_EMAIL)' };
  if (!SHAPE.test(address)) return { status: 'invalid', reason: 'الشكل مش إيميل' };
  const [name, domain] = address.split('@');
  if (PLACEHOLDER_DOMAINS.has(domain) || /(^|\.)(invalid|local|test|localhost)$/.test(domain)) {
    return { status: 'placeholder', reason: `دومين تجريبي (${domain})` };
  }
  if (/^\+?\d{8,}$/.test(name)) return { status: 'phone_like', reason: 'الإيميل رقم تليفون — غالباً حساب اتعمل بالرقم مش بإيميل حقيقي' };
  if (sharedWith.length) return { status: 'shared', reason: `نفس الإيميل عند: ${sharedWith.join('، ')} — كود حد هيوصل لغيره` };
  return { status: 'check', reason: 'شكله إيميل حقيقي — اتأكد إن صاحب الحساب بيفتحه' };
}

module.exports = { classifyLoginEmail, PLACEHOLDER_DOMAINS };
