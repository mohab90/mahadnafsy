'use strict';
/**
 * Settings that are entered in one place and read in another.
 *
 * Certificate pricing stored only the four prices, never the name, and rebuilt
 * its list as "the eight defaults plus the map's extra keys". So a custom
 * certificate came back as its own code, and a deleted default came back at
 * all. Production shows exactly that: eight custom types saved as 06, 07, 08,
 * 09, 010, 011, 012, 013 with no label anywhere, and four of the eight defaults
 * absent from the map yet still on the screen.
 *
 * Payment methods are read by every booking and payment dialog through one
 * helper, from content['finance.payment_methods'] — and that key does not exist
 * on production, so all of them fall back to a hardcoded list.
 * Run: npm run test:unit
 */
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveCertificatePrice } = require('../lib/certificatePricing');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('a certificate keeps its name across a save', () => {
  const shared = codeOnly(read('admin/pages/dashboard/dashboardShared.tsx'));
  // The name goes into the map with the prices.
  assert.match(shared, /label: t\.label,/);
  assert.ok(!shared.includes('.map(k => ({ key: k, label: k }))'),
    'a custom type used to be rebuilt with its code as its name');
  // And is read back, falling through to the built-in Arabic name and only
  // then to the code.
  assert.match(shared, /DEFAULT_CERT_TYPES\.find\(d => d\.key === key\)\?\.label/);

  // And there is one editor now. The settings screen carried a second one for
  // the same key, with its own layout and — until they were found — the same two
  // bugs, because a fix to one never reached the other.
  const schema = codeOnly(read('admin/pages/dashboard/tabs/systemSettingsSchema.tsx'));
  assert.ok(!schema.includes('extra_cert_pricing'),
    'certificate pricing is edited beside the requests, not in the settings screen');
  assert.ok(!schema.includes("key: 'cert_pricing'"));
});

test('a deleted certificate stays deleted', () => {
  const shared = codeOnly(read('admin/pages/dashboard/dashboardShared.tsx'));
  assert.ok(!shared.includes('return [...DEFAULT_CERT_TYPES, ...extra];'),
    'the defaults were prepended on every read, so a delete could never stick');
  // The saved map is the list; the defaults only seed an empty one.
  assert.match(shared, /if \(!keys\.length\) return DEFAULT_CERT_TYPES;/);
});

test('each settings section has its own address', () => {
  // Fourteen sections lived behind /dashboard/system_settings, so none could be
  // linked to, none could be bookmarked, and the back button left the screen
  // instead of stepping back one section. The dashboard already routes
  // /dashboard/:tab/:param and SectionedTab uses it exactly this way.
  const settings = codeOnly(read('admin/pages/dashboard/tabs/SystemSettingsTab.tsx'));
  assert.match(settings, /useParams<\{ param\?: string \}>\(\)/);
  assert.match(settings, /navigate\(`\/dashboard\/system_settings\/\$\{key\}`\)/);
  // Following a link or pressing back changes the URL; the screen has to follow.
  assert.match(settings, /useEffect\(\(\) => \{ setActive\(sectionFromUrl\); \}, \[sectionFromUrl\]\)/);
});

test('the two settings called وسائل الدفع say which is which', () => {
  // One is the institute's cash boxes, read by every booking and payment dialog.
  // The other is what a customer may pick when paying manually on the site. The
  // gateway card claimed the collection team used it, which is not true.
  const gateway = read('admin/pages/dashboard/tabs/PaymentSettingsTab.tsx');
  assert.ok(!gateway.includes('تستخدم داخل فريق التحصيل'),
    'that hint sent admins to edit the list the staff dialogs do not read');
  assert.match(gateway, /الإعدادات ← وسائل الدفع/, 'and it now names where that list lives');

  const schema = read('admin/pages/dashboard/tabs/systemSettingsSchema.tsx');
  assert.match(schema, /وسائل الدفع \(خزائن المعهد\)/);
});

