'use strict';

// «تاب … اسمه شهادات المعهد ودا بيكون اتوماتك ومجاني لاي عميل خلص فلوسه او 90 %
// من فلوسه … يمشي في خطوات اتشحنت او في الفرع … لو العميل عمل تحميل للشهاده pdf
// من الموقع يظهر انه العميل عملها تحميل» (8 Oct 2026).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

test('90% is the paid share everywhere now', () => {
  assert.equal(require('../lib/coursePaid').PAID_SHARE, 0.9);
  assert.equal(require('../lib/autoCertificate').PAID_THRESHOLD, 0.9);
});

test('every client with course money and no certificate is a candidate — own payments, a track, or money before the system', async () => {
  const { candidatePairs } = require('../lib/instituteCertificates');
  const db = {
    query: async sql => {
      const flat = String(sql).replace(/\s+/g, ' ');
      if (/SELECT DISTINCT p\.subscriber_id, p\.course_id/.test(flat)) return [[{ subscriber_id: 's-1', course_id: 'c-1' }, { subscriber_id: 's-2', course_id: 'c-1' }]];
      if (/JOIN bundle_courses bc ON bc\.bundle_id=p\.bundle_id/.test(flat)) return [[{ subscriber_id: 's-3', course_id: 'c-2' }]];
      if (/crm_json LIKE '%priorPaid%'/.test(flat)) return [[{ id: 's-4', crm_json: JSON.stringify({ priorPaid: { 'c-9': 2000, 'bundle:b-1': 500, 'c-0': 0 } }) }]];
      if (/FROM bundle_courses WHERE tenant_id=\? AND bundle_id IN/.test(flat)) return [[{ bundle_id: 'b-1', course_id: 'c-5' }]];
      if (/FROM course_completions/.test(flat)) return [[{ subscriber_id: 's-2', course_id: 'c-1' }]];
      return [[]];
    },
  };
  const pairs = (await candidatePairs(db, 't')).map(pair => `${pair.subscriberId}|${pair.courseId}`).sort();
  assert.deepEqual(pairs, ['s-1|c-1', 's-3|c-2', 's-4|c-5', 's-4|c-9'], 'a certificate already there, revoked or not, is left alone');
});

test('issued without an online enrolment or an email, by the same function as by hand', () => {
  const sweep = read('api/lib/instituteCertificates.js');
  assert.match(sweep, /requireFullProgress: false,\s*requireEnrollment: false, sendEmail: false/);
  const completion = read('api/lib/courseCompletion.js');
  assert.match(completion, /\$\{requireEnrollment \? 'JOIN' : 'LEFT JOIN'\} enrollments e/);
  assert.match(completion, /if \(sendEmail && eligibility\.email\)/);
  assert.match(read('api/routes/misc/_shared.js'), /runAutoCertificateSweep\(tenantId\)\.then\(\(\) => sweepInstituteCertificates\(tenantId\)\)/);
});

test('the client opening it from the site is recorded; the desk\'s own print is not', () => {
  const site = read('api/routes/public.js');
  assert.match(site, /if \(String\(req\.query\.staff \|\| ''\) !== '1'\) \{\s*pool\.query\(\s*'UPDATE course_completions SET downloaded_at=COALESCE\(downloaded_at, NOW\(\)\), download_count=download_count\+1/);
  assert.match(site, /router\.post\('\/api\/me\/completions\/:code\/downloaded', requireAuth/);
  assert.match(read('client/pages/UserDashboard.tsx'), /onPrinted=\{\(\) => \{ mysqlClient\.markCertificateDownloaded\(certModal\.certCode\)/);
  const panel = read('admin/pages/dashboard/tabs/InstituteCertificatesPanel.tsx');
  assert.match(panel, /href=\{certificateUrl\(row\.code, true\)\}/, 'the desk prints with ?staff=1');
  assert.match(read('admin/pages/dashboard/tabs/CertRequestsTab.tsx'), /\['institute', 'شهادات المعهد'\]/);
});

test('the printed copy moves through the desk\'s steps', () => {
  const { DELIVERY_STAGES } = require('../lib/instituteCertificates');
  assert.deepEqual(DELIVERY_STAGES, ['READY', 'PRINTED', 'AT_BRANCH', 'SHIPPED', 'DELIVERED', 'RETURNED']);
  assert.match(read('api/routes/instituteCertificates.js'), /if \(!DELIVERY_STAGES\.includes\(status\)\) return res\.status\(400\)/);
});
