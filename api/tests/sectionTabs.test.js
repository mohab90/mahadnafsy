'use strict';
// The only thing between an admin-writable blob and three render paths.
//
// section_tabs is read by العملاء المحتملين, الأونلاين and الدقي on every load.
// Whatever is in it reaches a render, so the failure mode is not a bad value —
// it is a section that will not draw. That makes "degrades to no custom tabs"
// the property worth pinning, ahead of any individual field.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeTabs, SECTION_KEYS, MAX_TABS_PER_SECTION, MAX_LABEL } = require('../lib/sectionTabs');

test('junk in any shape produces an empty, complete map rather than throwing', () => {
  // Every one of these has been a real stored-settings shape at some point in
  // this codebase's life: absent, null, the wrong type, a half-written object.
  for (const input of [undefined, null, '', 0, [], 'leads', { leads: null }, { leads: 'x' },
    { leads: [null] }, { leads: [undefined] }, { leads: [42] }, { leads: [[]] }]) {
    const out = sanitizeTabs(input);
    assert.deepEqual(Object.keys(out).sort(), [...SECTION_KEYS].sort(),
      `every section key must exist for ${JSON.stringify(input)} — a missing key is a crash downstream`);
    for (const key of SECTION_KEYS) assert.ok(Array.isArray(out[key]), `${key} must be an array`);
  }
});

test('an unnamed tab is dropped, because the label is the tab', () => {
  const out = sanitizeTabs({ leads: [
    { id: 'a', label: '   ' },
    { id: 'b' },
    { id: 'c', label: 'داتا سبتمبر' },
  ] });
  assert.deepEqual(out.leads.map(tab => tab.label), ['داتا سبتمبر'],
    'a blank label renders as a button nobody can identify or remove');
});

test('a tab that shows nothing falls back to the data table', () => {
  const out = sanitizeTabs({ leads: [
    { id: 'a', label: 'فاضي', sections: { import: false, distribute: false, data: false } },
  ] });
  assert.deepEqual(out.leads[0].sections, { import: false, distribute: false, data: true },
    'an entry that opens an empty page is worse than no entry');
});

test('an omitted panel is on, so an older stored tab keeps working', () => {
  // Tabs written before a panel existed carry no key for it. Defaulting those to
  // off would silently empty every tab saved before the next panel is added.
  const out = sanitizeTabs({ leads: [{ id: 'a', label: 'قديم' }] });
  assert.deepEqual(out.leads[0].sections, { import: true, distribute: true, data: true });
});

test('labels, sources and counts are bounded', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, label: `تاب ${i}` }));
  assert.equal(sanitizeTabs({ leads: many }).leads.length, MAX_TABS_PER_SECTION);

  const long = sanitizeTabs({ leads: [{ id: 'x'.repeat(300), label: 'ل'.repeat(200), source: 'س'.repeat(200) }] }).leads[0];
  assert.equal(long.label.length, MAX_LABEL);
  assert.ok(long.id.length <= 64);
  assert.ok((long.source || '').length <= 60);
});

test('a tab with no id is given one rather than colliding on empty string', () => {
  // Two idless tabs sharing '' would be one React key, and selecting either
  // would open the other.
  const out = sanitizeTabs({ leads: [{ label: 'أ' }, { label: 'ب' }] });
  assert.equal(out.leads.length, 2);
  assert.ok(out.leads[0].id && out.leads[1].id);
  assert.notEqual(out.leads[0].id, out.leads[1].id);
});

test('an empty source means every source, not a source named empty', () => {
  for (const source of ['', '   ', null, undefined, 0, false]) {
    assert.equal(sanitizeTabs({ leads: [{ id: 'a', label: 'ت', source }] }).leads[0].source, null,
      `source ${JSON.stringify(source)} must mean "no filter"`);
  }
  assert.equal(sanitizeTabs({ leads: [{ id: 'a', label: 'ت', source: '  واتساب  ' }] }).leads[0].source, 'واتساب');
});

test('sanitising twice changes nothing', () => {
  // It runs on write and again on read. If those disagreed, a tab would drift
  // every time it was saved.
  const once = sanitizeTabs({ leads: [{ id: 'a', label: 'داتا', source: ' فيسبوك ', sections: { import: false } }],
    online: [{ id: 'b', label: 'حجوزات' }] });
  assert.deepEqual(sanitizeTabs(once), once);
});
