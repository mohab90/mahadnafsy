import { useState } from 'react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { confirmDialog } from '../../../../../shared/ui/confirmDialog';

type Candidate = { id: string; clientCode: string | null; name: string; phone: string | null; email: string | null; linkedToLiveAccount: boolean };

/** «العميلة بتدخل على حسابها تلاقي مفيش كورسات»: a site sign-up that is the same person as a client record, linked by a member of the staff. */
export function LinkAccount({ row, onLinked }: { row: { id: string; name: string; email: string | null; phone: string | null }; onLinked: () => void }) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const open = async () => {
    setBusy(true); setMessage('');
    try {
      const result = await mysqlAdmin.adminGet<{ candidates: Candidate[] }>(`/admin/site-accounts/${encodeURIComponent(row.id)}/candidates`);
      setCandidates(result.candidates);
      if (!result.candidates.length) setMessage('مفيش عميل بنفس الاسم — افتح ملف العميل الصح واربطه من الإيميل أو الرقم');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر البحث'); } finally { setBusy(false); }
  };
  const link = async (candidate: Candidate) => {
    const ok = await confirmDialog({
      title: 'ربط حساب الموقع بالعميل',
      message: `${row.email || row.phone || row.name} ← ${candidate.name} ${candidate.clientCode || ''}\nلما تربطهم هيشوف العميل كل كورساته ومدفوعاته لما يدخل. اتأكد إنهم نفس الشخص.${candidate.linkedToLiveAccount ? '\nالعميل ده مربوط بحساب موقع تاني شغال وهيتفك عنه.' : ''}`,
      confirmLabel: 'اربط',
      tone: 'normal',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await mysqlAdmin.adminPost(`/admin/site-accounts/${encodeURIComponent(row.id)}/link`, { subscriberId: candidate.id, force: candidate.linkedToLiveAccount });
      onLinked();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر الربط'); setBusy(false); }
  };
  if (!candidates) {
    return (
      <div>
        <button type="button" disabled={busy} onClick={() => void open()} className="rounded-lg bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white disabled:opacity-50">{busy ? '...' : 'ربطه بعميل'}</button>
        {message && <p className="mt-1 text-[10px] text-amber-700">{message}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {candidates.map(candidate => (
        <button key={candidate.id} type="button" disabled={busy} onClick={() => void link(candidate)}
          className="block w-full rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-right text-[10px] font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">
          اربطه بـ {candidate.name} {candidate.clientCode || ''} {candidate.phone ? `· ${candidate.phone}` : ''}
        </button>
      ))}
      {message && <p className="text-[10px] text-amber-700">{message}</p>}
    </div>
  );
}
