// «اعملي مساحه اعدل المكافات» (9 Nov 2026): an employee's bonuses and extra deductions for the month, right under their row in the month sheet — what is
// approved, what waits for approval (the system's own month bonus among them, from «نظام المكافآت»), and a form to add one. A new one waits for someone
// else's approval in «اعتمادات المرتبات», as from the employee's edit window; a pending one can be withdrawn here.
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { fmtMoney } from './hrFormat';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;
type Bonus = { id: string; type: 'bonus' | 'deduction'; amount: number | string; status: string; reason: string | null; for_month: number | null; for_year: number | null; source?: string | null };

const STATUS: Record<string, [string, string]> = {
  APPROVED: ['معتمدة', 'bg-emerald-100 text-emerald-700'],
  PENDING: ['مستنية الاعتماد', 'bg-amber-100 text-amber-700'],
  REJECTED: ['مرفوضة', 'bg-gray-100 text-gray-500'],
};

export default function HrBonusInlineEditor({ staffId, name, month, notify, onSaved }: { staffId: string; name: string; month: string; notify: Notify; onSaved: () => void }) {
  const [y, m] = month.split('-');
  const [rows, setRows] = useState<Bonus[] | null>(null);
  const [draft, setDraft] = useState({ type: 'bonus' as 'bonus' | 'deduction', amount: '', reason: '' });
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const list = await mysqlAdmin.adminGet<Bonus[]>(`/admin/hr/employees/${encodeURIComponent(staffId)}/bonuses`);
      setRows((Array.isArray(list) ? list : []).filter(b => Number(b.for_month) === parseInt(m, 10) && Number(b.for_year) === Number(y)));
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر تحميل المكافآت'); setRows([]); }
  }, [staffId, m, y, notify]);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    const amount = Number(draft.amount);
    if (!(amount > 0)) { notify('error', 'اكتب مبلغ أكبر من صفر'); return; }
    if (!draft.reason.trim()) { notify('error', 'اكتب السبب'); return; }
    setBusy('add');
    try {
      await mysqlAdmin.adminPost(`/admin/hr/employees/${encodeURIComponent(staffId)}/bonuses`, {
        type: draft.type, amount, reason: draft.reason.trim(), for_month: parseInt(m, 10), for_year: Number(y),
      });
      notify('success', `${draft.type === 'bonus' ? 'المكافأة' : 'الخصم'} اتسجلت لـ${name} وبتستنى الاعتماد`);
      setDraft({ type: 'bonus', amount: '', reason: '' });
      await load(); onSaved();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر التسجيل'); } finally { setBusy(''); }
  };
  const remove = async (id: string) => {
    setBusy(id);
    try { await mysqlAdmin.adminDelete(`/admin/hr/bonuses/${encodeURIComponent(id)}`); await load(); onSaved(); }
    catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر الحذف'); } finally { setBusy(''); }
  };

  return (
    <div className="space-y-2" dir="rtl">
      <p className="text-xs font-extrabold text-emerald-900">مكافآت وخصومات {name} — شهر {m}/{y}</p>
      {rows === null ? <Loader2 size={14} className="animate-spin text-gray-400" /> : rows.length === 0 ? (
        <p className="text-xs text-gray-500">مفيش مكافآت ولا خصومات للشهر ده.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map(b => {
            const [label, cls] = STATUS[b.status] || [b.status, 'bg-gray-100 text-gray-600'];
            return (
              <li key={b.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-xs">
                <span className={`font-extrabold tabular-nums ${b.type === 'bonus' ? 'text-emerald-700' : 'text-red-600'}`}>{b.type === 'bonus' ? '+' : '−'}{fmtMoney(Number(b.amount))}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>{label}</span>
                {b.source === 'BONUS_PLAN' && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">من نظام المكافآت</span>}
                <span className="min-w-0 flex-1 truncate text-gray-600" title={b.reason || ''}>{b.reason || '—'}</span>
                {b.status === 'PENDING' && (
                  <button type="button" disabled={busy === b.id} onClick={() => void remove(b.id)} className="text-red-500 hover:text-red-700 disabled:opacity-40" title="سحب"><Trash2 size={13} /></button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-white p-2">
        <select value={draft.type} onChange={e => setDraft(v => ({ ...v, type: e.target.value as 'bonus' | 'deduction' }))} className="rounded-lg border border-gray-200 px-2 py-1 text-xs">
          <option value="bonus">مكافأة +</option>
          <option value="deduction">خصم −</option>
        </select>
        <input type="number" min={0} dir="ltr" placeholder="المبلغ" value={draft.amount} onChange={e => setDraft(v => ({ ...v, amount: e.target.value }))} className="w-28 rounded-lg border border-gray-200 px-2 py-1 text-xs" />
        <input placeholder="السبب (إجباري)" value={draft.reason} onChange={e => setDraft(v => ({ ...v, reason: e.target.value }))} className="min-w-[200px] flex-1 rounded-lg border border-gray-200 px-2 py-1 text-xs" />
        <button type="button" disabled={busy === 'add'} onClick={() => void add()} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white disabled:opacity-50"><Plus size={12} /> إضافة</button>
      </div>
      <p className="text-[11px] text-gray-500">أي مكافأة أو خصم جديد بيستنى اعتماد حد تاني من «اعتمادات المرتبات»، وبعدها بيدخل في مسير الشهر. مكافأة الحجوزات والتحصيل المحسوبة بتتعدّل من «نظام المكافآت».</p>
    </div>
  );
}
