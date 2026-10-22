'use strict';

// 20 Oct 2026 — the marketing pop-up with a video, the administration's pop-up to the employees, a branch manager hearing about
// their branch's leave / permission / advance requests, and the consultation delete that answered «Consultation not found».

const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentModalSource } = require('./_adminSplitSource');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const loadOffers = () => {
  const js = require('node:module').stripTypeScriptTypes(read('shared/siteOffers.ts')).replace(/^export /gm, '');
  const module_ = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', `${js}\nmodule.exports = { popupVideo, popupImage, popupHasContent, popupIsLive };`)(module_, module_.exports);
  return module_.exports;
};

test('the pop-up plays a YouTube, Vimeo or direct video and refuses any other address', () => {
  const { popupVideo } = loadOffers();
  assert.deepEqual(popupVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), { kind: 'frame', src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&playsinline=1&modestbranding=1' });
  assert.equal(popupVideo('https://youtu.be/dQw4w9WgXcQ?t=5').src.includes('/embed/dQw4w9WgXcQ'), true);
  assert.equal(popupVideo('https://www.youtube.com/shorts/dQw4w9WgXcQ').kind, 'frame');
  assert.equal(popupVideo('https://vimeo.com/123456789').src, 'https://player.vimeo.com/video/123456789');
  assert.deepEqual(popupVideo('https://cdn.example.com/promo.mp4?x=1'), { kind: 'file', src: 'https://cdn.example.com/promo.mp4?x=1' });
  assert.equal(popupVideo('/uploads/promo.webm').kind, 'file');
  for (const bad of ['', 'javascript:alert(1)', 'http://cdn.example.com/promo.mp4', 'https://evil.example.com/page', 'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ', 'data:video/mp4;base64,AAAA', 'https://www.youtube.com/watch?v=short']) {
    assert.equal(popupVideo(bad), null, bad);
  }
});

test('a pop-up with only a video or a picture is a pop-up; preview does not need it switched on', () => {
  const { popupIsLive, popupHasContent, popupImage } = loadOffers();
  const video = 'https://youtu.be/dQw4w9WgXcQ';
  assert.equal(popupIsLive({ 'popup.enabled': '1', 'popup.videoUrl': video }), true);
  assert.equal(popupIsLive({ 'popup.enabled': '1', 'popup.imageUrl': 'https://x.test/a.jpg' }), true);
  assert.equal(popupIsLive({ 'popup.enabled': '1', 'popup.videoUrl': 'https://evil.example.com/x' }), false, 'an unusable video is nothing to show');
  assert.equal(popupIsLive({ 'popup.enabled': '0', 'popup.videoUrl': video }), false);
  assert.equal(popupHasContent({ 'popup.enabled': '0', 'popup.title': 'خصم' }), true);
  assert.equal(popupImage('javascript:alert(1)'), '');
  const page = read('client/components/SpecialOffer.tsx');
  assert.match(page, /preview \? popupHasContent\(content\) : live && !isAdmin && !isStaff/, 'the preview shows a switched-off pop-up');
  assert.match(page, /popupVideo\(content\['popup\.videoUrl'\]\)/);
  assert.match(page, /<iframe src=\{video\.src\}/);
  assert.match(page, /<video src=\{video\.src\} controls/);
  assert.match(read('admin/pages/dashboard/tabs/marketing-hub-sections/SiteOffersPanel.tsx'), /'popup\.videoUrl': videoUrl/);
});

test('the site content reaches an owner or staff member looking at the live site', () => {
  const hook = read('client/context/site-data-hooks/useCatalogData.ts');
  const before = hook.indexOf('mysqlCatalog.getSiteContent()');
  const gate = hook.indexOf('if (!isAdmin) {');
  assert.ok(before > 0 && gate > 0 && before < gate, 'the content is fetched before, not inside, the non-admin branch');
});

const announcements = require('../lib/staffAnnouncements');

test('an announcement carries only safe pictures and videos, for the roles it names', () => {
  assert.equal(announcements.safeVideoUrl('https://youtu.be/dQw4w9WgXcQ'), 'https://youtu.be/dQw4w9WgXcQ');
  assert.equal(announcements.safeVideoUrl('https://evil.example.com/x'), '');
  assert.equal(announcements.safeVideoUrl('javascript:alert(1)'), '');
  assert.deepEqual(announcements.cleanImages(['https://x.test/1.jpg', 'http://x.test/2.jpg', '/uploads/3.png', 'javascript:1', 'https://x.test/4.jpg', 'https://x.test/5.jpg', 'https://x.test/6.jpg']),
    ['https://x.test/1.jpg', '/uploads/3.png', 'https://x.test/4.jpg', 'https://x.test/5.jpg']);
  assert.deepEqual(announcements.cleanRoles(['sales', 'SALES', 'bad role!', 'daqqi_manager']), ['SALES', 'DAQQI_MANAGER']);
  assert.equal(announcements.reachesRole('', 'sales'), true, 'no roles named = everyone');
  assert.equal(announcements.reachesRole('SALES,SUPPORT', 'support'), true);
  assert.equal(announcements.reachesRole('SALES,SUPPORT', 'hr'), false);
});

test('what an employee is shown is what is live, for them, and not yet closed by them', async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return [[
        { id: 'a', title: 'للكل', body: 'x', image_urls: '["https://x.test/1.jpg","http://bad"]', video_url: null, style: 'urgent', audience_roles: null, created_at: new Date() },
        { id: 'b', title: 'للمبيعات', body: '', image_urls: '[]', video_url: 'https://youtu.be/dQw4w9WgXcQ', style: 'nope', audience_roles: 'SALES', created_at: new Date() },
      ], []];
    },
  };
  const forSupport = await announcements.pendingFor(db, { tenantId: 't1', staffId: 's1', role: 'support' });
  assert.deepEqual(forSupport.map(item => item.id), ['a']);
  assert.deepEqual(forSupport[0].images, ['https://x.test/1.jpg']);
  const forSales = await announcements.pendingFor(db, { tenantId: 't1', staffId: 's1', role: 'sales' });
  assert.deepEqual(forSales.map(item => item.id), ['a', 'b']);
  assert.equal(forSales[1].style, 'info', 'an unknown look falls back');
  assert.match(calls[0].sql, /a\.tenant_id=\?/);
  assert.match(calls[0].sql, /NOT EXISTS \(SELECT 1 FROM staff_announcement_seen s/);
  assert.match(calls[0].sql, /s\.tenant_id=a\.tenant_id/);
  assert.deepEqual(calls[0].params, ['t1', 's1']);
});

