import { useCallback, useEffect, useMemo, useState } from 'react';
import { GitMerge } from 'lucide-react';
import { Modal } from '../../../../../shared/ui/Modal';
import { confirmDialog } from '../../../../../shared/ui/confirmDialog';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;
type Member = { name: string; rows: number; total: number; registered: boolean };
type Group = { target: string; members: Member[]; why: string };
type Account = Member;
type Overview = { registered: string[]; accounts: Account[]; groups: Group[] };

const money = (n: number) => Math.round(n).toLocaleString('ar-EG-u-nu-latn');

/**
 * «حساب 1010 وحساب 1079 دول حساب واحد ادمجهم … وحسابين 4645».
 *
 * The ledger's «وصل على» is free text, so one wallet shows up under its first four digits, its last four,
 * its whole number, with or without the rail. The server finds the names that are one account
 * (lib/transferAccounts.js) and this offers to move them onto the one the settings list knows — in one
 * click, and by hand for the ones nothing could tell. Managers only; nothing moves until they confirm.
 */
export function TransferAccountsMerge({ notify, onMerged }: { notify: Notify; onMerged: () => void | Promise<void> }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setOverview(await mysqlAdmin.adminGet<Overview>('/admin/incoming-transfers/accounts'));
    } catch { setOverview(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const merge = async (from: string[], to: string) => {
    setBusy(true);
    try {
      const result = await mysqlAdmin.adminPost<{ moved: number; target: string; stuck: { reference: string; method: string }[] }>(
        '/admin/incoming-transfers/merge-accounts', { from, to });
      if (result.stuck?.length) {
        notify('info', `اتدمج ${result.moved} تحويل في «${result.target}». فاضل ${result.stuck.length} برقم عملية متسجل على الحساب الجديد — راجعهم: ${result.stuck.slice(0, 3).map(row => row.reference).join('، ')}`);
      } else {
        notify('success', `اتدمج ${result.moved} تحويل في «${result.target}».`);
      }
      await Promise.all([load(), onMerged()]);
      setOpen(false);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر الدمج');
    } finally { setBusy(false); }
  };

  const mergeGroup = async (group: Group) => {
    const from = group.members.map(member => member.name).filter(name => name !== group.target);
    const ok = await confirmDialog({
      title: 'دمج الحسابات',
      message: `هيتنقل كل تحويل على ${from.map(name => `«${name}»`).join(' و')} إلى «${group.target}». الدفعات المربوطة مش بتتأثر.`,
      confirmLabel: 'ادمج', tone: 'normal',
    });
    if (ok) await merge(from, group.target);
  };

  if (!overview) return null;
  const { groups } = overview;
  return (
    <>
      {groups.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-bold text-amber-900">⚠️ حسابات مكررة في التحويلات — نفس الحساب بأكتر من اسم</p>
          {groups.map(group => (
            <div key={group.target} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-amber-800">
                {group.members.map(member => `${member.name} (${member.rows})`).join('  +  ')}
                <span className="mr-1 text-[10px] text-amber-600">· {group.why}</span>
              </span>
              <button type="button" disabled={busy} onClick={() => void mergeGroup(group)}
                className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1 font-bold text-white hover:bg-amber-700 disabled:opacity-50">
                <GitMerge size={12} /> ادمجهم في «{group.target}»
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-bold text-gray-600 hover:bg-gray-50">
        <GitMerge size={12} /> دمج حسابات يدوي
      </button>
      {open && <ManualMerge overview={overview} busy={busy} onClose={() => setOpen(false)} onMerge={merge} />}
    </>
  );
}

function ManualMerge({ overview, busy, onClose, onMerge }: { overview: Overview; busy: boolean; onClose: () => void; onMerge: (from: string[], to: string) => Promise<void> }) {
  const suggested = useMemo(() => new Set(overview.groups.flatMap(group => group.members.map(member => member.name))), [overview]);
  const [picked, setPicked] = useState<string[]>([]);
  const targets = [...new Set([...overview.registered, ...overview.accounts.map(account => account.name)])];
  const [target, setTarget] = useState(overview.registered[0] || overview.accounts[0]?.name || '');
  const from = picked.filter(name => name !== target);
  return (
    <Modal open onClose={onClose} size="md" title="دمج حسابات التحويلات" icon={<GitMerge size={16} />}
      subtitle="علّم الحسابات اللي هي حساب واحد، واختار الاسم اللي هتتجمع فيه">
      <div className="space-y-3 text-sm" dir="rtl">
        <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-gray-200 p-2">
          {overview.accounts.map(account => (
            <label key={account.name} className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-gray-50 ${picked.includes(account.name) ? 'bg-blue-50' : ''}`}>
              <input type="checkbox" checked={picked.includes(account.name)} disabled={account.name === target}
                onChange={event => setPicked(current => (event.target.checked ? [...current, account.name] : current.filter(name => name !== account.name)))} />
              <span className="flex-1 font-semibold text-gray-800">{account.name}</span>
              {account.registered && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">مسجّل في الإعدادات</span>}
              {suggested.has(account.name) && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">مقترح</span>}
              <span className="text-[10px] text-gray-500">{account.rows} تحويل · {money(account.total)}</span>
            </label>
          ))}
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-700">يتجمعوا في</span>
          <select value={target} onChange={event => setTarget(event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm">
            {targets.map(name => <option key={name} value={name}>{name}{overview.registered.includes(name) ? ' — مسجّل' : ''}</option>)}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-bold text-gray-600">إلغاء</button>
          <button type="button" disabled={busy || !from.length || !target} onClick={() => void onMerge(from, target)}
            className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">
            ادمج {from.length || ''} {from.length === 1 ? 'حساب' : 'حسابات'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
