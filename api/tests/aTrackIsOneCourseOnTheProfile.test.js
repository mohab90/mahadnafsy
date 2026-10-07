'use strict';

// «انا محتاج تتعامل مع المسار انه كورس واحد في كل حاجه علي السيستم … فقط عند ظهور
// الفيديوهات تكون مقسمه» (7 Oct 2026). The clients table already showed a track
// as one item; the client's own page listed the courses inside it, each with
// «لا مدفوعات», because the money is recorded under the track. The profile's
// money lists now read the same items as the table.

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
        import { UnifiedClientSidebarFinancialCard } from './pages/unified-client/UnifiedClientSidebarCards';
        export const card = props => renderToStaticMarkup(createElement(UnifiedClientSidebarFinancialCard, props));`,
      resolveDir: path.join(ROOT, 'admin'), loader: 'tsx',
    },
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent', jsx: 'automatic',
    nodePaths: [ADMIN_MODULES], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports.card;
}
const card = render();

const courses = [
  { id: 'c-1', title: 'العلاج المعرفي', price: { EGP: 3000 } },
  { id: 'c-2', title: 'الإرشاد الأسري', price: { EGP: 3000 } },
  { id: 'c-3', title: 'تعديل السلوك', price: { EGP: 2000 } },
];
const bundles = [{ id: 'b-1', title: 'مسار الأخصائي النفسي', price: { EGP: 5000 }, courses: [{ id: 'c-1' }, { id: 'c-2' }] }];

test('a track is one line with the money paid for it, beside a course of its own', { skip: !card }, () => {
  const html = card({
    subscriber: {
      id: 's-1', name: 'عميلة', enrolledCourseIds: ['c-1', 'c-2', 'c-3'], enrolledBundleIds: ['b-1'],
      paymentHistory: [
        { id: 'p-1', amount: 2000, currency: 'EGP', status: 'paid', paymentType: 'course', bundleId: 'b-1', courseExpected: 5000 },
        { id: 'p-2', amount: 2000, currency: 'EGP', status: 'paid', paymentType: 'course', courseId: 'c-3', courseExpected: 2000 },
      ],
    },
    courses, bundles, settlementCurrency: 'EGP',
    subPaidTotals: { EGP: 4000, SAR: 0, USD: 0 }, subRemainingEGP: 3000, settlementLabel: 'ج.م', onOpenDetails() {},
  });
  assert.match(html, /مسار الأخصائي النفسي/);
  assert.doesNotMatch(html, /العلاج المعرفي|الإرشاد الأسري/, 'the courses inside the track are not lines of their own');
  assert.match(html, /تعديل السلوك/);
  assert.match(html, /باقي 3,000/, 'the track owes 3,000 of its 5,000');
  assert.doesNotMatch(html, /لا مدفوعات/);
});
