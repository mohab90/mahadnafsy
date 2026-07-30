import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCcw, Plus, Trash2, Edit2, Save, Calendar } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }

type Frequency = 'monthly' | 'quarterly' | 'yearly' | 'weekly';

interface RecurringItem {
  id: string;
  title: string;
  amount_egp: number;
  category: string;
  notes: string | null;
  frequency: Frequency;
  day_of_month: number;
  is_active: boolean | number;
  last_run: string | null;
  created_at: string;
}

const FREQ_LABELS: Record<Frequency, string> = { weekly: 'أسبوعي', monthly: 'شهري', quarterly: 'ربع سنوي', yearly: 'سنوي' };
const FREQ_MULTIPLIER: Record<Frequency, number> = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1 };
const CATEGORY_LABELS: Record<string, string> = {
  SALARIES: 'رواتب',
  MARKETING: 'تسويق',
  RENT: 'إيجار',
  SOFTWARE: 'برمجيات',
  EQUIPMENT: 'معدات',
  UTILITIES: 'مرافق',
  MAINTENANCE: 'صيانة',
  TRAVEL: 'سفر',
  OTHER: 'أخرى',
};
const CATEGORIES = Object.keys(CATEGORY_LABELS);

const CAT_COLORS: Record<string, string> = {
  SALARIES: 'bg-blue-100 text-blue-700', MARKETING: 'bg-purple-100 text-purple-700',
  RENT: 'bg-amber-100 text-amber-700', SOFTWARE: 'bg-teal-100 text-teal-700',
  EQUIPMENT: 'bg-gray-100 text-gray-700', OTHER: 'bg-pink-100 text-pink-700',
};

type Draft = { title?: string; amount_egp?: number; category?: string; frequency?: Frequency; day_of_month?: number; notes?: string };

