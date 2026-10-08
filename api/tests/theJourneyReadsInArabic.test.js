'use strict';

// «رحلة العميل … ليه بتظهر كدا: COURSE · payment paid · بواسطة هنا … محتاجه
// اشبه بالتايم لاين ويبقي فيه تفاصيل اكتر» (8 Oct 2026).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const ADMIN_MODULES = path.join(ROOT, 'admin', 'node_modules');
function render() {
  let esbuild;
  try { esbuild = require(path.join(ADMIN_MODULES, 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    stdin: {
      contents: `
        import { createElement } from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import { ClientJourneyTimeline } from './pages/unified-client/ClientJourneyTimeline';
        export const draw = events => renderToStaticMarkup(createElement(ClientJourneyTimeline, { events }));`,
      resolveDir: path.join(ROOT, 'admin'), loader: 'tsx',
    },
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent', jsx: 'automatic',
    nodePaths: [ADMIN_MODULES], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports.draw;
}
const draw = render();

const events = [
  { category: 'learning', event_type: 'entitlement_granted', entity_id: 'e1', occurred_at: '2026-10-07T15:14:46Z', title: 'الصحة النفسية', actor: 'هنا',
    detail: { source: 'manual_enrollment', meta: { accessType: 'limited', lectureLimit: 50 } } },
  { category: 'payment', event_type: 'payment_paid', entity_id: 'p1', occurred_at: '2026-10-07T15:14:36Z', title: 'الصحة النفسية', status: 'paid', amount: 700, currency: 'EGP', actor: 'هنا',
    detail: { method: 'فودافون كاش', installment: 0, type: 'COURSE', expected: 2800 } },
  { category: 'payment', event_type: 'payment_paid', entity_id: 'p0', occurred_at: '2026-10-06T10:00:00Z', title: 'COURSE', status: 'paid', amount: 300, currency: 'EGP', actor: 'هنا',
    detail: { installment: 1, type: 'COURSE' } },
  { category: 'lead', event_type: 'lead_created', entity_id: 'L1', occurred_at: '2026-09-28T09:00:00Z', title: 'علم النفس فيس بوك', actor: 'سما', detail: { rep: 'سما' } },
];

test('every event is told in Arabic, by name, with its details', { skip: !draw }, () => {
  const html = draw(events);
  assert.match(html, /فتح كورس · الصحة النفسية/);
  assert.match(html, /وصول محدود — 50 محاضرة/);
  assert.match(html, /دفعة اتسجلت · الصحة النفسية/);
  assert.match(html, /طريقة الدفع: فودافون كاش/);
  assert.match(html, /سعر الكورس 2,800/);
  assert.match(html, /قسط/, 'an instalment says so');
  assert.match(html, /وصل كعميل محتمل/);
  assert.match(html, /المصدر: علم النفس فيس بوك/);
  assert.match(html, /بواسطة هنا/);
  assert.doesNotMatch(html, /payment paid|entitlement granted|>COURSE</, 'no English left');
  assert.match(html, />الفلوس <span/, 'filters by kind');
});
