'use strict';

/**
 * One HTML escaper.
 *
 * There were nine identical copies of this function across the API — finance,
 * billing, support, reminders, lms, crm-quotes, subscriber-qr, courseCompletion
 * and courseWaitlist each declared their own. Nine copies is nine places to
 * check when the question is "is this page escaped", and the answer was not the
 * same everywhere: the public certificate page had no escaper at all and
 * rendered `subscribers.name` straight into an HTML document.
 *
 * Registration writes that name with a bare `.trim()`, so it is whatever the
 * customer typed. The page's CSP (`script-src 'none'`) stops it executing, but
 * a certificate is the thing this institute sells — markup injected into one,
 * at its own legitimate verification URL, is forgery of the product.
 *
 * Escapes the five characters that matter in both element and attribute
 * context, so a single function is correct in either.
 */

const HTML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => HTML_ENTITIES[character]);
}

/**
 * A URL safe to put in href/src: absolute http(s) only.
 *
 * `javascript:` and `data:` in an href are script execution; a relative path
 * that starts with `//` is a protocol-relative jump to another host. Anything
 * that is not plainly http(s) becomes the empty string, and the caller decides
 * what an empty URL means for its own markup.
 */
function safeUrl(value) {
  const raw = String(value ?? '').trim();
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(raw)) return '';
  return escapeHtml(raw);
}

module.exports = { escapeHtml, safeUrl };
