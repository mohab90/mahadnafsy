import { useState } from 'react';

import type { SalesTarget } from '../../../../types';

const STORAGE_KEY = 'crm.salesTargets';

function readSalesTargets(): SalesTarget[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useSalesTargetsStorage() {
  const [salesTargets, setSalesTargets] = useState<SalesTarget[]>(readSalesTargets);

  const saveSalesTargets = (targets: SalesTarget[]) => {
    setSalesTargets(targets);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(targets));
  };

  return { salesTargets, saveSalesTargets };
}
