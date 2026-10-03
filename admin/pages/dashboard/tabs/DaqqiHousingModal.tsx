import { useState } from 'react';
import { Home } from 'lucide-react';
import { Modal } from '../../../../shared/ui/Modal';
import { confirmDialog } from '../../../../shared/ui/confirmDialog';
import { useSiteData } from '../../../context/SiteDataContext';
import type { DaqqiRound, SubscriberItem } from '../../../types';
import { DaqqiRoundPicker } from './daqqi/DaqqiRoundPicker';
import { courseIdsHeldIn, housingDecision } from './daqqi/daqqiScheduleUtils';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface DaqqiHousingModalProps {
  subscriber: SubscriberItem | null;
  roundId: string;
  rounds: DaqqiRound[];
  housingMap: Map<string, { roundId: string; roundCode: string; receptionId: string; receptionName: string }>;
  setRoundId: (value: string) => void;
  notify: NotifyFn;
  onClose: () => void;
}

/**
 * «تسكين» from «عملاء الدقي»: pick a round — its number, the doctor and the
 * appointment — and the client is seated in it. The same picker the schedule and
 * the booking screen use.
 */
export function DaqqiHousingModal({
  subscriber,
  roundId,
  rounds,
  housingMap,
  setRoundId,
  notify,
  onClose,
}: DaqqiHousingModalProps) {
  const { courses, bundles, bookDaqqiAttendee, transferDaqqiAttendee } = useSiteData();
  const [saving, setSaving] = useState(false);
  if (!subscriber) return null;

  const current = housingMap.get(subscriber.id);
  // Rounds the client is not already in. They stay in the list of their other courses.
  const available = rounds.filter(round => !round.attendees.some(attendee => attendee.subscriberId === subscriber.id));

  const confirmHousing = async () => {
    const round = rounds.find(item => item.id === roundId);
    if (!round) return;
    const decision = housingDecision(rounds, subscriber.id, round);
    if (decision.kind === 'already') {
      notify('info', `${subscriber.name} مُسكَّن بالفعل في روند ${round.code}`);
      return;
    }
    setSaving(true);
    try {
      let saved: boolean;
      if (decision.kind === 'move') {
        if (!await confirmDialog(`${subscriber.name} مُسكَّن في روند ${decision.from.code} لنفس الكورس. تنقله لروند ${round.code}؟`)) return;
        saved = await transferDaqqiAttendee(subscriber.id, decision.from.id, round.id);
      } else {
        saved = await bookDaqqiAttendee(subscriber.id, round.id);
      }
      if (!saved) {
        notify('error', 'تعذر حفظ التسكين؛ لم يتم تغيير الروندات.');
        return;
      }
      notify('success', `✅ تم تسكين ${subscriber.name} في روند ${round.code}`);
      setRoundId('');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="تسكين العميل في روند"
      icon={<Home size={18} className="text-indigo-600" />}
      subtitle={subscriber.name}
      size="md"
      footer={(
        <>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200">إلغاء</button>
          <button disabled={!roundId || saving} onClick={confirmHousing} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:opacity-40">
            {saving ? 'جارٍ التسكين…' : 'تأكيد التسكين'}
          </button>
        </>
      )}
    >
      {current && (
        <p className="mb-3 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
          مُسكَّن حاليًا في روند <b>{current.roundCode}</b>. تسكينه في روند تاني بيضيفه عليه، ولو الكورس نفسه بنسألك تنقله.
        </p>
      )}
      <DaqqiRoundPicker
        rounds={available}
        courses={courses}
        selectedId={roundId}
        onSelect={setRoundId}
        clientCourseIds={courseIdsHeldIn(available, bundles, subscriber.enrolledCourseIds || [])}
        currentRoundId={current?.roundId}
        emptyText="العميل مُسكَّن في كل الروندات المتاحة."
      />
    </Modal>
  );
}
