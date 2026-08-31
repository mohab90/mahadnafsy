/**
 * Tabs the staff build for themselves, inside a section they already have.
 *
 * العملاء المحتملين, الأونلاين and الدقي each work through batches of people who
 * arrive together and are worked together — an import from one campaign, a list
 * bought for one diploma, last season's walk-ins. Every batch was a request for
 * another screen, and every screen was the same three panels in a different
 * arrangement: bring the data in, hand it out, look at it.
 *
 * So the arrangement is what gets configured, not the code. A tab names a batch,
 * chooses which of the three panels it shows, and can pin itself to one source
 * so it only ever holds its own people.
 */
export const SECTION_KEYS = ['leads', 'online', 'daqqi'] as const;
export type SectionKey = typeof SECTION_KEYS[number];

export const PANELS = ['import', 'distribute', 'data'] as const;
export type PanelKey = typeof PANELS[number];

export const PANEL_LABELS: Record<PanelKey, string> = {
  import: 'استيراد عملاء',
  distribute: 'توزيع',
  data: 'إظهار داتا',
};

export const SECTION_LABELS: Record<SectionKey, string> = {
  leads: 'العملاء المحتملون',
  online: 'العملاء الأونلاين',
  daqqi: 'الدقي',
};

export type SectionTab = {
  id: string;
  label: string;
  /** Pins the tab to one lead source. null means every source. */
  source: string | null;
  sections: Record<PanelKey, boolean>;
};

export type SectionTabsMap = Record<SectionKey, SectionTab[]>;

export const emptySectionTabs = (): SectionTabsMap => ({ leads: [], online: [], daqqi: [] });

export const newSectionTab = (): SectionTab => ({
  id: `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  label: '',
  source: null,
  sections: { import: false, distribute: true, data: true },
});

/**
 * The same reduction the route applies, repeated on the way in.
 *
 * The screens render this on every load, so a stored value that has drifted —
 * an older shape, a hand-edited setting, a failed write — must come out as an
 * empty list rather than throw inside a render and take the whole section with
 * it. Trusting the server's sanitising and skipping this would put a section's
 * availability at the mercy of one bad row.
 */
export function normalizeSectionTabs(raw: unknown): SectionTabsMap {
  const source = (raw || {}) as Partial<Record<SectionKey, unknown>>;
  const out = emptySectionTabs();
  for (const key of SECTION_KEYS) {
    const list = Array.isArray(source[key]) ? source[key] as unknown[] : [];
    out[key] = list.slice(0, 12).map(entry => {
      const tab = (entry || {}) as Partial<SectionTab>;
      const sections = {} as Record<PanelKey, boolean>;
      for (const panel of PANELS) sections[panel] = tab.sections?.[panel] !== false;
      if (!PANELS.some(panel => sections[panel])) sections.data = true;
      return {
        id: String(tab.id || '').slice(0, 64) || newSectionTab().id,
        label: String(tab.label || '').trim().slice(0, 40),
        source: tab.source ? String(tab.source).trim().slice(0, 60) : null,
        sections,
      };
    }).filter(tab => tab.label);
  }
  return out;
}
