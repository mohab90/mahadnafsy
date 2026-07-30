import { useCallback, useEffect, useRef, useState } from 'react';

import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { SalesTarget } from '../../../../types';

export function useSalesTargetsStorage(period: string) {
  const [salesTargets, setSalesTargets] = useState<SalesTarget[]>([]);
  const currentRef = useRef<SalesTarget[]>([]);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const reload = useCallback(async () => {
    const rows = await mysqlAdmin.listSalesTargets(period);
    const next = rows.map((row) => ({
      staffId: String(row.staffId || ''),
      month: String(row.period || period),
      targetEGP: Number(row.revenueTarget) || 0,
    })).filter((row) => row.staffId && row.staffId !== '__collection__');
    currentRef.current = next;
    setSalesTargets(next);
  }, [period]);

  useEffect(() => {
    reload().catch(() => window.dispatchEvent(new CustomEvent('site-persist-error', {
      detail: { field: 'salesTargets', name: period },
    })));
    const timers = timersRef.current;
    return () => { for (const timer of timers.values()) clearTimeout(timer); timers.clear(); };
  }, [period, reload]);

  const saveSalesTargets = (targets: SalesTarget[]) => {
    const previous = currentRef.current;
    currentRef.current = targets;
    setSalesTargets(targets);
    const staffIds = new Set([...previous, ...targets].filter((row) => row.month === period).map((row) => row.staffId));
    for (const staffId of staffIds) {
      const before = previous.find((row) => row.staffId === staffId && row.month === period)?.targetEGP || 0;
      const after = targets.find((row) => row.staffId === staffId && row.month === period)?.targetEGP || 0;
      if (before === after) continue;
      const oldTimer = timersRef.current.get(staffId);
      if (oldTimer) clearTimeout(oldTimer);
      timersRef.current.set(staffId, setTimeout(() => {
        timersRef.current.delete(staffId);
        mysqlAdmin.saveSalesTarget({ staffId, period, revenueTarget: after }).catch(() => {
          reload().catch(() => {});
          window.dispatchEvent(new CustomEvent('site-persist-error', {
            detail: { field: 'salesTarget', name: staffId },
          }));
        });
      }, 500));
    }
  };

  return { salesTargets, saveSalesTargets };
}
