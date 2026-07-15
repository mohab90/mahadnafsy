import { X } from 'lucide-react';
import type React from 'react';
import type { DaqqiRound, DaqqiRoundAttendee, SubscriberItem } from '../../../types';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface DaqqiHousingModalProps {
  subscriber: SubscriberItem | null;
  roundId: string;
  rounds: DaqqiRound[];
  housingMap: Map<string, { roundId: string; roundCode: string; receptionId: string; receptionName: string }>;
  setRoundId: (value: string) => void;
  setRounds: React.Dispatch<React.SetStateAction<DaqqiRound[] | null>>;
  notify: NotifyFn;
  onClose: () => void;
}

export function DaqqiHousingModal({
  subscriber,
  roundId,
  rounds,
  housingMap,
  setRoundId,
  setRounds,
  notify,
  onClose,
}: DaqqiHousingModalProps) {
  if (!subscriber) return null;

  const confirmHousing = async () => {
    const round = rounds.find((item) => item.id === roundId);
    if (!round) return;

    const newAttendee: DaqqiRoundAttendee = {
      subscriberId: subscriber.id,
      name: subscriber.name,
      phone: subscriber.phone || '',
      bookedAt: new Date().toISOString(),
      amountPaid: 0,
    };
    const updatedRounds = rounds.map((item) => {
      const attendees = (item.attendees ?? []).filter((attendee) => attendee.subscriberId !== subscriber.id);
      return item.id === round.id ? { ...item, attendees: [...attendees, newAttendee] } : { ...item, attendees };
    });

    await mysqlAdmin.saveDaqqiRound(updatedRounds.find((item) => item.id === round.id) as unknown as Record<string, unknown>);
    setRounds(updatedRounds);
    notify('success', `✅ تم تسكين ${subscriber.name} في روند ${round.code}`);
    setRoundId('');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" dir="rtl" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-800">🏠 تسكين العميل في روند</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <p className="text-sm text-gray-600 mb-4">العميل: <strong>{subscriber.name}</strong></p>
        <select
          value={roundId}
          onChange={(event) => setRoundId(event.target.value)}
          className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          <option value="">— اختر الروند —</option>
          {rounds.map((round) => (
            <option key={round.id} value={round.id}>{round.code} — {round.receptionName} — {round.dayOfWeek} {round.timeSlot}</option>
          ))}
        </select>
        {roundId && housingMap.has(subscriber.id) && (
          <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-3">⚠️ هذا العميل مسكن بالفعل — سيتم تغيير الروند.</p>
        )}
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200">إلغاء</button>
          <button disabled={!roundId} onClick={confirmHousing} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:opacity-40">تأكيد التسكين</button>
        </div>
      </div>
    </div>
  );
}
