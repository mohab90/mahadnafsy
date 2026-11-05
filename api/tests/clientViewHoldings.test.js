const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadHoldings, loadCertificateRequests, loadPayments, loadCompletions } = require('../lib/clientView');
const { certificateDue } = require('../lib/certificatePricing');
const { safeIsoString } = require('../lib/dates');

// The two mappings this module replaced, kept here as the oracle: the staff lists' batch projection and the single-client profile's inline block.
function oldListProjection(rows) {
  return rows.reduce((projection, row) => {
    const entry = projection[row.subscriber_id] ||= { ids: [], bundleIds: [], access: {} };
    if (row.bundle_id && !entry.bundleIds.includes(String(row.bundle_id))) entry.bundleIds.push(String(row.bundle_id));
    if (!row.course_id) return projection;
    const courseId = String(row.course_id);
    if (!entry.ids.includes(courseId)) entry.ids.push(courseId);
    entry.access[courseId] = row.access_type === 'limited' ? { mode: 'limited', lectureLimit: Number(row.lecture_limit) || 1 } : 'full';
    return projection;
  }, {});
}
function oldProfileBlock(enrollmentRows) {
  const enrolledCourseIds = [...new Set(enrollmentRows.flatMap(enrollment => {
    if (enrollment.course_id) return [String(enrollment.course_id)];
    if (enrollment.bundle_id) return [`bundle:${enrollment.bundle_id}`];
    return [];
  }))];
  const enrolledBundleIds = [...new Set(enrollmentRows.filter(row => row.bundle_id).map(row => String(row.bundle_id)))];
  const courseAccess = Object.fromEntries(enrollmentRows.filter(row => row.course_id).map(row => [
    String(row.course_id),
    row.access_type === 'limited' ? { mode: 'limited', lectureLimit: Number(row.lecture_limit) || 1 } : 'full',
  ]));
  return { enrolledCourseIds, enrolledBundleIds, courseAccess };
}

let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648; const pick = list => list[Math.floor(rnd() * list.length)];
const fakeDb = rows => ({ query: async () => [rows] });

test('it answers exactly what the lists and the profile answered before, over random enrollments', async () => {
  for (let round = 0; round < 200; round++) {
    const rows = Array.from({ length: Math.floor(rnd() * 9) }, () => ({
      subscriber_id: pick(['s1', 's2', 's3']),
      course_id: pick([null, 'c1', 'c2', 'c3', 'c1']),
      bundle_id: pick([null, null, 'b1', 'b2']),
      access_type: pick(['full', 'limited', null]),
      lecture_limit: pick([null, 0, 3]),
    }));
    const holdings = await loadHoldings('t', ['s1', 's2', 's3'], fakeDb(rows));
    const list = oldListProjection(rows);
    for (const id of ['s1', 's2', 's3']) {
      const mine = holdings[id];
      const profile = oldProfileBlock(rows.filter(row => row.subscriber_id === id));
      assert.deepEqual(mine && { ids: mine.ids, bundleIds: mine.bundleIds, access: mine.access }, list[id], `list view of ${id}, round ${round}`);
      assert.deepEqual(mine?.withBundles || [], profile.enrolledCourseIds, `profile courses of ${id}, round ${round}`);
      assert.deepEqual(mine?.bundleIds || [], profile.enrolledBundleIds, `profile tracks of ${id}, round ${round}`);
      assert.deepEqual(mine?.access || {}, profile.courseAccess, `profile access of ${id}, round ${round}`);
    }
  }
});

// The mapping the lists and the profile each carried before (identical in all three copies), kept as the oracle.
function oldCertificate(request, pricing) {
  return { id: request.id, courseId: request.course_id || undefined, type: String(request.type || 'OTHER').toLowerCase(), customName: request.custom_name || undefined,
    nameAr: request.name_ar || undefined, nameEn: request.name_en || undefined, nationality: request.nationality ? String(request.nationality).toLowerCase() : undefined,
    idNumber: request.id_number || undefined, status: String(request.status || 'PENDING').toLowerCase(), price: certificateDue(pricing, request) || undefined,
    paidAmount: request.paid_amount != null ? Number(request.paid_amount) : 0, currency: request.currency || undefined, requestedAt: safeIsoString(request.requested_at) || null,
    issuedAt: safeIsoString(request.issued_at) || undefined, note: request.note || undefined, adminNote: request.admin_note || undefined };
}

