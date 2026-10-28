'use strict';

// 19 Oct 2026 — «لما بضغط زر واتس اب مش بيفتح واتس اب اللى داخل السيستم … خلي زر واتس اب يظهر تحت جمب زر البحث ولما يضغط
// ارسال يبعت من داخل السيستم … أي رقم مربوط بالسيستم ياخد بياناته ويظهر اسم الكورس المهتم بيه وتفاصيله».

const test = require('node:test');
const assert = require('node:assert/strict');
const { dashboardSource } = require('./_adminSplitSource');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function bundle(entry) {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, entry)], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    nodePaths: [path.join(ROOT, 'admin', 'node_modules')], define: { 'import.meta.env': '{}' },
    // The link parser is pure; the React parts of the file are never rendered here.
    external: ['react', 'react-dom', 'react-router-dom', 'lucide-react'],
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}

test('every way of linking to WhatsApp outside the system is recognised, and nothing else is', () => {
  let lib;
  try { lib = bundle('admin/components/InSystemWhatsApp.tsx'); } catch { return; }
  if (!lib) return;
  global.window = { location: { origin: 'https://admin.example.test' } };
  assert.deepEqual(lib.parseWhatsAppHref('https://wa.me/201012313666'), { phone: '201012313666', text: '' });
  assert.deepEqual(lib.parseWhatsAppHref('https://wa.me/201012313666?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7'), { phone: '201012313666', text: 'مرحبا' });
  assert.deepEqual(lib.parseWhatsAppHref('https://api.whatsapp.com/send?phone=966501234567&text=hi'), { phone: '966501234567', text: 'hi' });
  assert.equal(lib.parseWhatsAppHref('https://wa.me/'), null, 'no number, no chat');
  assert.equal(lib.parseWhatsAppHref('https://example.com/wa.me/2010'), null);
  assert.equal(lib.parseWhatsAppHref('/client/C10014'), null);
  assert.equal(lib.parseWhatsAppHref('tel:+201012313666'), null);
  assert.equal(lib.inSystemChatUrl({ phone: '01012313666', text: 'hi' }), '/dashboard/whatsapp_web?phone=201012313666&text=hi');
  delete global.window;
});

test('the buttons open the system\'s own WhatsApp; the floating sender is gone and the search button is only an icon', () => {
  const app = read('admin/App.tsx');
  assert.match(app, /<InSystemWhatsAppLinks \/>/);
  const links = read('admin/components/InSystemWhatsApp.tsx');
  assert.match(links, /document\.addEventListener\('click', onClick, true\)/, 'one listener for every link');
  assert.match(links, /event\.metaKey \|\| event\.ctrlKey \|\| event\.shiftKey/, 'a Ctrl-click keeps the browser\'s own behaviour');
  assert.doesNotMatch(links, /stopPropagation/, 'a button\'s own handler (a logged contact) still runs');
  assert.match(links, /canUseChannel\(/, 'only an account that has WhatsApp in the system is rerouted');
  // «الغي زر واتس اللى تحت»: the floating sender (20 Oct 2026) is withdrawn; the chat opens through the links alone.
  assert.doesNotMatch(links, /WhatsAppFab|WhatsAppQuickSend|whatsapp-web\/send/);

  const booking = read('admin/pages/dashboard/DashboardQuickBooking.tsx');
  assert.doesNotMatch(booking, /WhatsAppFab/);
  assert.match(booking, /aria-label="بحث في كل العملاء"/);
  assert.match(booking, /h-10 w-10 items-center justify-center rounded-full/, 'a small round button');
  assert.match(booking, /<Search size=\{17\} \/>/, 'the search mark only');
  assert.doesNotMatch(dashboardSource(), /navigate=\{navigate\}\s+notify=\{notify\}/);

  const page = read('admin/pages/dashboard/tabs/whatsapp/WhatsAppWebTab.tsx');
  assert.match(page, /const wantedPhone = params\.get\('phone'\)/);
  assert.match(page, /<WhatsAppContextCard context=\{context\} \/>/);
  assert.match(page, /chat\.courseLabel/);
});

test('a number\'s card says who it is, the course asked about or held, and the money only to whoever may see it', () => {
  const route = read('api/routes/whatsapp-web.js');
  assert.match(route, /router\.get\('\/api\/staff\/whatsapp-web\/context', \.\.\.guard/);
  assert.match(route, /canSeeMoney, viewerId: staff\?\.id/);
  assert.match(route, /courseLabelsFor\(tenant\(req\)/);
  const lib = read('api/lib/whatsappContext.js');
  assert.match(lib, /interested_course_ids_json/);
  assert.match(lib, /if \(sub && \(canSeeMoney \|\| mine\)\)/, 'a client\'s payments are not shown to anyone');
  const { contextForPhone, courseLabelsFor } = require('../lib/whatsappContext');
  assert.equal(typeof contextForPhone, 'function');
  assert.equal(typeof courseLabelsFor, 'function');
});
