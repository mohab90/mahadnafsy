import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { cairoDay } from '../../../../../shared/cairoDate';

type Removed = { receiptNo: number; paymentId: string; amount: number; currency: string; date: string | null; staffName: string | null };
type Run = { highest: number; count: number; missing: number[]; removed: Removed[] };
type BranchGaps = Run & { branch: string; label: string; expenses?: Run; ok: boolean };

/**
 * «ولو وقع رقم يظهر للمديرين ان في مشكلة في ايصال رقم كذا مش موجود» (13 Oct 2026). The
 * branch's receipts run 1, 2, 3… (api/lib/receiptNumbers.js). For the managers — the owner,
 * the managers, accounts and the branch's own manager — a number missing from the run, or
 * whose payment was deleted, is said here, in red, with which. Nothing is drawn when the
 * sequence is whole, and nothing for anyone the endpoint does not answer.
 */
/** One run's problems — the receipts' or the expenses' — as lines under its heading; nothing when whole. */
function RunProblems({ title, noun, run, limit = 20, whole = false }: { title: string; noun: string; run: Run; limit?: number; whole?: boolean }) {
  if (!run.missing.length && !run.removed.length) return whole ? <p className="mb-1.5 text-emerald-700"><b>{title}</b> — التسلسل كامل ✓</p> : null;
  return (
    <div className="mb-1.5 last:mb-0">
      <p className="mb-1 font-bold">{title}</p>
      {run.missing.length > 0 && (
        <p>
          {run.missing.slice(0, limit).map(number => `${noun} رقم ${number}`).join('، ')}
          {run.missing.length > limit ? ` … و${run.missing.length - limit} كمان` : ''} <b>مش موجود</b> في التسلسل.
        </p>
      )}
      {run.removed.map(row => (
        <p key={row.paymentId}>
          {noun} رقم {row.receiptNo} <b>اتمسح</b> ({row.amount.toLocaleString('ar-EG-u-nu-latn')} {row.currency}
          {row.date ? ` — ${cairoDay(row.date)}` : ''}{row.staffName ? ` — سجّله ${row.staffName}` : ''}).
        </p>
      ))}
    </div>
  );
}

/**
 * «زر يرتب أرقام العمليات بالترتيب ويطلع الأرقام الناقصة»: the register is sorted by its numbers and this lists EVERY missing or removed number of
 * each branch's receipts and expenses (the alert above shows the first twenty, and nothing when whole).
 */
export function ReceiptGapsReport({ branch }: { branch?: string }) {
  const [gaps, setGaps] = useState<BranchGaps[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    mysqlAdmin.adminGet<{ branches: BranchGaps[] }>('/admin/receipts/gaps')
      .then(answer => setGaps((answer.branches || []).filter(entry => !branch || entry.branch === branch)), () => setError('تعذر فحص تسلسل الأرقام'));
  }, [branch]);
  if (error) return <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>;
  if (!gaps) return <p className="text-xs text-gray-500">بيفحص التسلسل…</p>;
  if (!gaps.length) return <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500">مفيش فروع ليها ترقيم إيصالات متسلسل.</p>;
  return (
    <div className="space-y-2 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-3 text-xs leading-relaxed text-gray-800">
      <p className="font-extrabold text-indigo-900">الأرقام الناقصة في تسلسل الإيصالات والمصروفات</p>
      {gaps.map(entry => (
        <div key={entry.branch} className="rounded-xl bg-white/80 p-2.5">
          <RunProblems whole limit={Infinity} title={`${entry.label} — ${entry.count} إيصال، آخر رقم ${entry.highest}`} noun="إيصال" run={entry} />
          {entry.expenses && <RunProblems whole limit={Infinity} title={`${entry.label} — ${entry.expenses.count} مصروف، آخر رقم ${entry.expenses.highest}`} noun="مصروف" run={entry.expenses} />}
        </div>
      ))}
      <p className="text-[11px] text-gray-500">الدفعات الأونلاين ليها رقم عام بيجري على كل الفروع، فمفيش «ناقص» بالمعنى ده فيها.</p>
    </div>
  );
}

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
        <p className="flex-1 text-sm font-extrabold">في مشكلة في تسلسل الإيصالات والمصروفات</p>
        <button type="button" onClick={load} disabled={busy} className="flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1 text-[11px] font-bold text-red-700 hover:bg-red-100 disabled:opacity-50">
          <RefreshCw size={11} className={busy ? 'animate-spin' : ''} /> فحص تاني
        </button>
      </div>
      <div className="mt-2 space-y-2">
        {broken.map(entry => (
          <div key={entry.branch} className="rounded-xl bg-white/70 p-2.5 text-xs leading-relaxed">
            <RunProblems title={`${entry.label} — ${entry.count} إيصال، آخر رقم ${entry.highest}`} noun="إيصال" run={entry} />
            {entry.expenses && <RunProblems title={`${entry.label} — ${entry.expenses.count} مصروف، آخر رقم ${entry.expenses.highest}`} noun="مصروف" run={entry.expenses} />}
          </div>
        ))}
      </div>
    </div>
  );
}
