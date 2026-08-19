import { useCallback, useEffect, useState } from 'react';
import { Building2, CheckCircle2, Download, FileText, Landmark, Plus, RefreshCw, TrendingUp, WalletCards, XCircle } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';

type Notify = (message: string, type?: 'success' | 'error') => void;
type Currency = 'EGP' | 'SAR' | 'USD';
type Vendor = { id: string; name: string; currency: Currency; is_active: number; invoice_count: number; open_amount: number };
type Payable = {
  id: string; vendor_name: string; invoice_number: string; invoice_date: string; due_date: string;
  currency: Currency; total_amount: number; paid_amount: number; remaining_amount: number;
  status: 'draft' | 'approved' | 'partially_paid' | 'paid' | 'void';
};
type Reconciliation = {
  id: string; account_code: string; period_start: string; period_end: string;
  ledger_closing_balance: number; statement_closing_balance: number; difference_amount: number;
  status: 'draft' | 'ready' | 'approved' | 'rejected';
};
type FinancialDocument = {
  id: string; document_type: 'invoice' | 'credit_note'; document_number: string;
  amount: number; currency: Currency; issued_at: string; subscriber_name?: string; source_id: string;
};
type ForecastWeek = {
  week: number; from: string; to: string; opening: number; inflows: number; outflows: number; closing: number;
};
type CashForecast = { openingCash: number; closingCash: number; weeks: ForecastWeek[]; basis: string[] };

const today = () => new Date().toISOString().slice(0, 10);
const branchValue = (branch?: string) => {
  const value = String(branch || '').toLowerCase();
  if (value.includes('daqqi') || value.includes('dokki')) return 'DAQQI';
  if (value.includes('tagamoa')) return 'TAGAMOA';
  if (value.includes('saudi')) return 'ONLINE_SAUDI';
  if (value.includes('abroad') || value.includes('international')) return 'ONLINE_ABROAD';
  return 'ONLINE_EGYPT';
};
const inputClass = 'rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary-400';

