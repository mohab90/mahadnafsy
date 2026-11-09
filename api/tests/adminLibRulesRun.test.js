'use strict';
/**
 * Browser-side rules that were regular expressions over admin/shared source, now run on the compiled modules with a fake storage and a fake fetch:
 *   • a payment's origin is online, a receipt or typed in the system — and an unknown row claims the least (admin/lib/paymentOrigin.ts);
 *   • the payment methods read from one setting, with one fallback list, configured boxes first and any box in use after them (admin/lib/paymentMethods.ts);
 *   • an owner previewing an employee's account sends the preview header on /api calls only (admin/lib/previewMode.ts);
 *   • the site-data cache is versioned, drops a stale one, and on a full disk keeps the rest of the data without its big inline pictures (shared/siteDataCache.ts).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { bundle } = require('./support/repo');

const origin = bundle('admin/lib/paymentOrigin.ts');
const methods = bundle('admin/lib/paymentMethods.ts');
const preview = bundle('admin/lib/previewMode.ts');
const cache = bundle('shared/siteDataCache.ts');
const skip = (!origin || !methods || !preview || !cache) && 'esbuild is not installed';

const store = () => {
  const data = new Map();
  return {
    data,
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: key => { data.delete(key); },
  };
};

test('where a payment came from: the gateway, an approved receipt, or typed in; the unknown claims the least', { skip }, () => {
  const { paymentOrigin, PAYMENT_ORIGIN, PAYMENT_ORIGIN_CLASS } = origin;
  assert.equal(paymentOrigin({ source: 'paymob' }), 'online');
  assert.equal(paymentOrigin({ source: 'WEB' }), 'online');
  assert.equal(paymentOrigin({ paymentMethod: 'online_paymob' }), 'online');
  assert.equal(paymentOrigin({ source: 'manual_transfer' }), 'receipt');
  assert.equal(paymentOrigin({ source: 'staff' }), 'manual');
  for (const unknown of [{}, { source: null }, { source: '' }, { source: 'something-new' }]) assert.equal(paymentOrigin(unknown), 'manual', `${JSON.stringify(unknown)}: an old row is not guessed to be a settled online payment`);
  for (const key of ['online', 'receipt', 'manual']) {
    assert.ok(PAYMENT_ORIGIN[key].label && PAYMENT_ORIGIN[key].hint, `${key} has a label and a hint`);
    assert.match(PAYMENT_ORIGIN_CLASS[key], /text-/, `${key} has a colour`);
  }
});

test('the payment methods come from one setting, with one fallback, configured boxes first and boxes in use after', { skip }, () => {
  const { parsePaymentMethods, mergePaymentBoxes, DEFAULT_PAYMENT_METHODS } = methods;
  assert.deepEqual(parsePaymentMethods('كاش|| فودافون كاش ||  ||انستا باي'), ['كاش', 'فودافون كاش', 'انستا باي']);
  for (const blank of ['', '  ', '||', undefined, null]) assert.deepEqual(parsePaymentMethods(blank), DEFAULT_PAYMENT_METHODS, 'nothing saved: the one shared list');
  assert.ok(DEFAULT_PAYMENT_METHODS.includes('كاش') && DEFAULT_PAYMENT_METHODS.includes('تحويل بنكي'));
  assert.deepEqual(mergePaymentBoxes(['كاش', 'فودافون كاش'], ['فودافون كاش', ' انستا باي ', '', 'كاش', 'انستا باي']), ['كاش', 'فودافون كاش', 'انستا باي'],
    'configured first, then a box with money against it that the settings do not mention, once each');
  assert.deepEqual(mergePaymentBoxes([], []), []);
});

test('a previewed account sends the preview header on /api calls only', { skip }, async () => {
  const session = store();
  const calls = [];
  const fakeWindow = { location: { origin: 'https://admin.example.test', pathname: '/', search: '?preview=st-9&pname=%D9%85%D9%86%D9%89' }, fetch: async (input, init) => { calls.push({ input, headers: new Headers(init?.headers) }); return { ok: true }; } };
  Object.assign(global, { window: fakeWindow, sessionStorage: session });
  try {
    assert.equal(preview.getPreview(), null, 'no preview until the address asks for one');
    preview.installPreviewFetch();
    preview.capturePreviewFromUrl();
    assert.deepEqual(preview.getPreview(), { id: 'st-9', name: 'منى' });
    preview.installPreviewFetch();
    await fakeWindow.fetch('/api/admin/leads');
    await fakeWindow.fetch('https://admin.example.test/api/admin/x', { headers: { 'X-Other': '1' } });
    await fakeWindow.fetch('https://cdn.example.test/library.js');
    await fakeWindow.fetch('/assets/app.js');
    assert.equal(calls[0].headers.get('X-Preview-Staff'), 'st-9', 'a relative /api call');
    assert.equal(calls[1].headers.get('X-Preview-Staff'), 'st-9', 'an absolute call to this origin\'s /api');
    assert.equal(calls[1].headers.get('X-Other'), '1', 'its own headers are kept');
    assert.equal(calls[2].headers.get('X-Preview-Staff'), null, 'another site never learns who is being previewed');
    assert.equal(calls[3].headers.get('X-Preview-Staff'), null, 'nor do the page\'s own assets');
    assert.match(preview.previewUrl({ id: 'st 1', name: 'منى' }), /\?preview=st%201&pname=/);
  } finally {
    delete global.window; delete global.sessionStorage;
  }
});

test('the site-data cache is versioned, drops a stale one, and on a full disk keeps the data without its big inline pictures', { skip }, () => {
  const local = store();
  global.localStorage = local;
  try {
    assert.equal(cache.readVersionedCache('k', 3), null);
    cache.writeVersionedCache('k', 3, { courses: [{ id: 'c1', title: 'كورس' }] });
    assert.deepEqual(cache.readVersionedCache('k', 3), { courses: [{ id: 'c1', title: 'كورس' }], _dataVersion: 3 });
    assert.equal(cache.readVersionedCache('k', 4), null, 'another version is not read');
    assert.equal(local.getItem('k'), null, 'and is dropped, not left to be read again');
    local.setItem('bad', '{not json');
    assert.equal(cache.readVersionedCache('bad', 1), null);
    assert.equal(local.getItem('bad'), null, 'an unreadable one is dropped too');

    // A disk that refuses the first write: the second carries the same data without the pictures stored inline.
    let attempts = 0;
    global.localStorage = { ...local, getItem: local.getItem, removeItem: local.removeItem, setItem: (key, value) => { attempts += 1; if (attempts === 1) throw new DOMException('full', 'QuotaExceededError'); local.setItem(key, value); } };
    cache.writeVersionedCache('big', 1, {
      courses: [{ id: 'c1', galleryImages: ['data:image/png;base64,AAAA', 'https://cdn.example.test/a.png'], certificateTemplateUrl: 'data:image/png;base64,BBBB' }],
      therapists: [{ id: 't1', image: 'data:image/png;base64,CCCC' }, { id: 't2', image: 'https://cdn.example.test/t.png' }],
    });
    const stored = JSON.parse(local.getItem('big'));
    assert.deepEqual(stored.courses[0].galleryImages, ['https://cdn.example.test/a.png'], 'inline pictures go, links stay');
    assert.equal(stored.courses[0].certificateTemplateUrl, '');
    assert.deepEqual(stored.therapists.map(item => item.image), ['', 'https://cdn.example.test/t.png']);
    assert.equal(stored._dataVersion, 1);

    global.localStorage = { ...local, setItem: () => { throw new Error('storage blocked'); } };
    assert.doesNotThrow(() => cache.writeVersionedCache('x', 1, { a: 1 }), 'a cache failure never blocks the page');
  } finally {
    delete global.localStorage;
  }
});
