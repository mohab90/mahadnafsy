'use strict';
/**
 * Staff-built tabs, reduced to something a screen can render.
 *
 * Pure, and in lib/ rather than inside the route, because it is the only thing
 * standing between an admin-writable settings blob and three render paths — and
 * a guard that cannot be tested without booting a connection pool does not get
 * tested. It runs on the way in and again on the way out: storing the raw body
 * would leave the next reader trusting whatever shape happened to be written,
 * and the next reader is a render.
 *
 * Anything unrecognised is dropped rather than passed through.
 */
const SECTION_KEYS = ['leads', 'online', 'daqqi'];
const PANELS = ['import', 'distribute', 'data'];
const MAX_TABS_PER_SECTION = 12;
const MAX_LABEL = 40;
const MAX_SOURCE = 60;

function sanitizeTabs(raw) {
  const out = {};
  for (const key of SECTION_KEYS) {
    const list = Array.isArray(raw?.[key]) ? raw[key] : [];
    out[key] = list
      .slice(0, MAX_TABS_PER_SECTION)
      .map((entry, index) => {
        const tab = entry && typeof entry === 'object' ? entry : {};
        const sections = {};
        for (const panel of PANELS) sections[panel] = tab.sections?.[panel] !== false;
        // A tab showing nothing is a menu entry that opens an empty page. The
        // data table is the one panel every batch wants, so it is the fallback.
        if (!PANELS.some(panel => sections[panel])) sections.data = true;
        return {
          id: String(tab.id ?? '').slice(0, 64) || `tab-${index}-${Math.random().toString(36).slice(2, 8)}`,
          label: String(tab.label ?? '').trim().slice(0, MAX_LABEL),
          source: tab.source ? String(tab.source).trim().slice(0, MAX_SOURCE) || null : null,
          sections,
        };
      })
      // The label is the tab. An unnamed one would render as a blank button
      // nobody can identify or remove.
      .filter(tab => tab.label);
  }
  return out;
}

module.exports = { sanitizeTabs, SECTION_KEYS, PANELS, MAX_TABS_PER_SECTION, MAX_LABEL };