test('certificate requests: the same objects, grouped by client, in the order the query returned them', async () => {
  for (let round = 0; round < 100; round++) {
    const rows = Array.from({ length: Math.floor(rnd() * 8) }, (_, i) => ({
      id: 'r' + i, subscriber_id: pick(['s1', 's2', 's3']), course_id: pick([null, 'c1']), type: pick(['EXTRA', 'extra', null, 'OTHER']),
      custom_name: pick([null, 'x']), name_ar: pick([null, 'اسم']), name_en: pick([null, 'Name']), nationality: pick([null, 'EGYPTIAN', 'Foreign']),
      id_number: pick([null, '123']), status: pick(['PENDING', 'PRICED', null, 'DELIVERED']), price: pick([null, 0, 150]), paid_amount: pick([null, 0, 75]),
      currency: pick([null, 'EGP', 'SAR']), requested_at: pick([null, new Date('2026-10-01T10:00:00Z')]), issued_at: pick([null, new Date('2026-10-03T10:00:00Z')]),
      note: pick([null, 'n']), admin_note: pick([null, 'a']),
    }));
    const db = { query: async sql => (/certificate_requests/.test(sql) ? [rows] : [[]]) };
    const got = await loadCertificateRequests('t', ['s1', 's2', 's3'], db);
    const expected = {};
    rows.forEach(request => (expected[request.subscriber_id] ||= []).push(oldCertificate(request, {})));
    assert.deepEqual(got, expected, 'round ' + round);
  }
});

test('no ids, no query', async () => {
  const db = { query: async () => { throw new Error('queried'); } };
  assert.deepEqual(await loadHoldings('t', [], db), {});
  assert.deepEqual(await loadCertificateRequests('t', [], db), {});
});

test('the lists and the profile read it from here, not from a copy', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(read('routes/admin/stafflists.js'), /loadHoldings: loadEnrollmentProjection\b.*lib\/clientView/);
  assert.match(read('routes/admin/subscribers.js'), /loadHoldings\(req\.tenantId, \[r\.id\]\)/);
  assert.doesNotMatch(read('routes/admin/subscribers.js'), /FROM enrollments WHERE tenant_id=\? AND subscriber_id=\? AND status='active'/);
  // and none of the three admin copies of the certificate-request query remains
  assert.match(read('routes/admin/subscribers.js'), /loadCertificateRequests\(req\.tenantId, \[r\.id\]\)/);
  assert.equal(read('routes/admin/stafflists.js').split('FROM certificate_requests').length - 1, 0);
  assert.equal(read('routes/admin/subscribers.js').split('SELECT id, course_id, type, custom_name').length - 1, 0);
  assert.equal(read('routes/admin/stafflists.js').split('loadCertificateRequests(').length - 1, 2);
});

test('payments: full and slim shapes, recorded and absent staff names, grouped per client in query order', async () => {
  const rows = [
    { id: 'p1', subscriber_id: 's1', course_id: 'c1', bundle_id: null, amount: '150.50', currency: null, payment_type: 'COURSE', payment_method: 'cash', transaction_id: null, is_installment: 1,
      course_expected: '400', date: new Date('2026-10-02T09:00:00Z'), note: 'n', status: null, staff_id: 'st1', staff_name: 'Rep', from_account: '010', sender_name: 'X', source: 'web',
      item_title: 'T', cert_type: 'extra', certificate_request_id: 'cr1', branch: 'DOKKI' },
    { id: 'p2', subscriber_id: 's2', course_id: null, bundle_id: 'b1', amount: null, currency: 'SAR', payment_type: null, payment_method: null, transaction_id: 't', is_installment: 0,
      course_expected: null, date: new Date('2026-10-03T09:00:00Z'), note: null, status: 'pending', staff_id: null, staff_name: '', from_account: null, sender_name: null, source: null,
      item_title: null, cert_type: null, certificate_request_id: null, branch: null },
  ];
  const db = { query: async () => [rows] };
  const full = await loadPayments('t', ['s1', 's2'], { staffName: 'recorded' }, db);
  assert.deepEqual(Object.keys(full), ['s1', 's2']);
  assert.deepEqual(full.s1[0], {
    id: 'p1', amount: 150.5, currency: 'EGP', paymentType: 'course', paymentMethod: 'cash', transactionId: null, isInstallment: true, courseId: 'c1', bundleId: null, courseExpected: 400,
    note: 'n', at: '2026-10-02', status: 'paid', staffId: 'st1', staffName: 'Rep', fromAccountNumber: '010', senderName: 'X', source: 'web', itemTitle: 'T',
    certType: 'extra', certId: 'cr1', branch: 'DOKKI' });
  assert.equal(full.s2[0].staffName, null, 'an empty recorded name is null');
  assert.equal(full.s2[0].paymentType, 'other');
  const slim = await loadPayments('t', ['s1', 's2'], { shape: 'slim', staffName: 'none' }, db);
  for (const key of ['courseExpected', 'certType', 'certId', 'branch']) assert.equal(key in slim.s1[0], false, key);
  assert.equal(slim.s1[0].staffName, null);
  assert.deepEqual(await loadPayments('t', [], {}, { query: async () => { throw new Error('queried'); } }), {});
});

