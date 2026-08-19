import { useCallback, useEffect, useState } from 'react';
import { FileText, Loader2, Plus, Save, X } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type Account = { code: string; name: string };
type LineDraft = { account_code: string; account_name: string; debit: string; credit: string };
type JournalLine = { id: string; entry_id: string; account_code: string; account_name: string; debit: number; credit: number };
type JournalEntry = { id: string; ref_type: string; entry_date: string; description: string; total_debit: number; total_credit: number; posted_by: string };

export default function JournalEntriesTab({ notify }: { notify: NotifyFn }) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [lines, setLines] = useState<Record<string, JournalLine[]>>({});
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    date: new Date().toISOString().slice(0, 10),
    description: '',
    lines: [
      { account_code: '', account_name: '', debit: '', credit: '' },
      { account_code: '', account_name: '', debit: '', credit: '' },
    ] as LineDraft[],
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [accountRows, journal] = await Promise.all([
        mysqlAdmin.adminGet<Account[]>('/admin/accounting/chart-of-accounts'),
        mysqlAdmin.adminGet<{ entries: JournalEntry[]; lines: Record<string, JournalLine[]> }>('/admin/reports/journal?limit=30'),
      ]);
      setAccounts(accountRows || []);
      setEntries(journal.entries || []);
      setLines(journal.lines || {});
    } catch {
      notify('error', 'فشل تحميل قيود اليومية');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const updateLine = (index: number, field: keyof LineDraft, value: string) => {
    const next = [...draft.lines];
    next[index] = { ...next[index], [field]: value };
    if (field === 'account_code') {
      const account = accounts.find((item) => item.code === value);
      if (account) next[index].account_name = account.name;
    }
    setDraft({ ...draft, lines: next });
  };

  const save = async () => {
    const validLines = draft.lines.filter((line) => line.account_code && (Number(line.debit || 0) > 0 || Number(line.credit || 0) > 0));
    const debit = validLines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
    const credit = validLines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
    if (!draft.description.trim() || validLines.length < 2) return notify('error', 'أدخل وصف القيد وسطرين صحيحين على الأقل');
    if (Math.abs(debit - credit) > 0.01 || debit <= 0) return notify('error', 'القيد غير متوازن');

    setSaving(true);
    try {
      await mysqlAdmin.adminPost('/admin/accounting/journal-entries', { date: draft.date, description: draft.description, lines: validLines });
      notify('success', 'تم ترحيل قيد اليومية');
      setShowAdd(false);
      setDraft({ date: new Date().toISOString().slice(0, 10), description: '', lines: [{ account_code: '', account_name: '', debit: '', credit: '' }, { account_code: '', account_name: '', debit: '', credit: '' }] });
      await load();
    } catch (error: any) {
      notify('error', error?.error || 'فشل حفظ القيد');
    } finally {
      setSaving(false);
    }
  };

  const money = (value: number) => Math.abs(Number(value || 0)).toLocaleString('ar-EG');

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-900 p-5 text-white">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black"><FileText size={22} /> قيود اليومية</h2>
          <p className="mt-1 text-sm text-slate-300">دفتر القيود التلقائية واليدوية كأساس للتقارير المالية.</p>
        </div>
        <button type="button" onClick={() => setShowAdd((value) => !value)} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-bold text-slate-900">
          {showAdd ? <X size={16} /> : <Plus size={16} />}
          {showAdd ? 'إلغاء' : 'قيد يدوي'}
        </button>
      </div>

      {showAdd && (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <div className="grid gap-3 md:grid-cols-[180px_1fr]">
            <input type="date" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} />
            <input className="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="وصف القيد" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 text-gray-600"><tr><th className="px-3 py-2">الحساب</th><th className="w-32 px-3 py-2">مدين</th><th className="w-32 px-3 py-2">دائن</th><th className="w-10" /></tr></thead>
              <tbody>
                {draft.lines.map((line, index) => (
                  <tr key={index} className="border-t border-gray-100">
                    <td className="px-2 py-2">
                      <select className="w-full rounded-lg border border-gray-200 px-2 py-1" value={line.account_code} onChange={(event) => updateLine(index, 'account_code', event.target.value)}>
                        <option value="">اختر الحساب</option>
                        {accounts.map((account) => <option key={account.code} value={account.code}>{account.name} ({account.code})</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-2"><input className="w-full rounded-lg border border-gray-200 px-2 py-1" value={line.debit} onChange={(event) => updateLine(index, 'debit', event.target.value)} /></td>
                    <td className="px-2 py-2"><input className="w-full rounded-lg border border-gray-200 px-2 py-1" value={line.credit} onChange={(event) => updateLine(index, 'credit', event.target.value)} /></td>
                    <td className="px-2 py-2"><button type="button" onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== index) })} className="text-red-500"><X size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between gap-3">
            <button type="button" onClick={() => setDraft({ ...draft, lines: [...draft.lines, { account_code: '', account_name: '', debit: '', credit: '' }] })} className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-bold text-gray-700">إضافة سطر</button>
            <button type="button" onClick={save} disabled={saving} className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              ترحيل القيد
            </button>
          </div>
        </div>
      )}

      {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-amber-600" /></div> : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <div key={entry.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-gray-50 px-4 py-3">
                <div>
                  <div className="font-black text-gray-900">{entry.description || entry.ref_type}</div>
                  <div className="text-xs text-gray-500">{new Date(entry.entry_date).toLocaleDateString('ar-EG')} - {entry.ref_type}</div>
                </div>
                <div className="text-sm font-black text-gray-700" dir="ltr">{money(entry.total_debit)} / {money(entry.total_credit)} ج.م</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <tbody className="divide-y divide-gray-100">
                    {(lines[entry.id] || []).map((line) => (
                      <tr key={line.id}>
                        <td className="px-4 py-2 font-bold">{line.account_name} <span className="text-xs text-gray-400">({line.account_code})</span></td>
                        <td className="w-32 px-4 py-2 text-left text-green-700">{Number(line.debit) > 0 ? money(line.debit) : '-'}</td>
                        <td className="w-32 px-4 py-2 text-left text-red-700">{Number(line.credit) > 0 ? money(line.credit) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {!entries.length && <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-gray-400">لا توجد قيود يومية.</div>}
        </div>
      )}
    </div>
  );
}
