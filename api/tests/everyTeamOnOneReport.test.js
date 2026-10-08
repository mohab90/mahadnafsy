'use strict';

// «وفي تقارير الفرق خلي في الكل وجمبه السيلز وغيرهم» (8 Oct 2026).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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
        import { AllTeamsReport } from './pages/dashboard/tabs/reports/AllTeamsReport';
        export const draw = teams => renderToStaticMarkup(createElement(AllTeamsReport, { teams }));`,
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

test('«الكل»: a line per team, then every employee ranked by money', { skip: !draw }, () => {
  const html = draw({
    sales: { reps: [{ id: 's1', name: 'سما', calls: 40, whatsapp: 10, bookings: 3, moneyEgp: 9000 }, { id: 's2', name: 'دنيا', calls: 60, whatsapp: 5, bookings: 1, moneyEgp: 2000 }] },
    online: { rows: [{ id: 'o1', name: 'دعاء', calls: 20, whatsapp: 30, payments: 5, collectedEgp: 4000 }] },
    support: { rows: [{ id: 'c1', name: 'منى', calls: 8, whatsapp: 12, problemsResolved: 6 }] },
    daqqi: { rows: [] },
  });
  assert.match(html, /المبيعات<\/td><td[^>]*>2<\/td><td[^>]*>100<\/td>/, 'the sales line sums its two reps');
  assert.match(html, /11,000 ج\.م/);
  assert.match(html, /6 <span[^>]*>مشاكل حلها<\/span>/);
  const order = ['سما', 'دعاء', 'دنيا', 'منى'].map(name => html.lastIndexOf(name));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'the employees, most money first');
});

test('it is the first choice beside the teams', () => {
  const tab = fs.readFileSync(path.join(ROOT, 'admin/pages/dashboard/tabs/ManagementReportsTab.tsx'), 'utf8');
  assert.match(tab, /useState<TeamKey \| 'all'>\('all'\)/);
  assert.match(tab, /\? <AllTeamsReport teams=\{report\.teams\} \/>/);
});
