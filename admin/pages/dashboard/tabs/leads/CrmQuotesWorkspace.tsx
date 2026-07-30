import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, FileText, Plus, RefreshCw, Send, ShoppingCart, X } from 'lucide-react';
import type { BundleItem, CourseItem, LeadItem, SubscriberItem } from '../../../../types';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;
type QuoteStatus = 'draft' | 'pending_approval' | 'approved' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'converted' | 'cancelled';
type DraftItem = { item_type: 'course' | 'bundle'; item_id: string; quantity: number };

interface Quote {
  id: string;
  quote_number: string;
  lead_name: string;
  subscriber_id: string | null;
  currency: 'EGP' | 'SAR' | 'USD';
  status: QuoteStatus;
  valid_until: string;
  total: number;
  item_count: number;
}

const labels: Record<QuoteStatus, string> = {
  draft: 'مسودة', pending_approval: 'بانتظار الموافقة', approved: 'معتمد', sent: 'تم الإرسال',
  accepted: 'مقبول', rejected: 'مرفوض', expired: 'منتهي', converted: 'تحول إلى طلب', cancelled: 'ملغي',
};
const statusStyle: Record<QuoteStatus, string> = {
  draft: 'bg-gray-100 text-gray-700', pending_approval: 'bg-amber-100 text-amber-800',
  approved: 'bg-blue-100 text-blue-800', sent: 'bg-violet-100 text-violet-800',
  accepted: 'bg-emerald-100 text-emerald-800', rejected: 'bg-red-100 text-red-800',
  expired: 'bg-gray-100 text-gray-500', converted: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-500',
};
const emptyItem = (): DraftItem => ({ item_type: 'course', item_id: '', quantity: 1 });
const newDraft = () => ({
  lead_id: '', currency: 'EGP' as 'EGP' | 'SAR' | 'USD', discount_percent: 0, tax_percent: 0,
  valid_until: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), notes: '', items: [emptyItem()],
});