export default function FinanceOperationsPanel({ notify, branch }: { notify: Notify; branch?: string }) {
  const [mode, setMode] = useState<'payables' | 'vendors' | 'bank' | 'documents' | 'forecast'>('payables');
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [payables, setPayables] = useState<Payable[]>([]);
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([]);
  const [documents, setDocuments] = useState<FinancialDocument[]>([]);
  const [forecast, setForecast] = useState<CashForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [vendorDraft, setVendorDraft] = useState({ name: '', currency: 'EGP' as Currency, payment_terms_days: 30 });
  const [invoiceDraft, setInvoiceDraft] = useState({
    vendor_id: '', invoice_number: '', invoice_date: today(), due_date: today(),
    currency: 'EGP' as Currency, subtotal: 0, tax_amount: 0, expense_account_code: '5900',
  });
  const [bankDraft, setBankDraft] = useState({
    account_code: '1100', period_start: today(), period_end: today(),
    opening_balance: 0, statement_closing_balance: 0,
  });
  const [forecastDraft, setForecastDraft] = useState({
    direction: 'inflow' as 'inflow' | 'outflow', category: 'operations', label: '',
    amount: 0, currency: 'EGP' as Currency, cadence: 'one_time' as 'one_time' | 'weekly' | 'monthly',
    start_date: today(), end_date: '', confidence_pct: 100,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = branch ? `?branch=${encodeURIComponent(branchValue(branch))}` : '';
      const [vendorRows, payableRows, bankRows, documentRows, forecastData] = await Promise.all([
        mysqlAdmin.adminGet<Vendor[]>('/admin/finance/vendors'),
        mysqlAdmin.adminGet<Payable[]>(`/admin/finance/payables${query}`),
        mysqlAdmin.adminGet<Reconciliation[]>(`/admin/finance/bank-reconciliations${query}`),
        mysqlAdmin.adminGet<FinancialDocument[]>(`/admin/finance/documents${query}`),
        mysqlAdmin.adminGet<CashForecast>(`/admin/finance/cash-flow-forecast${query}`),
      ]);
      setVendors(Array.isArray(vendorRows) ? vendorRows : []);
      setPayables(Array.isArray(payableRows) ? payableRows : []);
      setReconciliations(Array.isArray(bankRows) ? bankRows : []);
      setDocuments(Array.isArray(documentRows) ? documentRows : []);
      setForecast(forecastData);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'تعذر تحميل عمليات الحسابات', 'error');
    } finally { setLoading(false); }
  }, [branch, notify]);

  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await action();
      notify(success, 'success');
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'تعذر تنفيذ العملية', 'error');
    } finally { setBusy(''); }
  };

  const createVendor = () => run('vendor', async () => {
    if (!vendorDraft.name.trim()) throw new Error('اسم المورد مطلوب');
    await mysqlAdmin.adminPost('/admin/finance/vendors', vendorDraft);
    setVendorDraft({ name: '', currency: 'EGP', payment_terms_days: 30 });
  }, 'تم إنشاء المورد');

  const createPayable = () => run('payable', async () => {
    if (!invoiceDraft.vendor_id || !invoiceDraft.invoice_number.trim() || Number(invoiceDraft.subtotal) <= 0) {
      throw new Error('المورد ورقم الفاتورة والقيمة مطلوبون');
    }
    await mysqlAdmin.adminPost('/admin/finance/payables', {
      ...invoiceDraft,
      branch: branchValue(branch),
    });
    setInvoiceDraft(current => ({ ...current, invoice_number: '', subtotal: 0, tax_amount: 0 }));
  }, 'تم تسجيل فاتورة المورد كمسودة');

  const payableAction = (payable: Payable, action: 'approve' | 'void' | 'pay') => {
    if (action === 'approve') {
      return run(payable.id, () => mysqlAdmin.adminPost(`/admin/finance/payables/${payable.id}/approve`, {
        branch: branch ? branchValue(branch) : undefined,
      }), 'تم اعتماد الفاتورة وترحيل قيد الاستحقاق');
    }
    if (action === 'void') {
      const reason = window.prompt('سبب إلغاء مسودة الفاتورة:')?.trim();
      if (!reason) return;
      return run(payable.id, () => mysqlAdmin.adminPost(`/admin/finance/payables/${payable.id}/void`, {
        reason, branch: branch ? branchValue(branch) : undefined,
      }), 'تم إلغاء المسودة مع حفظ الأثر');
    }
    const amount = Number(window.prompt(`قيمة السداد (المتبقي ${payable.remaining_amount} ${payable.currency}):`, String(payable.remaining_amount)));
    const reference = window.prompt('مرجع التحويل/السداد:')?.trim();
    if (!amount || !reference) return;
    return run(payable.id, () => mysqlAdmin.adminPost(`/admin/finance/payables/${payable.id}/payments`, {
      amount, reference, payment_date: today(), bank_account_code: '1100',
      branch: branch ? branchValue(branch) : undefined,
    }), 'تم سداد الفاتورة وترحيل قيد السداد');
  };

  const createReconciliation = () => run('bank', async () => {
    await mysqlAdmin.adminPost('/admin/finance/bank-reconciliations', {
      ...bankDraft,
      branch: branch ? branchValue(branch) : undefined,
    });
  }, 'تم إنشاء التسوية البنكية من دفتر الأستاذ');

  const createForecastAssumption = () => run('forecast', async () => {
    if (!forecastDraft.label.trim() || Number(forecastDraft.amount) <= 0) {
      throw new Error('اسم الافتراض وقيمته مطلوبان');
    }
    await mysqlAdmin.adminPost('/admin/finance/forecast-assumptions', {
      ...forecastDraft,
      end_date: forecastDraft.end_date || null,
      branch: branch ? branchValue(branch) : undefined,
    });
    setForecastDraft(current => ({ ...current, label: '', amount: 0 }));
  }, 'تم حفظ افتراض التدفق مع لقطة سعر الصرف');

  const addAdjustment = (row: Reconciliation) => {
    const amount = Number(window.prompt('قيمة بند التسوية بإشارته (+/-):'));
    const description = window.prompt('وصف بند التسوية:')?.trim();
    if (!amount || !description) return;
    void run(row.id, () => mysqlAdmin.adminPost(`/admin/finance/bank-reconciliations/${row.id}/items`, {
      item_date: today(), amount, description, item_type: 'other',
      branch: branch ? branchValue(branch) : undefined,
    }), 'تمت إضافة بند التسوية وإعادة حساب الفارق');
  };

  const downloadAuditPackage = async () => {
    const year = new Date().getFullYear();
    const query = new URLSearchParams({ from: `${year}-01-01`, to: today() });
    if (branch) query.set('branch', branchValue(branch));
    const response = await fetch(`/api/admin/finance/audit-package?${query}`, {
      credentials: 'include',
      headers: adminAuthHeaders(),
    });
    if (!response.ok) throw new Error(await response.text());
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `finance-audit-${year}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-extrabold text-gray-900">عمليات الحسابات المتقدمة</h3>
          <p className="text-sm text-gray-500">موردون، حسابات دائنة، قيود استحقاق وسداد، وتسوية بنكية بفصل مهام</p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-sm font-bold text-gray-700 disabled:opacity-50">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          ['payables', 'حسابات الموردين', WalletCards],
          ['vendors', 'الموردون', Building2],
          ['bank', 'التسوية البنكية', Landmark],
          ['documents', 'المستندات المالية', FileText],
          ['forecast', 'توقع 13 أسبوعًا', TrendingUp],
        ] as const).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setMode(key)}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold ${mode === key ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {mode === 'vendors' && (
        <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <div className="space-y-3 rounded-2xl border bg-white p-4">
            <h4 className="font-bold">مورد جديد</h4>
            <input className={`${inputClass} w-full`} placeholder="اسم المورد" value={vendorDraft.name}
              onChange={event => setVendorDraft({ ...vendorDraft, name: event.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <select className={inputClass} value={vendorDraft.currency}
                onChange={event => setVendorDraft({ ...vendorDraft, currency: event.target.value as Currency })}>
                <option>EGP</option><option>SAR</option><option>USD</option>
              </select>
              <input className={inputClass} type="number" min="0" max="365" value={vendorDraft.payment_terms_days}
                onChange={event => setVendorDraft({ ...vendorDraft, payment_terms_days: Number(event.target.value) })} />
            </div>
            <button onClick={createVendor} disabled={!!busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 py-2.5 font-bold text-white disabled:opacity-50">
              <Plus size={15} /> حفظ المورد
            </button>
          </div>
          <div className="overflow-hidden rounded-2xl border bg-white">
            {vendors.map(vendor => (
              <div key={vendor.id} className="flex items-center justify-between border-b px-4 py-3 last:border-0">
                <div><p className="font-bold">{vendor.name}</p><p className="text-xs text-gray-500">{vendor.currency} · {vendor.invoice_count} فاتورة</p></div>
                <span className="font-bold text-amber-700">{Number(vendor.open_amount).toLocaleString()} {vendor.currency}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === 'payables' && (
        <div className="space-y-5">
          <div className="grid gap-2 rounded-2xl border bg-white p-4 md:grid-cols-4">
            <select className={inputClass} value={invoiceDraft.vendor_id}
              onChange={event => {
                const vendor = vendors.find(item => item.id === event.target.value);
                setInvoiceDraft({ ...invoiceDraft, vendor_id: event.target.value, currency: vendor?.currency || invoiceDraft.currency });
              }}>
              <option value="">اختر المورد</option>
              {vendors.filter(vendor => vendor.is_active).map(vendor => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
            </select>
            <input className={inputClass} placeholder="رقم الفاتورة" value={invoiceDraft.invoice_number}
              onChange={event => setInvoiceDraft({ ...invoiceDraft, invoice_number: event.target.value })} />
            <input className={inputClass} type="date" value={invoiceDraft.invoice_date}
              onChange={event => setInvoiceDraft({ ...invoiceDraft, invoice_date: event.target.value })} />
            <input className={inputClass} type="date" value={invoiceDraft.due_date}
              onChange={event => setInvoiceDraft({ ...invoiceDraft, due_date: event.target.value })} />
            <input className={inputClass} type="number" min="0" step="0.01" placeholder="قبل الضريبة" value={invoiceDraft.subtotal || ''}
              onChange={event => setInvoiceDraft({ ...invoiceDraft, subtotal: Number(event.target.value) })} />
            <input className={inputClass} type="number" min="0" step="0.01" placeholder="الضريبة" value={invoiceDraft.tax_amount || ''}
              onChange={event => setInvoiceDraft({ ...invoiceDraft, tax_amount: Number(event.target.value) })} />
            <select className={inputClass} value={invoiceDraft.currency}
              onChange={event => setInvoiceDraft({ ...invoiceDraft, currency: event.target.value as Currency })}>
              <option>EGP</option><option>SAR</option><option>USD</option>
            </select>
            <button onClick={createPayable} disabled={!!busy} className="flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2 font-bold text-white disabled:opacity-50">
              <Plus size={15} /> تسجيل الفاتورة
            </button>
          </div>
          <div className="overflow-x-auto rounded-2xl border bg-white">
            <table className="w-full min-w-[850px] text-sm">
              <thead className="bg-gray-50 text-gray-500"><tr>
                <th className="p-3 text-right">المورد/الفاتورة</th><th className="p-3">الاستحقاق</th>
                <th className="p-3">الإجمالي</th><th className="p-3">المتبقي</th><th className="p-3">الحالة</th><th className="p-3">الإجراء</th>
              </tr></thead>
              <tbody className="divide-y">
                {payables.map(row => (
                  <tr key={row.id}>
                    <td className="p-3"><p className="font-bold">{row.vendor_name}</p><p className="text-xs text-gray-500">{row.invoice_number}</p></td>
                    <td className="p-3 text-center">{String(row.due_date).slice(0, 10)}</td>
                    <td className="p-3 text-center font-bold">{Number(row.total_amount).toLocaleString()} {row.currency}</td>
                    <td className="p-3 text-center font-bold text-amber-700">{Number(row.remaining_amount).toLocaleString()} {row.currency}</td>
                    <td className="p-3 text-center">{row.status}</td>
                    <td className="p-3"><div className="flex justify-center gap-2">
                      {row.status === 'draft' && <>
                        <button onClick={() => payableAction(row, 'approve')} disabled={!!busy} className="rounded-lg bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">اعتماد</button>
                        <button onClick={() => payableAction(row, 'void')} disabled={!!busy} className="rounded-lg bg-red-100 px-2 py-1 text-xs font-bold text-red-700">إلغاء</button>
                      </>}
                      {['approved', 'partially_paid'].includes(row.status) && (
                        <button onClick={() => payableAction(row, 'pay')} disabled={!!busy} className="rounded-lg bg-primary-100 px-2 py-1 text-xs font-bold text-primary-700">سداد</button>
                      )}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mode === 'bank' && (
        <div className="space-y-5">
          <div className="grid gap-2 rounded-2xl border bg-white p-4 md:grid-cols-3">
            <input className={inputClass} placeholder="حساب البنك" value={bankDraft.account_code}
              onChange={event => setBankDraft({ ...bankDraft, account_code: event.target.value })} />
            <input className={inputClass} type="date" value={bankDraft.period_start}
              onChange={event => setBankDraft({ ...bankDraft, period_start: event.target.value })} />
            <input className={inputClass} type="date" value={bankDraft.period_end}
              onChange={event => setBankDraft({ ...bankDraft, period_end: event.target.value })} />
            <input className={inputClass} type="number" step="0.01" placeholder="الرصيد الافتتاحي" value={bankDraft.opening_balance}
              onChange={event => setBankDraft({ ...bankDraft, opening_balance: Number(event.target.value) })} />
            <input className={inputClass} type="number" step="0.01" placeholder="رصيد كشف البنك" value={bankDraft.statement_closing_balance}
              onChange={event => setBankDraft({ ...bankDraft, statement_closing_balance: Number(event.target.value) })} />
            <button onClick={createReconciliation} disabled={!!busy} className="rounded-xl bg-primary-600 px-4 py-2 font-bold text-white disabled:opacity-50">إنشاء التسوية</button>
          </div>
          <div className="space-y-3">
            {reconciliations.map(row => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-4">
                <div><p className="font-bold">حساب {row.account_code} · {row.period_start} → {row.period_end}</p><p className="text-xs text-gray-500">دفتر: {Number(row.ledger_closing_balance).toLocaleString()} · بنك: {Number(row.statement_closing_balance).toLocaleString()}</p></div>
                <div className="text-center"><p className={`font-extrabold ${Math.abs(Number(row.difference_amount)) < 0.01 ? 'text-emerald-700' : 'text-red-700'}`}>{Number(row.difference_amount).toLocaleString()}</p><p className="text-xs text-gray-500">{row.status}</p></div>
                <div className="flex gap-2">
                  {row.status === 'draft' && <button onClick={() => addAdjustment(row)} className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-700"><Plus size={13} className="inline" /> بند تسوية</button>}
                  {row.status === 'ready' && <button onClick={() => run(row.id, () => mysqlAdmin.adminPost(`/admin/finance/bank-reconciliations/${row.id}/approve`, {
                    branch: branch ? branchValue(branch) : undefined,
                  }), 'تم اعتماد التسوية البنكية')} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white"><CheckCircle2 size={13} className="inline" /> اعتماد</button>}
                  {row.status === 'approved' && <span className="flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle2 size={14} /> معتمدة</span>}
                  {row.status === 'rejected' && <span className="flex items-center gap-1 text-xs font-bold text-red-700"><XCircle size={14} /> مرفوضة</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {mode === 'forecast' && (
        <div className="space-y-5">
          <div className="grid gap-2 rounded-2xl border bg-white p-4 md:grid-cols-4">
            <select className={inputClass} value={forecastDraft.direction}
              onChange={event => setForecastDraft({ ...forecastDraft, direction: event.target.value as 'inflow' | 'outflow' })}>
              <option value="inflow">تدفق داخل</option><option value="outflow">تدفق خارج</option>
            </select>
            <input className={inputClass} placeholder="اسم الافتراض" value={forecastDraft.label}
              onChange={event => setForecastDraft({ ...forecastDraft, label: event.target.value })} />
            <input className={inputClass} placeholder="التصنيف" value={forecastDraft.category}
              onChange={event => setForecastDraft({ ...forecastDraft, category: event.target.value })} />
            <div className="grid grid-cols-[1fr_90px] gap-2">
              <input className={inputClass} type="number" min="0" step="0.01" placeholder="القيمة" value={forecastDraft.amount || ''}
                onChange={event => setForecastDraft({ ...forecastDraft, amount: Number(event.target.value) })} />
              <select className={inputClass} value={forecastDraft.currency}
                onChange={event => setForecastDraft({ ...forecastDraft, currency: event.target.value as Currency })}>
                <option>EGP</option><option>SAR</option><option>USD</option>
              </select>
            </div>
            <select className={inputClass} value={forecastDraft.cadence}
              onChange={event => setForecastDraft({ ...forecastDraft, cadence: event.target.value as 'one_time' | 'weekly' | 'monthly' })}>
              <option value="one_time">مرة واحدة</option><option value="weekly">أسبوعي</option><option value="monthly">شهري</option>
            </select>
            <input className={inputClass} type="date" value={forecastDraft.start_date}
              onChange={event => setForecastDraft({ ...forecastDraft, start_date: event.target.value })} />
            <input className={inputClass} type="date" value={forecastDraft.end_date}
              onChange={event => setForecastDraft({ ...forecastDraft, end_date: event.target.value })} />
            <div className="flex items-center gap-2">
              <input className={`${inputClass} w-full`} type="number" min="0" max="100" value={forecastDraft.confidence_pct}
                onChange={event => setForecastDraft({ ...forecastDraft, confidence_pct: Number(event.target.value) })} />
              <span className="text-xs text-gray-500">ثقة %</span>
            </div>
            <button onClick={createForecastAssumption} disabled={!!busy}
              className="rounded-xl bg-primary-600 px-4 py-2 font-bold text-white disabled:opacity-50">
              حفظ الافتراض
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border bg-white p-4"><p className="text-xs text-gray-500">الرصيد الافتتاحي</p><p className="text-2xl font-extrabold">{Number(forecast?.openingCash || 0).toLocaleString()} ج.م</p></div>
            <div className={`rounded-2xl border p-4 ${Number(forecast?.closingCash || 0) < 0 ? 'border-red-200 bg-red-50' : 'bg-white'}`}><p className="text-xs text-gray-500">الرصيد المتوقع بعد 13 أسبوعًا</p><p className="text-2xl font-extrabold">{Number(forecast?.closingCash || 0).toLocaleString()} ج.م</p></div>
          </div>
          <div className="overflow-x-auto rounded-2xl border bg-white">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-gray-50 text-gray-500"><tr>
                <th className="p-3">الأسبوع</th><th className="p-3">الفترة</th><th className="p-3">افتتاحي</th>
                <th className="p-3 text-emerald-700">داخل</th><th className="p-3 text-red-700">خارج</th><th className="p-3">ختامي</th>
              </tr></thead>
              <tbody className="divide-y">
                {(forecast?.weeks || []).map(week => (
                  <tr key={week.week}>
                    <td className="p-3 text-center font-bold">{week.week}</td>
                    <td className="p-3 text-center text-xs">{week.from} → {week.to}</td>
                    <td className="p-3 text-center">{Number(week.opening).toLocaleString()}</td>
                    <td className="p-3 text-center font-bold text-emerald-700">{Number(week.inflows).toLocaleString()}</td>
                    <td className="p-3 text-center font-bold text-red-700">{Number(week.outflows).toLocaleString()}</td>
                    <td className={`p-3 text-center font-extrabold ${Number(week.closing) < 0 ? 'text-red-700' : ''}`}>{Number(week.closing).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {mode === 'documents' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-4">
            <div>
              <h4 className="font-bold">الفواتير والإشعارات الدائنة</h4>
              <p className="text-xs text-gray-500">أرقام متسلسلة وغير قابلة للتكرار حسب المؤسسة والفرع والسنة</p>
            </div>
            <button
              onClick={() => run('audit-package', downloadAuditPackage, 'تم تجهيز حزمة المراجعة')}
              disabled={!!busy}
              className="flex items-center gap-2 rounded-xl bg-gray-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              <Download size={15} /> حزمة المراجعة
            </button>
          </div>
          <div className="overflow-x-auto rounded-2xl border bg-white">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-gray-50 text-gray-500"><tr>
                <th className="p-3 text-right">الرقم</th><th className="p-3">النوع</th>
                <th className="p-3">العميل</th><th className="p-3">المبلغ</th><th className="p-3">الإصدار</th>
              </tr></thead>
              <tbody className="divide-y">
                {documents.map(row => (
                  <tr key={row.id}>
                    <td className="p-3 font-mono font-bold">{row.document_number}</td>
                    <td className="p-3 text-center">{row.document_type === 'invoice' ? 'فاتورة' : 'إشعار دائن'}</td>
                    <td className="p-3 text-center">{row.subscriber_name || '—'}</td>
                    <td className="p-3 text-center font-bold">{Number(row.amount).toLocaleString()} {row.currency}</td>
                    <td className="p-3 text-center">{String(row.issued_at).slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
