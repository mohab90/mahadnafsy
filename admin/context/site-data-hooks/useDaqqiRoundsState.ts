import { useState } from 'react';
import type { MutableRefObject } from 'react';
import type { DaqqiRound } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

export function useDaqqiRoundsState(
  initialDaqqiRounds: DaqqiRound[],
  lastCRMWriteRef: MutableRefObject<number>,
  track: Track,
) {
  const [daqqiRounds, setDaqqiRounds] = useState<DaqqiRound[]>(initialDaqqiRounds);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistDaqqiRoundToCollection = (_item: DaqqiRound) => { /* PG-only */ };

  const addDaqqiRound = async (item: DaqqiRound): Promise<void> => {
    lastCRMWriteRef.current = Date.now();
    setDaqqiRounds((prev) => [item, ...prev]);
    persistDaqqiRoundToCollection(item);
    try {
      await mysqlAdmin.saveDaqqiRound(item as unknown as Record<string,unknown>);
    } catch (err) {
      // Roll back optimistic add if save fails
      setDaqqiRounds((prev) => prev.filter((r) => r.id !== item.id));
      throw err;
    }
    track('create', 'daqqiRound', item.courseId);
  };

  const updateDaqqiRound = (item: DaqqiRound) => {
    lastCRMWriteRef.current = Date.now();
    setDaqqiRounds((prev) => prev.map((r) => (r.id === item.id ? item : r)));
    persistDaqqiRoundToCollection(item);
    void mysqlAdmin.saveDaqqiRound(item as unknown as Record<string,unknown>);
    track('update', 'daqqiRound', item.courseId);
  };

  const deleteDaqqiRound = (id: string) => {
    lastCRMWriteRef.current = Date.now();
    setDaqqiRounds((prev) => prev.filter((r) => r.id !== id));
    void mysqlAdmin.deleteDaqqiRound(id);
    track('delete', 'daqqiRound', id);
  };

  // Bulk-load daqqi rounds without triggering DB saves (for non-admin staff initial load)
  const bulkSetDaqqiRounds = (rounds: DaqqiRound[]) => {
    setDaqqiRounds(prev => {
      if (prev.length > 0) {
        // Merge: DB rounds take priority; preserve any locally-added rounds not yet in DB
        const dbIds = new Set(rounds.map(r => r.id));
        const localOnly = prev.filter(r => !dbIds.has(r.id));
        return [...rounds, ...localOnly];
      }
      return rounds;
    });
  };

  return { daqqiRounds, setDaqqiRounds, addDaqqiRound, updateDaqqiRound, deleteDaqqiRound, bulkSetDaqqiRounds };
}
