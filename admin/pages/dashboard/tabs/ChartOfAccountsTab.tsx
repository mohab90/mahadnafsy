import { useCallback, useEffect, useState } from 'react';
import { BookOpen, CheckCircle, Loader2, Plus, Save, X } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

type Account = {
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  is_active: boolean;
  total_debit: number;
  total_credit: number;
  balance: number;
};

const typeLabels: Record<Account['type'], string> = {
  asset: 'أصل',
  liability: 'التزام',
  equity: 'حقوق ملكية',
  revenue: 'إيراد',
  expense: 'مصروف',
};

export default function ChartOfAccountsTab({ notify }: { notify: NotifyFn }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ code: '', name: '', type: 'asset' as Account['type'] });

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    try {
      setAccounts(await mysqlAdmin.adminGet<Account[]>('/admin/accounting/chart-of-accounts'));
    } catch {
      notify('error', 'فشل تحميل دليل الحسابات');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const save = async () => {
    if (!draft.code.trim() || !draft.name.trim()) return notify('error', 'يرجى إدخال كود واسم الحساب');
    setSaving(true);
    try {
      await mysqlAdmin.adminPost('/admin/accounting/chart-of-accounts', draft);
      notify('success', 'تمت إضافة الحساب');
      setDraft({ code: '', name: '', type: 'asset' });
      setShowAdd(false);
      await loadAccounts();
    } catch (error: any) {
      notify('error', error?.error || 'فشل حفظ الحساب');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (account: Account) => {
    try {
      await mysqlAdmin.adminPut(`/admin/accounting/chart-of-accounts/${encodeURIComponent(account.code)}`, { is_active: !account.is_active });
      setAccounts((items) => items.map((item) => item.code === account.code ? { ...item, is_active: !item.is_active } : item));
      notify('success', 'تم تحديث حالة الحساب');
    } catch {
      notify('error', 'فشل تحديث الحساب');
    }
  };

  const money = (value: number) => Math.abs(Number(value || 0)).toLocaleString('ar-EG');

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-900 p-5 text-white">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black"><BookOpen size={22} /> دليل الحسابات</h2>
          <p className="mt-1 text-sm text-slate-300">شجرة الحسابات مع الأرصدة الحالية لكل حساب.</p>
        </div>
        <button type="button" onClick={() => setShowAdd((value) => !value)} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-bold text-slate-900">
          {showAdd ? <X size={16} /> : <Plus size={16} />}
          {showAdd ? 'إلغاء' : 'إضافة حساب'}
        </button>
      </div>

      {showAdd && (
        <div className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-[160px_1fr_180px_auto]">
          <input className="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="كود الحساب" value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} />
          <input className="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="اسم الحساب" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <select className="rounded-lg border border-gray-300 px-3 py-2 text-sm" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as Account['type'] })}>
            {Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <button type="button" onClick={save} disabled={saving} className="flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            حفظ
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-amber-600" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3">الكود</th>
                  <th className="px-4 py-3">الحساب</th>
                  <th className="px-4 py-3">النوع</th>
                  <th className="px-4 py-3 text-left">الرصيد</th>
                  <th className="px-4 py-3 text-center">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {accounts.map((account) => (
                  <tr key={account.code} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono font-bold text-gray-700">{account.code}</td>
                    <td className="px-4 py-3 font-bold text-gray-900">{account.name}</td>
                    <td className="px-4 py-3"><span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">{typeLabels[account.type]}</span></td>
                    <td className="px-4 py-3 text-left font-bold" dir="ltr">{money(account.balance)} ج.م</td>
                    <td className="px-4 py-3 text-center">
                      <button type="button" onClick={() => toggle(account)} className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${account.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                        <CheckCircle size={13} />
                        {account.is_active ? 'نشط' : 'معطل'}
                      </button>
                    </td>
                  </tr>
                ))}
                {!accounts.length && <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">لا توجد حسابات بعد.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
