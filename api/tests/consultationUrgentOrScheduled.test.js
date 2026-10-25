'use strict';

// 25 Oct 2026 — «كل استشارة لازم تبان عاجلة خلال 60 دقيقة ولا استشارة بموعد»: the booking list, the calendar
// and the doctor's portal each say which one a consultation is.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function adminLib() {
  const ADMIN_MODULES = path.join(ROOT, 'admin/node_modules');
  let esbuild;
  try { esbuild = require(path.join(ADMIN_MODULES, 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    stdin: { contents: "export { consultationTiming } from './lib/consultations';", resolveDir: path.join(ROOT, 'admin'), loader: 'ts' },
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent', nodePaths: [ADMIN_MODULES], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}

test('an express session is urgent within 60 minutes; any other has its day and hour', () => {
  const lib = adminLib();
  if (!lib) return;
  const urgent = lib.consultationTiming({ source: 'site_express', createdAt: '2026-10-25T09:30:00.000Z', sessionDate: '2026-10-25 09:30:00' });
  assert.equal(urgent.urgent, true);
  assert.equal(urgent.label, 'عاجلة خلال 60 دقيقة');
  const scheduled = lib.consultationTiming({ source: 'site_regular', sessionDate: '2026-11-02T00:00:00.000Z', sessionTime: '18:30' });
  assert.deepEqual([scheduled.urgent, scheduled.label, scheduled.when], [false, 'استشارة بموعد', '2026-11-02 · 18:30']);
  const noHour = lib.consultationTiming({ source: 'admin', sessionDate: '2026-11-02 00:00:00' });
  assert.equal(noHour.when, '2026-11-02');
  assert.equal(lib.consultationTiming({}).when, 'بدون تاريخ');
});

test('the clock of a booking is its hour, and nothing for an express or an hourless one', () => {
  const { consultationClock } = require('../lib/consultationRequests');
  assert.equal(consultationClock({ session_date: new Date(2026, 10, 2, 18, 30), source: 'site_regular' }), '18:30');
  assert.equal(consultationClock({ session_date: new Date(2026, 10, 2, 0, 0), source: 'site_regular' }), undefined);
  assert.equal(consultationClock({ session_date: new Date(2026, 10, 2, 18, 30), source: 'site_express' }), undefined);
  assert.equal(consultationClock({ session_date: '2026-11-02' }), undefined);
});

test('every consultation screen draws the badge, and the doctor\'s portal is sent the source', () => {
  for (const screen of [
    'admin/pages/dashboard/tabs/consultations/ConsultationBookingsTab.tsx',
    'admin/pages/dashboard/tabs/ConsultationCalendarTab.tsx',
    'admin/pages/TherapistPortal.tsx',
  ]) assert.match(read(screen), /<ConsultationTimingBadge item=\{/, screen);
  assert.match(read('api/routes/staff.js'), /created_at, source\s+FROM consultations/);
  assert.match(read('api/routes/staff.js'), /sessionTime: consultationClock\(row\)/);
});
