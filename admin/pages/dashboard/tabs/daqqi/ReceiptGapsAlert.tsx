import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { cairoDay } from '../../../../../shared/cairoDate';

type Removed = { receiptNo: number; paymentId: string; amount: number; currency: string; date: string | null; staffName: string | null };
type BranchGaps = { branch: string; label: string; highest: number; count: number; missing: number[]; removed: Removed[]; ok: boolean };

/**
 * «ولو وقع رقم يظهر للمديرين ان في مشكلة في ايصال رقم كذا مش موجود» (13 Oct 2026). The
 * branch's receipts run 1, 2, 3… (api/lib/receiptNumbers.js). For the managers — the owner,
 * the managers, accounts and the branch's own manager — a number missing from the run, or
 * whose payment was deleted, is said here, in red, with which. Nothing is drawn when the
 * sequence is whole, and nothing for anyone the endpoint does not answer.
 */
export function ReceiptGapsAlert({ branch }: { branch?: string }) {
  const [gaps, setGaps] = useState<BranchGaps[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setBusy(true);
    mysqlAdmin.adminGet<{ branches: BranchGaps[] }>('/admin/receipts/gaps')
      .then(answer => setGaps((answer.branches || []).filter(entry => !branch || entry.branch === branch)))
      .catch(() => setGaps([]))
      .finally(() => setBusy(false));
  }, [branch]);
  useEffect(() => { load(); }, [load]);

  const broken = gaps.filter(entry => !entry.ok);
  if (!broken.length) return null;
  return (
    <div role="alert" className="mb-3 rounded-2xl border-2 border-red-300 bg-red-50 p-4 text-red-900">
      <div className="flex items-center gap-2">
        <AlertTriangle size={18} className="text-red-600" />
        <p className="flex-1 text-sm font-extrabold">في مشكلة في تسلسل الإيصالات</p>
        <button type="button" onClick={load} disabled={busy} className="flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1 text-[11px] font-bold text-red-700 hover:bg-red-100 disabled:opacity-50">
          <RefreshCw size={11} className={busy ? 'animate-spin' : ''} /> فحص تاني
        </button>
      </div>
      <div className="mt-2 space-y-2">
        {broken.map(entry => (
          <div key={entry.branch} className="rounded-xl bg-white/70 p-2.5 text-xs leading-relaxed">
            <p className="mb-1 font-bold">{entry.label} — {entry.count} إيصال، آخر رقم {entry.highest}</p>
            {entry.missing.length > 0 && (
              <p>
                {entry.missing.slice(0, 20).map(number => `إيصال رقم ${number}`).join('، ')}
                {entry.missing.length > 20 ? ` … و${entry.missing.length - 20} كمان` : ''} <b>مش موجود</b> في التسلسل.
              </p>
            )}
            {entry.removed.map(row => (
              <p key={row.paymentId}>
                إيصال رقم {row.receiptNo} <b>اتمسح</b> ({row.amount.toLocaleString('ar-EG-u-nu-latn')} {row.currency}
                {row.date ? ` — ${cairoDay(row.date)}` : ''}{row.staffName ? ` — سجّله ${row.staffName}` : ''}).
              </p>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