test('the administration writes it, the employee reads and closes it, and it is wired in', () => {
  const route = read('api/routes/staff-announcements.js');
  for (const endpoint of ["router.get('/api/admin/staff-announcements'", "router.post('/api/admin/staff-announcements'", "router.delete('/api/admin/staff-announcements/:id'",
    "router.get('/api/staff/announcements/pending'", "router.post('/api/staff/announcements/:id/seen'"]) assert.ok(route.includes(endpoint), endpoint);
  assert.equal((route.match(/requirePermission\('manage_staff'\)/g) || []).length, 3, 'writing to the employees is the right to manage the team');
  assert.match(route, /INSERT IGNORE INTO staff_announcement_seen/);
  assert.match(read('api/lib/registerRoutes.js'), /staff-announcements/);
  assert.match(read('api/migrations/299_v26_staff_announcements.sql'), /CREATE TABLE IF NOT EXISTS staff_announcement_seen/);
  assert.match(read('api/schema.sql'), /CREATE TABLE `staff_announcements`/);
  assert.match(read('admin/pages/Dashboard.tsx'), /<StaffAnnouncementPopup \/>/);
  assert.match(read('admin/pages/dashboard/dashboardShared.tsx'), /staff_announcements: 'manage_staff'/);
  assert.match(read('admin/pages/dashboard/GeneralDashboardTabs.tsx'), /key: 'staff_announcements', Component: StaffAnnouncementsTab/);
  assert.match(read('admin/pages/dashboard/navigation.tsx'), /key: 'staff_announcements', label: 'رسالة للموظفين'/);
});

