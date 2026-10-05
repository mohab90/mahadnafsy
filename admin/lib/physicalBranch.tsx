// Which physical branch the Dokki screens are showing — Dokki, or Tagamoa.
//
// «خلي في قسم لفرع التجمع زي بتاع الدقي بالظبط في كل التفاصيل». The Tagamoa
// section is the Dokki section with another branch in this context: its tabs
// (tagamoa_*) render the daqqi_* screens, and every screen reads the branch
// from here instead of writing 'DAQQI' (api/lib/physicalBranches.js holds the
// server half).
import React, { createContext, useContext } from 'react';

export type PhysicalBranchKey = 'DAQQI' | 'TAGAMOA';

export interface PhysicalBranchInfo {
  key: PhysicalBranchKey;
  /** «الدقي» / «التجمع» */
  label: string;
  /** branches.id of the branch. */
  branchId: string;
  /** The financial screens' lower-case filter. */
  filter: 'daqqi' | 'tagamoa';
}

export const PHYSICAL_BRANCHES: Record<PhysicalBranchKey, PhysicalBranchInfo> = {
  DAQQI: { key: 'DAQQI', label: 'الدقي', branchId: 'branch-daqqi', filter: 'daqqi' },
  TAGAMOA: { key: 'TAGAMOA', label: 'التجمع', branchId: 'branch-tagamoa', filter: 'tagamoa' },
};

const Context = createContext<PhysicalBranchInfo>(PHYSICAL_BRANCHES.DAQQI);

export function PhysicalBranchProvider({ branch, children }: { branch: PhysicalBranchKey; children: React.ReactNode }) {
  return <Context.Provider value={PHYSICAL_BRANCHES[branch]}>{children}</Context.Provider>;
}

export const usePhysicalBranch = () => useContext(Context);

/**
 * A Tagamoa tab and the Dokki screen it shows: tagamoa_schedule → daqqi_schedule,
 * tagamoa_waitlist → waitlist. Any other tab is itself, at Dokki.
 */
export function screenForTab(tab: string): { screen: string; branch: PhysicalBranchKey } {
  if (tab === 'tagamoa_waitlist') return { screen: 'waitlist', branch: 'TAGAMOA' };
  if (tab.startsWith('tagamoa_')) return { screen: `daqqi_${tab.slice('tagamoa_'.length)}`, branch: 'TAGAMOA' };
  return { screen: tab, branch: 'DAQQI' };
}

/** The tab a Dokki screen's own link should open while showing `branch`. */
export function tabForScreen(screen: string, branch: PhysicalBranchKey): string {
  if (branch !== 'TAGAMOA') return screen;
  if (screen === 'waitlist') return 'tagamoa_waitlist';
  if (screen.startsWith('daqqi_')) return `tagamoa_${screen.slice('daqqi_'.length)}`;
  return screen;
}

/** The branch a staff role is confined to, when it is a branch role. */
export function branchOfRole(role?: string | null): PhysicalBranchKey | null {
  const r = String(role || '').toLowerCase();
  if (r === 'daqqi_manager' || r === 'reception_daqqi') return 'DAQQI';
  if (r === 'tagamoa_manager' || r === 'reception_tagamoa') return 'TAGAMOA';
  return null;
}