export function CrmQuotesWorkspace({
  leads, courses, bundles, subscribers, notify,
}: {
  leads: LeadItem[];
  courses: CourseItem[];
  bundles: BundleItem[];
  subscribers: SubscriberItem[];
  notify: Notify;
}) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState(newDraft);
  const [subscriberByQuote, setSubscriberByQuote] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try { setQuotes(await mysqlAdmin.adminGet<Quote[]>('/admin/crm/quotes')); }
    catch (error) { notify('error', error instanceof Error ? error.message : 'تعذّر تحميل العروض'); }
    finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => ({
    total: quotes.length,
    approval: quotes.filter(row => row.status === 'pending_approval').length,
    sent: quotes.filter(row => row.status === 'sent').length,
    won: quotes.filter(row => ['accepted', 'converted'].includes(row.status)).length,
  }), [quotes]);

  const mutate = async (operation: () => Promise<unknown>, message: string) => {
    setSaving(true);
    try { await operation(); notify('success', message); await load(); return true; }
    catch (error) { notify('error', error instanceof Error ? error.message : 'تعذّر تنفيذ العملية'); return false; }
    finally { setSaving(false); }
  };
  const create = async () => {
    if (!draft.lead_id || draft.items.some(item => !item.item_id)) return notify('error', 'اختر العميل وكل البنود');
    if (await mutate(() => mysqlAdmin.adminPost('/admin/crm/quotes', draft), 'تم إنشاء العرض من أسعار الكتالوج')) {
      setDraft(newDraft());
      setShowCreate(false);
    }
  };
  const action = (quote: Quote, name: 'approve' | 'reject' | 'send' | 'accept') =>
    mutate(() => mysqlAdmin.adminPost(`/admin/crm/quotes/${quote.id}/actions`, { action: name }), 'تم تحديث حالة العرض');
  const convert = (quote: Quote) => {
    const subscriberId = quote.subscriber_id || subscriberByQuote[quote.id];
    if (!subscriberId) return notify('error', 'اختر العميل المشترك قبل التحويل');
    return mutate(
      () => mysqlAdmin.adminPost(`/admin/crm/quotes/${quote.id}/convert`, { subscriber_id: subscriberId }),
      'تم إنشاء Orders معلّقة تدخل مسار التحصيل المعتمد',
    );
  };

  return (
    <div className="space-y-5" dir="rtl">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-l from-indigo-700 to-blue-600 p-5 text-white">
        <div><h3 className="flex items-center gap-2 text-xl font-bold"><FileText size={21} />العروض السعرية</h3>
          <p className="text-sm text-blue-100">Snapshot للأسعار، موافقات خصم، وتحويل آمن إلى Orders</p></div>
        <button type="button" onClick={() => setShowCreate(value => !value)}
          className="flex items-center gap-2 rounded-xl bg-white/20 px-4 py-2 text-sm font-bold">
          {showCreate ? <><X size={15} />إغلاق</> : <><Plus size={15} />عرض جديد</>}
        </button>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Object.entries({ الإجمالي: stats.total, 'بانتظار موافقة': stats.approval, 'تم إرسالها': stats.sent, 'مقبولة/محوّلة': stats.won }).map(([label, value]) => (
          <div key={label} className="rounded-xl border border-gray-200 bg-white p-3 text-center"><strong className="block text-xl">{value}</strong><span className="text-xs text-gray-500">{label}</span></div>
        ))}
      </div>

      {showCreate && (
        <section className="space-y-3 rounded-2xl border border-blue-200 bg-white p-4">
          <div className="grid gap-2 md:grid-cols-4">
            <select aria-label="Lead" value={draft.lead_id} onChange={event => setDraft(value => ({ ...value, lead_id: event.target.value }))}
              className="rounded-xl border px-3 py-2 text-sm md:col-span-2"><option value="">اختر Lead</option>
              {leads.slice(0, 1000).map(lead => <option key={lead.id} value={lead.id}>{lead.name} — {lead.phone}</option>)}</select>
            <select aria-label="العملة" value={draft.currency} onChange={event => setDraft(value => ({ ...value, currency: event.target.value as typeof value.currency }))}
              className="rounded-xl border px-3 py-2 text-sm"><option>EGP</option><option>SAR</option><option>USD</option></select>
            <input aria-label="صالح حتى" type="date" value={draft.valid_until} onChange={event => setDraft(value => ({ ...value, valid_until: event.target.value }))}
              className="rounded-xl border px-3 py-2 text-sm" />
            <input aria-label="نسبة الخصم" type="number" min={0} max={100} value={draft.discount_percent}
              onChange={event => setDraft(value => ({ ...value, discount_percent: Number(event.target.value) }))}
              placeholder="خصم %" className="rounded-xl border px-3 py-2 text-sm" />
            <input aria-label="نسبة الضريبة" type="number" min={0} max={100} value={draft.tax_percent}
              onChange={event => setDraft(value => ({ ...value, tax_percent: Number(event.target.value) }))}
              placeholder="ضريبة %" className="rounded-xl border px-3 py-2 text-sm" />
            <input aria-label="ملاحظات" value={draft.notes} onChange={event => setDraft(value => ({ ...value, notes: event.target.value }))}
              placeholder="ملاحظات" className="rounded-xl border px-3 py-2 text-sm md:col-span-2" />
          </div>
          {draft.items.map((item, index) => {
            const catalog = item.item_type === 'course' ? courses : bundles;
            const updateItem = (patch: Partial<DraftItem>) => setDraft(value => ({
              ...value, items: value.items.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row),
            }));
            return (
              <div key={index} className="flex flex-wrap gap-2 rounded-xl bg-gray-50 p-2">
                <select aria-label="نوع البند" value={item.item_type} onChange={event => updateItem({ item_type: event.target.value as DraftItem['item_type'], item_id: '' })}
                  className="rounded-lg border px-2 py-1.5 text-xs"><option value="course">كورس</option><option value="bundle">باقة</option></select>
                <select aria-label="البند" value={item.item_id} onChange={event => updateItem({ item_id: event.target.value })}
                  className="min-w-60 flex-1 rounded-lg border px-2 py-1.5 text-xs"><option value="">اختر من الكتالوج</option>
                  {catalog.map(product => <option key={product.id} value={product.id}>{product.title}</option>)}</select>
                <input aria-label="الكمية" type="number" min={1} max={100} value={item.quantity} onChange={event => updateItem({ quantity: Number(event.target.value) })}
                  className="w-20 rounded-lg border px-2 py-1.5 text-xs" />
                {draft.items.length > 1 && <button type="button" aria-label="حذف البند" onClick={() => setDraft(value => ({ ...value, items: value.items.filter((_, i) => i !== index) }))}><X size={13} /></button>}
              </div>
            );
          })}
          <div className="flex gap-2">
            <button type="button" onClick={() => setDraft(value => ({ ...value, items: [...value.items, emptyItem()] }))}
              className="rounded-xl border px-3 py-2 text-xs">+ بند</button>
            <button type="button" disabled={saving} onClick={() => { void create(); }}
              className="rounded-xl bg-blue-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">إنشاء وتسعير</button>
          </div>
          <p className="text-[11px] text-gray-500">السعر النهائي من قاعدة البيانات؛ الخصم الأعلى من السياسة يحتاج موافقة موظف آخر.</p>
        </section>
      )}

      <section className="overflow-x-auto rounded-2xl border bg-white">
        <table className="w-full min-w-[900px] text-sm"><thead className="bg-gray-50 text-xs"><tr>
          {['الرقم', 'العميل', 'البنود', 'الإجمالي', 'الصلاحية', 'الحالة', 'الإجراء'].map(label => <th key={label} className="px-3 py-3 text-right">{label}</th>)}
        </tr></thead><tbody>{quotes.map(quote => (
          <tr key={quote.id} className="border-t">
            <td className="px-3 py-3 font-mono text-xs font-bold text-indigo-700">{quote.quote_number}</td>
            <td className="px-3 py-3 font-bold">{quote.lead_name}</td><td className="px-3 py-3">{quote.item_count}</td>
            <td className="px-3 py-3 font-extrabold">{Number(quote.total).toLocaleString()} {quote.currency}</td>
            <td className="px-3 py-3 text-xs">{quote.valid_until?.slice(0, 10)}</td>
            <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[11px] font-bold ${statusStyle[quote.status]}`}>{labels[quote.status]}</span></td>
            <td className="px-3 py-3"><div className="flex items-center gap-1">
              {quote.status === 'pending_approval' && <><button type="button" title="اعتماد" onClick={() => { void action(quote, 'approve'); }} className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><Check size={13} /></button>
                <button type="button" title="رفض" onClick={() => { void action(quote, 'reject'); }} className="rounded-lg bg-red-50 p-2 text-red-700"><X size={13} /></button></>}
              {['draft', 'approved'].includes(quote.status) && <button type="button" title="إرسال" onClick={() => { void action(quote, 'send'); }} className="rounded-lg bg-blue-50 p-2 text-blue-700"><Send size={13} /></button>}
              {['sent', 'approved'].includes(quote.status) && <button type="button" onClick={() => { void action(quote, 'accept'); }} className="rounded-lg bg-emerald-50 px-2 py-1.5 text-[11px] font-bold text-emerald-700">تسجيل قبول</button>}
              {quote.status === 'accepted' && <>{!quote.subscriber_id && <select aria-label="المشترك" value={subscriberByQuote[quote.id] || ''}
                onChange={event => setSubscriberByQuote(value => ({ ...value, [quote.id]: event.target.value }))} className="max-w-40 rounded-lg border px-1 py-1 text-[10px]">
                <option value="">اختر المشترك</option>{subscribers.slice(0, 1000).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>}
                <button type="button" title="تحويل إلى Orders" onClick={() => { void convert(quote); }} className="rounded-lg bg-violet-50 p-2 text-violet-700"><ShoppingCart size={13} /></button></>}
            </div></td>
          </tr>
        ))}</tbody></table>
        {loading && <div className="p-8 text-center text-gray-400"><RefreshCw className="mx-auto animate-spin" />جاري التحميل...</div>}
        {!loading && !quotes.length && <div className="p-8 text-center text-gray-400">لا توجد عروض.</div>}
      </section>
    </div>
  );
}
