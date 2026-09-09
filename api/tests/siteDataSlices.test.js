'use strict';
/**
 * The admin context is one object built by one useMemo with thirty-seven
 * dependencies, read by seventy-two screens — so a lead poll on a timer gave it
 * a new identity and re-rendered every one of them, including the twelve that
 * read nothing but the course catalogue.
 *
 * The narrow contexts are provided around the wide one, never instead of it, so
 * a screen that has not moved cannot be affected. These tests pin that property
 * and the arrangement it depends on. Run: npm run test:unit
 */
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const provider = codeOnly(read('admin/context/SiteDataContext.tsx'));
const slices = codeOnly(read('admin/context/siteDataSlices.tsx'));

test('the wide context still wraps everything, so an unmoved screen is untouched', () => {
  assert.ok(provider.includes('<SiteDataContext.Provider value={value}>'),
    'the original provider and its value must remain');
  for (const name of ['StaticDataContext', 'CrmDataContext', 'FinanceDataContext']) {
    assert.ok(provider.includes(`<${name}.Provider`), `${name} must be provided`);
  }
  // Nested inside, so every consumer of any of them is still under the wide one.
  const wide = provider.indexOf('<SiteDataContext.Provider');
  const narrow = provider.indexOf('<StaticDataContext.Provider');
  assert.ok(wide >= 0 && narrow > wide, 'the narrow contexts nest inside the wide one');
});

test('a slice cannot drift from the value the provider actually supplies', () => {
  // Picked from SiteDataShape rather than restated: rename a field there and
  // this stops compiling, instead of silently providing undefined.
  assert.ok(slices.includes("import type { SiteDataShape } from './SiteDataContext'"));
  for (const name of ['StaticDataSlice', 'CrmDataSlice', 'FinanceDataSlice']) {
    assert.match(slices, new RegExp(`export type ${name} = Pick<SiteDataShape`),
      `${name} must be derived, not restated`);
  }
  assert.ok(provider.includes('export interface SiteDataShape'), 'and the shape must be exported');
});

test('every key a slice claims is actually put into it', () => {
  const claimed = section => {
    const start = slices.indexOf(`export type ${section} = Pick<SiteDataShape`);
    const body = slices.slice(start, slices.indexOf('>;', start));
    return (body.match(/'([a-zA-Z]+)'/g) || []).map(s => s.replace(/'/g, ''));
  };
  const provided = memo => {
    // The three memos are written slightly differently — one puts the arrow on
    // its own line — so anchor on the declaration, not on an exact spelling.
    const start = provider.indexOf(`const ${memo} = useMemo(`);
    assert.ok(start > 0, `${memo} must exist`);
    const open = provider.indexOf('({', start);
    const close = provider.indexOf('})', open);
    // Include the closing brace, or the last key has nothing after it to match.
    const body = provider.slice(open, close + 1);
    return (body.match(/\b([a-zA-Z]+)\b(?=\s*[,}])/g) || []).map(s => s.trim());
  };
  for (const [type, memo] of [
    ['StaticDataSlice', 'staticSlice'],
    ['CrmDataSlice', 'crmSlice'],
    ['FinanceDataSlice', 'financeSlice'],
  ]) {
    const missing = claimed(type).filter(key => !provided(memo).includes(key));
    assert.deepEqual(missing, [], `${memo} does not provide: ${missing.join(', ')}`);
  }
});

test('every moved screen reads only what its own slice carries', () => {
  // Checked against the slice each screen actually subscribes to, so a screen
  // cannot be moved onto a hook that does not supply one of its reads.
  const keysOf = section => {
    const start = slices.indexOf(`export type ${section} = Pick<SiteDataShape`);
    const body = slices.slice(start, slices.indexOf('>;', start));
    return new Set((body.match(/'([a-zA-Z]+)'/g) || []).map(s => s.replace(/'/g, '')));
  };
  const byHook = {
    useStaticData: keysOf('StaticDataSlice'),
    useCrmData: keysOf('CrmDataSlice'),
    useFinanceData: keysOf('FinanceDataSlice'),
  };

  const root = path.join(__dirname, '..', '..');
  const walk = dir => fs.readdirSync(dir).flatMap(name => {
    if (name === 'node_modules' || name === 'dist') return [];
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });

  let checked = 0;
  for (const file of walk(path.join(root, 'admin'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [hook, allowed] of Object.entries(byHook)) {
      const destructure = new RegExp('const\\s*\\{([^}]*)\\}\\s*=\\s*' + hook + '\\(\\);');
      const match = source.match(destructure);
      if (!match) continue;
      checked += 1;
      const rel = path.relative(root, file).split(path.sep).join('/');
      assert.ok(!/=\s*useSiteData\(\)/.test(source),
        `${rel} still subscribes to the wide context, so the move bought nothing`);
      for (const key of match[1].split(',').map(s => s.split(':')[0].trim()).filter(Boolean)) {
        assert.ok(allowed.has(key), `${rel} reads ${key}, which ${hook} does not carry`);
      }
    }
  }
  assert.ok(checked >= 27, `expected every moved screen, found ${checked}`);
});

test('the twelve static screens moved as recorded', () => {
  const staticKeys = (() => {
    const start = slices.indexOf('export type StaticDataSlice = Pick<SiteDataShape');
    const body = slices.slice(start, slices.indexOf('>;', start));
    return new Set((body.match(/'([a-zA-Z]+)'/g) || []).map(s => s.replace(/'/g, '')));
  })();

  const moved = [
    'admin/components/PaymentModal.tsx',
    'admin/hooks/useBranches.ts',
    'admin/pages/dashboard/tabs/AdminAiSettingsTab.tsx',
    'admin/pages/dashboard/tabs/consultations/ConsultationSettingsTab.tsx',
    'admin/pages/dashboard/tabs/courses/BundlesPanel.tsx',
    'admin/pages/dashboard/tabs/courses/DiscountsView.tsx',
    'admin/pages/dashboard/tabs/courses/TestimonialsPanel.tsx',
    'admin/pages/dashboard/tabs/CourseWaitlistTab.tsx',
    'admin/pages/dashboard/tabs/financial/PaymentReviewPanel.tsx',
    'admin/pages/dashboard/tabs/LiveStreamsTab.tsx',
    'admin/pages/dashboard/tabs/MessagingAgentTab.tsx',
    'admin/pages/JoinUs.tsx',
  ];

  for (const file of moved) {
    const source = read(file);
    assert.ok(source.includes('useStaticData()'), `${file} must use the narrow hook`);
    assert.ok(!/=\s*useSiteData\(\)/.test(source),
      `${file} still subscribes to the wide context, so the move bought nothing`);
    const destructure = source.match(/const\s*\{([^}]*)\}\s*=\s*useStaticData\(\);/);
    assert.ok(destructure, `${file} must destructure from it`);
    for (const key of destructure[1].split(',').map(s => s.split(':')[0].trim()).filter(Boolean)) {
      assert.ok(staticKeys.has(key), `${file} reads ${key}, which the static slice does not carry`);
    }
  }
});