test('adding a name to the stored map does not disturb pricing', () => {
  // The API reads specific price fields out of the same object, so carrying a
  // label alongside them changes nothing it looks at.
  const config = {
    institute: { label: 'شهادة المعهد', egyptianEGP: 300, residentEGP: 500, residentSAR: 60, foreignUSD: 18 },
  };
  assert.deepEqual(
    resolveCertificatePrice({ type: 'institute', nationality: 'EGYPTIAN', countryCode: 'EG', pricingConfig: config }),
    { price: 300, currency: 'EGP', status: 'PRICED' });
  assert.deepEqual(
    resolveCertificatePrice({ type: 'institute', nationality: 'SAUDI_RESIDENT', countryCode: 'SA', pricingConfig: config }),
    { price: 60, currency: 'SAR', status: 'PRICED' });
});

test('the payment methods the settings screen writes are the ones the dialogs read', () => {
  // One helper reads them, and it reads one key. The settings screen has to
  // write that key or every dialog silently shows the fallback list instead.
  const helper = codeOnly(read('admin/lib/paymentMethods.ts'));
  assert.match(helper, /export function parsePaymentMethods/);

  const schema = codeOnly(read('admin/pages/dashboard/tabs/systemSettingsSchema.tsx'));
  assert.match(schema, /'finance\.payment_methods': str/, 'the settings screen writes this key');
  assert.match(schema, /raw\['finance\.payment_methods'\]/, 'and reads the same one back');

  for (const screen of [
    'admin/components/PaymentModal.tsx',
    'admin/pages/dashboard/tabs/daqqi/DaqqiNewClientModals.tsx',
    'admin/pages/dashboard/tabs/daqqi/DaqqiPayModal.tsx',
    'admin/pages/dashboard/tabs/financial/PaymentReviewPanel.tsx',
  ]) {
    const source = codeOnly(read(screen));
    assert.match(source, /parsePaymentMethods\(/, `${screen} must read them through the shared helper`);
    assert.ok(!/DEFAULT_PAYMENT_METHODS\s*=/.test(source),
      `${screen} must not carry its own list`);
  }
});

test('the Daqqi room list reads the table rooms actually live in', () => {
  // Rooms used to be parsed out of content['institute.branches'], and the
  // branches migration retired that key — branches are a table now and the key
  // is absent on production. So the helper returned [] on every load, the room
  // dropdown was permanently empty, and nothing could fill it, because rooms had
  // moved to physical_classrooms.
  const utils = read('admin/pages/dashboard/tabs/daqqi/daqqiScheduleUtils.ts');
  assert.ok(!utils.includes('parseDaqqiRooms'),
    'a helper that can only answer "no rooms" is worse than none');

  const schedule = codeOnly(read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx'));
  assert.match(schedule, /adminGet<[^>]*>\('\/admin\/dokki\/classrooms'\)/);

  // And that endpoint is behind the permission this screen is already gated on.
  const dokki = read('api/routes/dokki-operations.js');
  assert.match(dokki, /router\.get\('\/api\/admin\/dokki\/classrooms', requireAuth, requireAdminOrStaff, requirePermission\('manage_daqqi'\)/);
});

test('staff can read the institute settings their screens are built from', () => {
  // GET /api/admin/content is requirePermission('manage_content'), and no role
  // holds manage_content — so only a super admin ever loaded it and every staff
  // account ran with content = {}. The production log shows a 403 on it every
  // two minutes while a staff account was open.
  //
  // That is why configured payment methods never reached the booking dialogs:
  // the methods were saved, and the screens never received them.
  const permissions = read('admin/constants/permissions.ts');
  const rolesSection = permissions.slice(permissions.indexOf('ROLE_DEFAULT_PERMISSIONS'));
  assert.ok(!/'manage_content'/.test(rolesSection),
    'if a role gains manage_content this fallback can be revisited');

  const config = read('api/routes/config.js');
  assert.match(config, /router\.get\('\/api\/admin\/content', requireAuth, requireAdminOrStaff, requirePermission\('manage_content'\)/);

  // The public route returns the same object to anonymous callers, so reading it
  // instead exposes nothing that was not already public.
  const publicRoutes = read('api/routes/public.js');
  assert.match(publicRoutes, /router\.get\('\/api\/content', publicLimiter/);

  const api = codeOnly(read('admin/lib/mysqlapi.ts'));
  assert.match(api, /apiFetch<AR>\('\/content'\)/, 'the admin app falls back to it');
});

test('a settings save cannot report success having sent nothing', () => {
  // buildContentPatch answers {} for a key it has no case for, the API merges
  // that into the content, rewrites it unchanged and returns 200 — so the row's
  // updated_at moves and the screen says «تم الحفظ» with nothing saved. The
  // content row was rewritten at 14:54 by a 200 PATCH while the key it was meant
  // to write still did not exist.
  const settings = codeOnly(read('admin/pages/dashboard/tabs/SystemSettingsTab.tsx'));
  assert.match(settings, /if \(!Object\.keys\(patch\)\.length\) \{/);
  assert.match(settings, /لا يوجد ما يُحفظ/);
  // And a section that never loaded says so rather than doing nothing silently.
  assert.match(settings, /لم تُحمَّل بعد/);
});

test('وسائل الدفع is one screen', () => {
  // Two lists with nearly the same name lived on two screens: the institute's
  // cash boxes in الإعدادات and the channels a customer may pick in إعدادات
  // الدفع. They cannot become one value — the first is free text a staff member
  // reads off a dropdown, the second a fixed set of codes the integration
  // branches on — but there is no reason to hunt across two screens for it.
  const settings = codeOnly(read('admin/pages/dashboard/tabs/SystemSettingsTab.tsx'));
  assert.match(settings, /const CustomerPaymentChannels/);
  assert.match(settings, /active === 'payment_methods' && \(/);

  const gateway = read('admin/pages/dashboard/tabs/PaymentSettingsTab.tsx');
  assert.ok(!gateway.includes('title="طرق الدفع اليدوي المتاحة للعميل"'),
    'the channels card moved out; the gateway screen keeps its credentials');

  // PUT /api/admin/sys-config/:section replaces the section, so a save from here
  // must not revert a toggle changed on the gateway screen meanwhile.
  assert.match(settings, /sys-config\?section=payment_gateway/);
  assert.match(settings, /const merged: GatewayConfig = \{/);
  assert.match(settings, /\.\.\.\(current\?\.manual \|\| \{\}\),/);
});

test('a room added to a branch is a room the schedule can see', () => {
  // The editor wrote rooms into content['institute.branches'], and rooms moved
  // to physical_classrooms — so adding one went nowhere and the Daqqi dropdown
  // stayed empty however many were typed in. Read and write now meet in the
  // same table.
  const shared = codeOnly(read('admin/pages/dashboard/dashboardShared.tsx'));
  assert.match(shared, /adminGet<ClassroomRow\[\]>\('\/admin\/dokki\/classrooms'\)/);
  assert.match(shared, /saveDokkiClassroom\(\{\s*\n\s*name, capacity/);
  assert.ok(!shared.includes('rooms: [...rooms, { name: newRoomName.trim()'),
    'nothing may write rooms back into the branches JSON');

  // physical_classrooms carries branch_id, so a room belongs to a branch — and
  // the two spell ids differently in places ('daqqi' against 'branch-daqqi').
  assert.match(read('api/schema.sql'), /CREATE TABLE `physical_classrooms`[\s\S]{0,300}`branch_id`/);
  assert.match(shared, /replace\(\/\^branch\[-_\]\/, ''\)/);

  // Removing deactivates rather than deletes, so a room with bookings keeps them.
  assert.match(shared, /is_active: 0,/);
});