test('no staff route keeps its own copy of the client payment mapping', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.equal(read('routes/admin/stafflists.js').split('const [payRows] = await pool.query(').length - 1, 0);
  assert.equal(read('routes/admin/stafflists.js').split('loadPayments(').length - 1, 4);
  assert.match(read('routes/admin/subscribers.js'), /loadPayments\(req\.tenantId, \[r\.id\], \{ staffName: 'recorded' \}\)/);
  assert.equal(read('routes/admin/subscribers.js').split('payRows').length - 1, 0);
});

// The two mappings the completions had: the lists' projection (no printer) and the profile's inline block (with the printer), kept as the oracle.
const oldCompletion = (row, withPrinter) => ({
  id: row.id, courseId: row.course_id, certificateNumber: row.certificate_code, issuedAt: safeIsoString(row.completed_at) || null, status: row.status || 'active',
  version: Number(row.version || 1), revokedAt: safeIsoString(row.revoked_at) || undefined, revokeReason: row.revoke_reason || undefined, title: row.title || undefined,
  isTrack: Boolean(Number(row.is_track)), printedAt: safeIsoString(row.printed_at) || undefined,
  ...(withPrinter ? { printedBy: row.printed_by || undefined } : {}),
  printCount: Number(row.print_count) || 0, downloadedAt: safeIsoString(row.downloaded_at) || undefined, downloadCount: Number(row.download_count) || 0,
});

test('completions: the lists and the profile get what they got before, the profile with the printer', async () => {
  for (let round = 0; round < 100; round++) {
    const rows = Array.from({ length: Math.floor(rnd() * 7) }, (_, i) => ({
      id: 'k' + i, subscriber_id: pick(['s1', 's2']), course_id: pick(['c1', 'b1']), certificate_code: pick(['A-1', null]), completed_at: pick([null, new Date('2026-09-01T10:00:00Z')]),
      status: pick(['active', 'revoked', null]), version: pick([null, 0, 2]), revoked_at: pick([null, new Date('2026-09-05T10:00:00Z')]), revoke_reason: pick([null, 'why']),
      printed_at: pick([null, new Date('2026-09-02T10:00:00Z')]), printed_by: pick([null, 'staff-1']), print_count: pick([null, 0, 3]),
      downloaded_at: pick([null, new Date('2026-09-03T10:00:00Z')]), download_count: pick([null, 2]), title: pick([null, 'عنوان']), is_track: pick([0, 1, '1', null]),
    }));
    const db = { query: async () => [rows] };
    for (const withPrinter of [false, true]) {
      const expected = {};
      rows.forEach(row => (expected[row.subscriber_id] ||= []).push(oldCompletion(row, withPrinter)));
      // JSON, not deepEqual: the profile's key order is part of what it sends
      assert.equal(JSON.stringify(await loadCompletions('t', ['s1', 's2'], { printedBy: withPrinter }, db)), JSON.stringify(expected), `round ${round}, printer ${withPrinter}`);
    }
  }
  assert.deepEqual(await loadCompletions('t', [], {}, { query: async () => { throw new Error('queried'); } }), {});
});

test('no staff route keeps its own copy of the completions query', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.equal(read('routes/admin/stafflists.js').split('FROM course_completions').length - 1, 0);
  assert.equal(read('routes/admin/subscribers.js').split('FROM course_completions').length - 1, 0);
  assert.match(read('routes/admin/subscribers.js'), /loadCompletions\(req\.tenantId, \[r\.id\], \{ printedBy: true \}\)/);
  assert.match(read('routes/admin/stafflists.js'), /loadCompletions: loadCompletionProjection/);
});

test('track naming prices a track from the courses as they were, so it reads the balances unfolded; every other reader folds', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(read('lib/trackNaming.js'), /itemBalances\(db, \{ tenantId, subscriberId, foldTracks: false \}\)/);
  for (const file of ['routes/core/content.js', 'routes/admin-utils.js', 'routes/installments.js', 'lib/paymentReceipt.js']) {
    assert.match(read(file), /balanceFor\(/, `${file} reads a course's money through the track that took it in`);
    assert.doesNotMatch(read(file), /itemBalances\([^)]*\)\)?\.get\(/, `${file} does not look a course up in the folded map directly`);
  }
});
