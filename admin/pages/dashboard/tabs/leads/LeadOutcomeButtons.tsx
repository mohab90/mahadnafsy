import { useState } from 'react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { LeadItem } from '../../../../types';

/**
 * The four things a rep actually does after speaking to someone.
 *
 * Recording a call used to take three screens: change the status in one place,
 * write the note in another, set the next follow-up in a third. So it was not
 * done — 22 leads out of 15,936 had a follow-up scheduled, and 19 had any
 * communication at all, while 332 had been converted.
 *
 * One tap now does all three in a single request. The interactions endpoint
 * already accepted a status and a follow-up date alongside the note; nothing on
 * the screen had ever sent them together.
 *
 * The follow-up gaps are deliberate rather than uniform. Someone who did not
 * answer is worth trying again tomorrow; someone who answered and is thinking
 * needs a couple of days, not a nudge in the morning. "Not interested" schedules
 * nothing, because scheduling a follow-up for a closed lead is how a reminder
 * list fills with work nobody intends to do.
 */

type Outcome = {
  key: string;
  label: string;
  status: string;
  note: string;
  /** Days until the next follow-up, or null to schedule none. */
  followUpInDays: number | null;
  className: string;
};

const OUTCOMES: Outcome[] = [
  {
    key: 'answered',
    label: 'رد',
    status: 'contacted',
    note: 'رد على الاتصال',
    followUpInDays: 2,
    className: 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100',
  },
  {
    key: 'no_answer',
    label: 'لم يرد',
    status: 'no_answer',
    note: 'لم يرد على الاتصال',
    followUpInDays: 1,
    className: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
  },
  {
    key: 'interested',
    label: 'مهتم',
    status: 'interested',
    note: 'أبدى اهتمامه',
    followUpInDays: 2,
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
  },
  {
    key: 'not_interested',
    label: 'غير مهتم',
    status: 'not_interested',
    note: 'غير مهتم',
    followUpInDays: null,
    className: 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100',
  },
];

/** Local calendar date, so "tomorrow" is the desk's tomorrow rather than UTC's. */
function inDays(days: number): string {
  const when = new Date();
  when.setDate(when.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}

export default function LeadOutcomeButtons({
  lead,
  onRecorded,
}: {
  lead: LeadItem;
  /** Called once the entry has landed, so the board can refresh. */
  onRecorded?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const record = async (outcome: Outcome) => {
    if (busy) return;
    setBusy(outcome.key);
    setFailed(false);
    try {
      await mysqlAdmin.addLeadInteraction(lead.id, {
        type: 'call',
        date: new Date().toISOString().slice(0, 16).replace('T', ' '),
        notes: outcome.note,
        newStatus: outcome.status,
        ...(outcome.followUpInDays == null ? {} : { nextFollowUp: inDays(outcome.followUpInDays) }),
      });
      onRecorded?.();
    } catch {
      // Shown on the button rather than in a toast: the rep is looking right
      // here, and the thing that failed is the thing they just pressed.
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-4 gap-0.5">
        {OUTCOMES.map(outcome => (
          <button
            key={outcome.key}
            type="button"
            disabled={busy !== null}
            onClick={e => { e.stopPropagation(); record(outcome); }}
            title={outcome.followUpInDays == null
              ? outcome.note
              : `${outcome.note} · متابعة بعد ${outcome.followUpInDays} يوم`}
            className={`h-7 rounded-lg border text-[11px] font-bold transition disabled:opacity-40 ${outcome.className}`}
          >
            {busy === outcome.key ? '…' : outcome.label}
          </button>
        ))}
      </div>
      {failed && (
        <p className="text-[10px] text-rose-600">
          مسجّلش — جرّب تاني، ولو فضل بيفشل افتح العميل وسجّل من جوه.
        </p>
      )}
    </div>
  );
}