const RecurringExpensesTab: React.FC<Props> = ({ notify }) => {
  const [items, setItems] = useState<RecurringItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [filter, setFilter] = useState<string>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await mysqlAdmin.adminGet<RecurringItem[]>('/admin/recurring-expenses');
      setItems(Array.isArray(rows) ? rows : []);
    } catch { notify('error', 'تعذّر تحميل المصروفات المتكررة'); }
    finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const format = (n: number) => n.toLocaleString('ar-EG', { maximumFractionDigits: 0 });

  const stats = useMemo(() => {
    const active = items.filter(i => i.is_active);
    const monthlyTotal = active.reduce((s, i) => s + i.amount_egp * (FREQ_MULTIPLIER[i.frequency] / 12), 0);
    const yearlyTotal = monthlyTotal * 12;
    const today = new Date().getDate();
    const dueSoon = active.filter(i => i.frequency === 'monthly' && i.day_of_month >= today && i.day_of_month <= today + 7).length;
    return { monthlyTotal, yearlyTotal, dueSoon, activeCount: active.length };
  }, [items]);

  const addItem = async () => {
    if (!draft.title?.trim() || !draft.amount_egp) { notify('error', 'أدخل الاسم والمبلغ'); return; }
    try {
      await mysqlAdmin.adminPost('/admin/recurring-expenses', {
        title: draft.title.trim(),
        amount_egp: draft.amount_egp,
        category: draft.category || 'OTHER',
        frequency: draft.frequency || 'monthly',
        day_of_month: draft.day_of_month || 1,
        notes: draft.notes || null,
      });
      setDraft({});
      setShowAdd(false);
      notify('success', 'تم إضافة المصروف المتكرر');
      load();
    } catch { notify('error', 'فشل إضافة المصروف'); }
  };

  const saveEdit = async (id: string) => {
    try {
      await mysqlAdmin.adminPut(`/admin/recurring-expenses/${id}`, draft);
      setEditingId(null);
      setDraft({});
      notify('success', 'تم الحفظ');
      load();
    } catch { notify('error', 'فشل الحفظ'); }
  };

  const deleteItem = async (id: string) => {
    if (!window.confirm('حذف هذا المصروف المتكرر؟')) return;
    try {
      await mysqlAdmin.adminDelete(`/admin/recurring-expenses/${id}`);
      notify('success', 'تم الحذف');
      load();
    } catch { notify('error', 'فشل الحذف'); }
  };

  const toggleActive = async (item: RecurringItem) => {
    try {
      await mysqlAdmin.adminPut(`/admin/recurring-expenses/${item.id}`, { is_active: item.is_active ? 0 : 1 });
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_active: item.is_active ? 0 : 1 } : i));
    } catch { notify('error', 'فشل التحديث'); }
  };

  const filtered = items.filter(i => filter === 'all' ? true : filter === 'active' ? !!i.is_active : filter === 'inactive' ? !i.is_active : i.category === filter);

  const byCat = useMemo(() => {
    const cats: Record<string, number> = {};
    items.filter(i => i.is_active).forEach(i => {
      cats[i.category] = (cats[i.category] || 0) + i.amount_egp * FREQ_MULTIPLIER[i.frequency] / 12;
    });
    return Object.entries(cats).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const maxCat = byCat[0]?.[1] || 1;

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-orange-700 to-amber-600 rounded-2xl p-5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><RefreshCcw size={22} /> المصروفات المتكررة</h2>
            <p className="text-orange-200 text-sm mt-0.5">إدارة الالتزامات المالية الدورية (مشتركة بين كل الموظفين)</p>
          </div>
          <button onClick={() => { setShowAdd(true); setDraft({ frequency: 'monthly', category: 'OTHER', day_of_month: 1 }); }}
            className="flex items-center gap-2 bg-white text-orange-700 font-bold px-4 py-2 rounded-xl hover:bg-orange-50 text-sm">
            <Plus size={16} /> إضافة مصروف
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
          {[
            { label: 'تكلفة شهرية', value: `${format(stats.monthlyTotal)} ج.م`, bg: 'bg-white/15' },
            { label: 'تكلفة سنوية', value: `${format(stats.yearlyTotal)} ج.م`, bg: 'bg-white/15' },
            { label: 'تستحق قريباً (شهرية)', value: stats.dueSoon, bg: stats.dueSoon > 0 ? 'bg-yellow-400/30' : 'bg-white/10' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
              <div className="text-xl font-black">{s.value}</div>
              <div className="text-xs text-orange-200 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-blue-700 text-xs">
        <strong>ملاحظة:</strong> البنود ذات التكرار "شهري" فقط تُنشئ مصروفًا حقيقيًا تلقائيًا كل شهر (في اليوم المحدد). البنود الأسبوعية/ربع السنوية/السنوية للمتابعة والتخطيط فقط حاليًا ولا تُسجَّل تلقائيًا بعد.
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-white border border-orange-200 rounded-2xl p-4 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-3">إضافة مصروف متكرر</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <input value={draft.title || ''} onChange={e => setDraft(p => ({ ...p, title: e.target.value }))}
              placeholder="اسم المصروف *" className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            <input type="number" value={draft.amount_egp || ''} onChange={e => setDraft(p => ({ ...p, amount_egp: +e.target.value }))}
              placeholder="المبلغ (ج.م) *" className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            <select value={draft.category || 'OTHER'} onChange={e => setDraft(p => ({ ...p, category: e.target.value }))}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
              {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
            <select value={draft.frequency || 'monthly'} onChange={e => setDraft(p => ({ ...p, frequency: e.target.value as Frequency }))}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
              {Object.entries(FREQ_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input type="number" min={1} max={28} value={draft.day_of_month ?? 1} onChange={e => setDraft(p => ({ ...p, day_of_month: Math.min(28, Math.max(1, +e.target.value || 1)) }))}
              placeholder="يوم الاستحقاق (1-28)" title="يوم الاستحقاق من الشهر"
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            <input value={draft.notes || ''} onChange={e => setDraft(p => ({ ...p, notes: e.target.value }))}
              placeholder="ملاحظات (اختياري)" className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none" />
          </div>
          <div className="flex gap-3 mt-3">
            <button onClick={addItem} className="bg-orange-600 text-white px-6 py-2 rounded-xl font-bold text-sm hover:bg-orange-700">إضافة</button>
            <button onClick={() => setShowAdd(false)} className="bg-gray-100 text-gray-600 px-6 py-2 rounded-xl font-bold text-sm hover:bg-gray-200">إلغاء</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Category chart */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-4">التكلفة الشهرية حسب الفئة</h3>
          {byCat.map(([cat, amt]) => (
            <div key={cat} className="flex items-center gap-3 mb-3">
              <span className="text-xs w-16 shrink-0 text-gray-600">{CATEGORY_LABELS[cat] || cat}</span>
              <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-orange-400 rounded-full" style={{ width: `${Math.round(amt / maxCat * 100)}%` }} />
              </div>
              <span className="text-xs font-bold text-gray-700 w-20 text-right">{format(amt)}</span>
            </div>
          ))}
          {byCat.length === 0 && <p className="text-center text-gray-400 text-sm py-8">لا بيانات</p>}
        </div>

        {/* Items list */}
        <div className="lg:col-span-2 space-y-3">
          {/* Filter */}
          <div className="flex flex-wrap gap-2">
            {[
              { key: 'all', label: 'الكل' },
              { key: 'active', label: '✅ نشطة' },
              { key: 'inactive', label: '⏸️ متوقفة' },
              ...CATEGORIES.map(c => ({ key: c, label: CATEGORY_LABELS[c] })),
            ].map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${filter === f.key ? 'bg-orange-600 text-white border-orange-600' : 'bg-white text-gray-600 border-gray-200 hover:border-orange-300'}`}>
                {f.label}
              </button>
            ))}
          </div>

          {loading && <div className="text-center py-10 text-gray-400 text-sm">جاري التحميل...</div>}

          {!loading && filtered.map(item => {
            const isEditing = editingId === item.id;
            const monthlyEq = item.amount_egp * FREQ_MULTIPLIER[item.frequency] / 12;

            return (
              <div key={item.id} className={`bg-white border rounded-xl p-3 shadow-sm ${!item.is_active ? 'opacity-60' : 'border-gray-200'}`}>
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input value={draft.title ?? item.title} onChange={e => setDraft(p => ({ ...p, title: e.target.value }))}
                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
                      <input type="number" value={draft.amount_egp ?? item.amount_egp} onChange={e => setDraft(p => ({ ...p, amount_egp: +e.target.value }))}
                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
                      <select value={draft.category ?? item.category} onChange={e => setDraft(p => ({ ...p, category: e.target.value }))}
                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none">
                        {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                      </select>
                      <select value={draft.frequency ?? item.frequency} onChange={e => setDraft(p => ({ ...p, frequency: e.target.value as Frequency }))}
                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none">
                        {Object.entries(FREQ_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <input type="number" min={1} max={28} value={draft.day_of_month ?? item.day_of_month} onChange={e => setDraft(p => ({ ...p, day_of_month: Math.min(28, Math.max(1, +e.target.value || 1)) }))}
                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => saveEdit(item.id)} className="flex items-center gap-1 text-xs bg-orange-600 text-white px-3 py-1.5 rounded-lg"><Save size={12} /> حفظ</button>
                      <button onClick={() => { setEditingId(null); setDraft({}); }} className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg">إلغاء</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-gray-800 text-sm">{item.title}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${CAT_COLORS[item.category] || 'bg-gray-100 text-gray-600'}`}>{CATEGORY_LABELS[item.category] || item.category}</span>
                        <span className="text-xs text-gray-400">{FREQ_LABELS[item.frequency]}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                        <span className="font-bold text-gray-700">{item.amount_egp.toLocaleString()} ج.م</span>
                        <span className="text-gray-400">≈ {format(monthlyEq)} ج.م/شهر</span>
                        {item.frequency === 'monthly' && <span><Calendar size={10} className="inline ml-0.5" />يوم {item.day_of_month} من كل شهر</span>}
                        {item.last_run && <span>آخر تسجيل: {item.last_run.slice(0, 10)}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => toggleActive(item)}
                        className={`text-xs px-2 py-0.5 rounded-lg border transition-colors ${item.is_active ? 'border-green-200 text-green-600 hover:bg-red-50' : 'border-gray-200 text-gray-400 hover:bg-green-50'}`}>
                        {item.is_active ? '✅' : '⏸️'}
                      </button>
                      <button onClick={() => { setEditingId(item.id); setDraft({}); }} className="text-gray-400 hover:text-orange-500"><Edit2 size={13} /></button>
                      <button onClick={() => deleteItem(item.id)} className="text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {!loading && filtered.length === 0 && <div className="text-center py-10 text-gray-400 text-sm">لا مصروفات</div>}
        </div>
      </div>
    </div>
  );
};

export default RecurringExpensesTab;
