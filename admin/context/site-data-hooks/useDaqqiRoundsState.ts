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

  const addDaqqiRound = async (item: DaqqiRound) => {
    lastCRMWriteRef.current = Date.now();
    try {
      const result = await mysqlAdmin.saveDaqqiRound(item as unknown as Record<string,unknown>);
      const committed = { ...item, code: result.code || item.code };
      setDaqqiRounds((prev) => [committed, ...prev]);
      track('create', 'daqqiRound', item.courseId);
      return true;
    } catch {
      window.dispatchEvent(new CustomEvent('site-persist-error', {
        detail: { field: 'daqqiRound', name: item.courseId },
      }));
      return false;
    }
  };

  const updateDaqqiRound = async (item: DaqqiRound) => {
    lastCRMWriteRef.current = Date.now();
    try {
      await mysqlAdmin.saveDaqqiRound(item as unknown as Record<string,unknown>);
      setDaqqiRounds((prev) => prev.map((round) => round.id === item.id ? item : round));
      track('update', 'daqqiRound', item.courseId);
      return true;
    } catch {
      window.dispatchEvent(new CustomEvent('site-persist-error', {
        detail: { field: 'daqqiRound', name: item.courseId },
      }));
      return false;
    }
  };

  const deleteDaqqiRound = async (id: string) => {
    lastCRMWriteRef.current = Date.now();
    try {
      await mysqlAdmin.deleteDaqqiRound(id);
      setDaqqiRounds((prev) => prev.filter((round) => round.id !== id));
      track('delete', 'daqqiRound', id);
      return true;
    } catch {
      window.dispatchEvent(new CustomEvent('site-persist-error', {
        detail: { field: 'daqqiRound', name: id },
      }));
      return false;
    }
  };

  const transferDaqqiAttendee = async (subscriberId: string, fromRoundId: string, toRoundId: string) => {
    try {
      await mysqlAdmin.transferDaqqiAttendee({ subscriberId, fromRoundId, toRoundId });
      setDaqqiRounds((prev) => {
        const source = prev.find((round) => round.id === fromRoundId);
        const attendee = source?.attendees.find((row) => row.subscriberId === subscriberId);
        if (!attendee) return prev;
        return prev.map((round) => {
          if (round.id === fromRoundId) {
            return { ...round, attendees: round.attendees.filter((row) => row.subscriberId !== subscriberId) };
          }
          if (round.id === toRoundId) {
            return { ...round, attendees: [...round.attendees, { ...attendee, bookedAt: new Date().toISOString().slice(0, 10) }] };
          }
          return round;
        });
      });
      track('update', 'daqqiRound', `transfer:${subscriberId}`);
      return true;
    } catch {
      window.dispatchEvent(new CustomEvent('site-persist-error', {
        detail: { field: 'daqqiRound', name: `transfer:${subscriberId}` },
      }));
      return false;
    }
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

  return { daqqiRounds, setDaqqiRounds, addDaqqiRound, updateDaqqiRound, deleteDaqqiRound, transferDaqqiAttendee, bulkSetDaqqiRounds };
}
