import { useState } from 'react';
import { cairoDateOnly } from '../../../shared/cairoDate';
import type { MutableRefObject } from 'react';
import type { DaqqiRound } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

// The API states these refusals in English because they are also its contract
// text. They are rules the desk has to act on, not faults, so they are said in
// Arabic here and in terms of what to do instead — "Only an empty NEW round can
// be deleted; retain operational history" reached the screen verbatim, prefixed
// with "فشل الحفظ" on an action that was a delete.
const DAQQI_RULES: Array<[RegExp, string]> = [
  [/Only an empty NEW round can be deleted/i,
    'لا يمكن حذف روند بدأت أو فيها عملاء — سجل الحضور لا يُمسح. غيّر حالتها إلى «منتهية» بدل الحذف.'],
  [/محجوزة في نفس اليوم والتوقيت/, ''],
  [/Attendance cannot be marked for a finished round/i,
    'الروند منتهية — لا يمكن تسجيل حضور عليها.'],
  [/Attendance is already recorded for this session/i,
    'الحضور مُسجَّل بالفعل لهذه الجلسة.'],
  [/Cannot transfer an attendee after attendance has started/i,
    'لا يمكن نقل عميل بعد بدء تسجيل الحضور — سجل الروند يُحفظ كما هو.'],
  [/An attendee with attendance history cannot be removed/i,
    'لا يمكن شطب عميل له سجل حضور من الروند.'],
];

export const daqqiRuleMessage = (raw: string) => {
  const text = String(raw || '');
  for (const [pattern, arabic] of DAQQI_RULES) {
    if (pattern.test(text)) return arabic || text;
  }
  return text;
};
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
    } catch (err) {
      window.dispatchEvent(new CustomEvent('site-persist-error', {
        detail: { field: 'daqqiRound', name: item.courseId, reason: err instanceof Error ? err.message : String(err) },
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
    } catch (err) {
      window.dispatchEvent(new CustomEvent('site-persist-error', {
        detail: { field: 'daqqiRound', name: item.courseId, reason: err instanceof Error ? err.message : String(err) },
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
    } catch (err) {
      window.dispatchEvent(new CustomEvent('site-persist-error', {
        detail: {
          field: 'daqqiRound',
          name: id,
          action: 'delete',
          reason: daqqiRuleMessage(err instanceof Error ? err.message : String(err)),
        },
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
            return { ...round, attendees: [...round.attendees, { ...attendee, bookedAt: cairoDateOnly() }] };
          }
          return round;
        });
      });
      track('update', 'daqqiRound', `transfer:${subscriberId}`);
      return true;
    } catch (err) {
      window.dispatchEvent(new CustomEvent('site-persist-error', {
        detail: {
          field: 'daqqiRound', name: `transfer:${subscriberId}`,
          reason: err instanceof Error ? err.message : String(err),
        },
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