test('a branch manager is told, by name, of a request from their branch\'s staff — and approves advances in reach', async () => {
  const { notifyBranchManagers, BRANCH_HR } = require('../lib/branchHr');
  assert.equal(typeof notifyBranchManagers, 'function');
  // Never the real notification table: on this machine port 3306 is a tunnel to production.
  const notification = require('../lib/notification');
  const realCreate = notification.createNotification;
  const told = [];
  notification.createNotification = async (...args) => { told.push(args); };
  test.after(() => { notification.createNotification = realCreate; });
  const asked = [];
  const db = {
    query: async (sql, params) => {
      asked.push({ sql, params });
      if (/FROM staff WHERE id=\?/.test(sql)) return [[{ id: 'e1', role: BRANCH_HR.DAQQI_MANAGER.roles[0], branch_id: BRANCH_HR.DAQQI_MANAGER.branchId }], []];
      return [[{ id: 'mgr1' }], []];
    },
  };
  assert.equal(await notifyBranchManagers(db, { tenantId: 't1', staffId: 'e1', title: 'طلب سلفة', message: 'x' }), 1);
  assert.deepEqual([told[0][0], told[0][1], told[0][4], told[0][5]], ['hr', 'طلب سلفة', 't1', 'mgr1'], 'addressed to the manager by id');
  assert.match(asked[1].sql, /tenant_id=\?/);
  assert.match(asked[1].sql, /id<>\?/, 'never the requester themselves');
  assert.ok(asked[1].params.includes('DAQQI_MANAGER'));
  // A person of no branch tells no manager, and a failing notice never throws.
  assert.equal(await notifyBranchManagers({ query: async () => [[{ id: 'e2', role: 'SALES', branch_id: 'branch-other' }], []] }, { tenantId: 't1', staffId: 'e2', title: 't', message: 'm' }), 0);
  assert.equal(await notifyBranchManagers({ query: async () => { throw new Error('down'); } }, { tenantId: 't1', staffId: 'e1', title: 't', message: 'm' }), 0);

  const records = read('api/routes/hr/records.js');
  assert.match(records, /router\.get\('\/api\/admin\/hr\/advances', requireAuth, requireAdminOrStaff, requireAnyPermission\('view_hr', 'branch_hr'\), requireHr\('view'\)/);
  assert.match(records, /router\.put\('\/api\/admin\/hr\/advances\/:advId\/status', requireAuth, requireAdminOrStaff, requireAnyPermission\('manage_hr', 'branch_hr'\), requireHr\('manage'\)/);
  assert.match(records, /staffInReach\(conn, req, advance\.staff_id\)/);
  assert.match(records, /notifyBranchManagers\(pool,/);
  assert.match(read('api/routes/hr/compensation.js'), /notifyBranchManagers\(pool,/);
  assert.match(read('api/routes/hr/attendance.js'), /notifyBranchManagers\(pool,/);
  assert.match(read('admin/pages/dashboard/tabs/BranchHrTab.tsx'), /'\/admin\/hr\/advances'/);
});

test('deleting a request that exists only as an order hides the order instead of answering «not found»', () => {
  const catalog = read('api/routes/core/catalog.js');
  const handler = catalog.slice(catalog.indexOf("router.delete('/api/admin/consultations/:id'"));
  assert.match(handler, /\/\^order:\(\.\+\)\$\/\.exec\(String\(req\.params\.id\)\)/);
  assert.match(handler, /UPDATE orders SET deleted_at=NOW\(\) WHERE id=\? AND tenant_id=\? AND type='CONSULTATION' AND status='pending'/);
  assert.doesNotMatch(handler.slice(0, handler.indexOf('catch')), /404/, 'a booking that is already gone is the state the person asked for');
  assert.match(read('api/routes/core/staffacct.js'), /o\.status='pending' AND o\.deleted_at IS NULL/);
});

// 20 Oct 2026 (second batch): certificate prices by nationality, optional transfer details, one payments table.
test('in pounds a resident non-Egyptian is priced from their own list, not the Egyptian one', () => {
  const { basePriceForCurrency, certificateDue } = require('../lib/certificatePricing');
  const config = { institute: { egyptianEGP: 1000, residentEGP: 2500, residentSAR: 700, foreignUSD: 300 } };
  assert.equal(basePriceForCurrency(config, 'INSTITUTE', 'EGP'), 1000);
  assert.equal(basePriceForCurrency(config, 'INSTITUTE', 'EGP', 'EGYPTIAN'), 1000);
  assert.equal(basePriceForCurrency(config, 'INSTITUTE', 'EGP', 'NON_EGYPTIAN_EGYPT'), 2500);
  assert.equal(basePriceForCurrency(config, 'INSTITUTE', 'EGP', 'non_egyptian_egypt'), 2500);
  assert.equal(basePriceForCurrency({ institute: { egyptianEGP: 1000 } }, 'INSTITUTE', 'EGP', 'NON_EGYPTIAN_EGYPT'), 1000, 'no resident price: the Egyptian one rather than nothing');
  assert.equal(basePriceForCurrency(config, 'INSTITUTE', 'SAR', 'SAUDI_RESIDENT'), 700);
  assert.equal(basePriceForCurrency(config, 'INSTITUTE', 'USD', 'INTERNATIONAL'), 300);
  assert.equal(certificateDue(config, { type: 'INSTITUTE', currency: 'EGP', nationality: 'NON_EGYPTIAN_EGYPT', price: 0 }), 2500);
  assert.equal(certificateDue(config, { type: 'INSTITUTE', currency: 'EGP', price: 0 }), 1000);
  const route = read('api/routes/certificates.js');
  assert.match(route, /basePriceForCurrency\(pricing, row\.type, row\.currency \|\| 'EGP', row\.nationality\)/);
  assert.match(read('api/lib/certificatePayments.js'), /SELECT name, nationality FROM subscribers/);
  assert.match(paymentModalSource(), /nationality === 'non_egyptian_egypt'\) return Number\(tiers\.residentEGP\)/);
});

test('the operation number, sender and number never block a booking; the new clients are rows of the payments table', () => {
  const modal = paymentModalSource();
  assert.doesNotMatch(modal, /transferNeedsDetails|transferProblem/);
  const finance = read('admin/pages/dashboard/DashboardFinanceTabs.tsx');
  assert.doesNotMatch(finance, /<CollectionBookingsReview/, 'no block above the payments table');
  const view = read('admin/pages/dashboard/tabs/orders/OrdersAdminView.tsx');
  assert.match(view, /useClientRequests\(\{/);
  assert.match(view, /orderReviewTab === 'review' && clientRequests\.rows/);
  assert.match(view, /\{clientRequests\.dialog\}/);
  const rows = read('admin/pages/dashboard/tabs/orders/ClientRequestRows.tsx');
  assert.match(rows, /\/admin\/subscriber-requests\/\$\{encodeURIComponent\(target\.id\)\}\/approve/);
  assert.match(rows, /row\.payment\.transactionId[\s\S]*row\.payment\.senderName[\s\S]*row\.payment\.fromAccountNumber/, 'the transfer data shows on the row');
});
