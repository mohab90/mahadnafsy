import React, { useMemo, useState } from 'react';
import { RefreshCcw, Plus, Trash2, Edit2, Save, X, DollarSign, Calendar, Tag, TrendingUp, AlertTriangle, CheckCircle } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import type { ExpenseCategory } from '../../../types';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }

type Frequency = 'monthly' | 'quarterly' | 'yearly' | 'weekly';

interface RecurringItem {
  id: string;
  name: string;
  category: ExpenseCategory;
  amount: number;
  currency: 'EGP' | 'SAR' | 'USD';
  frequency: Frequency;
  nextDue: string;
  active: boolean;
  notes?: string;
}

const LS_KEY = 'mahad_recurring_expenses_v1';
function load(): RecurringItem[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function save(items: RecurringItem[]) { localStorage.setItem(LS_KEY, JSON.stringify(items)); }

const FREQ_LABELS: Record<Frequency, string> = { weekly: 'أسبوعي', monthly: 'شهري', quarterly: 'ربع سنوي', yearly: 'سنوي' };
const FREQ_MULTIPLIER: Record<Frequency, number> = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1 };
const CATEGORIES: ExpenseCategory[] = ['رواتب', 'تسويق', 'إيجار', 'برمجيات', 'معدات', 'أخرى'];

const CAT_COLORS: Record<string, string> = {
  'رواتب': 'bg-blue-100 text-blue-700', 'تسويق': 'bg-purple-100 text-purple-700',
  'إيجار': 'bg-amber-100 text-amber-700', 'برمجيات': 'bg-teal-100 text-teal-700',
  'معدات': 'bg-gray-100 text-gray-700', 'أخرى': 'bg-pink-100 text-pink-700',
};

const TODAY = new Date().toISOString().slice(0, 10);

// Seed default items if none
function seedDefaults(): RecurringItem[] {
  return [
    { id: '1', name: 'اشتراك Firebase', category: 'برمجيات', amount: 500, currency: 'EGP', frequency: 'monthly', nextDue: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString().slice(0, 10), active: true },
    { id: '2', name: 'إيجار المكتب', category: 'إيجار', amount: 8000, currency: 'EGP', frequency: 'monthly', nextDue: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString().slice(0, 10), active: true },
    { id: '3', name: 'رواتب الفريق', category: 'رواتب', amount: 25000, currency: 'EGP', frequency: 'monthly', nextDue: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 25).toISOString().slice(0, 10), active: true },
    { id: '4', name: 'إعلانات Meta', category: 'تسويق', amount: 3000, currency: 'EGP', frequency: 'monthly', nextDue: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString().slice(0, 10), active: true },
    { id: '5', name: 'تجديد الدومين', category: 'برمجيات', amount: 800, currency: 'EGP', frequency: 'yearly', nextDue: new Date(new Date().getFullYear() + 1, new Date().getMonth(), 1).toISOString().slice(0, 10), active: true },
  ];
}

const RecurringExpensesTab: React.FC<Props> = ({ notify }) => {
  const { expenses } = useSiteData();
  const [items, setItems] = useState<RecurringItem[]>(() => { const d = load(); return d.length > 0 ? d : seedDefaults(); });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<Partial<RecurringItem>>({});
  const [filter, setFilter] = useState<string>('all');

  React.useEffect(() => { save(items); }, [items]);

  const format = (n: number) => n.toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 0 });

  const stats = useMemo(() => {
    const active = items.filter(i => i.active);
    const monthlyTotal = active.reduce((s, i) => s + (i.currency === 'EGP' ? i.amount * (FREQ_MULTIPLIER[i.frequency] / 12) : 0), 0);
    const yearlyTotal = monthlyTotal * 12;
    const overdue = items.filter(i => i.active && i.nextDue < TODAY).length;
    const dueSoon = items.filter(i => i.active && i.nextDue >= TODAY && i.nextDue <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)).length;
    return { monthlyTotal, yearlyTotal, overdue, dueSoon, activeCount: active.length };
  }, [items]);

  const addItem = () => {
    if (!draft.name?.trim() || !draft.amount) { notify('error', 'أدخل الاسم والمبلغ'); return; }
    const item: RecurringItem = {
      id: Date.now().toString(),
      name: draft.name,
      category: draft.category || 'أخرى',
      amount: +draft.amount,
      currency: draft.currency || 'EGP',
      frequency: draft.frequency || 'monthly',
      nextDue: draft.nextDue || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString().slice(0, 10),
      active: true,
      notes: draft.notes,
    };
    setItems(prev => [...prev, item]);
    setDraft({});
    setShowAdd(false);
    notify('success', 'تم إضافة المصروف المتكرر');
  };

  const saveEdit = (id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...draft } : i));
    setEditingId(null);
    setDraft({});
    notify('success', 'تم الحفظ');
  };

  const deleteItem = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    notify('success', 'تم الحذف');
  };

  const toggleActive = (id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, active: !i.active } : i));
  };

  const filtered = items.filter(i => filter === 'all' ? true : filter === 'active' ? i.active : filter === 'inactive' ? !i.active : i.category === filter);

  // Monthly cost by category
  const byCat = useMemo(() => {
    const cats: Record<string, number> = {};
    items.filter(i => i.active && i.currency === 'EGP').forEach(i => {
      cats[i.category] = (cats[i.category] || 0) + i.amount * FREQ_MULTIPLIER[i.frequency] / 12;
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
            <p className="text-orange-200 text-sm mt-0.5">إدارة الالتزامات المالية الدورية</p>
          </div>
          <button onClick={() => { setShowAdd(true); setDraft({ frequency: 'monthly', currency: 'EGP', category: 'أخرى' }); }}
            className="flex items-center gap-2 bg-white text-orange-700 font-bold px-4 py-2 rounded-xl hover:bg-orange-50 text-sm">
            <Plus size={16} /> إضافة مصروف
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {[
            { label: 'تكلفة شهرية', value: `${format(stats.monthlyTotal)} ج.م`, bg: 'bg-white/15' },
            { label: 'تكلفة سنوية', value: `${format(stats.yearlyTotal)} ج.م`, bg: 'bg-white/15' },
            { label: 'مستحقة (متأخرة)', value: stats.overdue, bg: stats.overdue > 0 ? 'bg-red-500/30' : 'bg-white/10' },
            { label: 'تستحق قريباً', value: stats.dueSoon, bg: stats.dueSoon > 0 ? 'bg-yellow-400/30' : 'bg-white/10' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
              <div className="text-xl font-black">{s.value}</div>
              <div className="text-xs text-orange-200 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-white border border-orange-200 rounded-2xl p-4 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-3">إضافة مصروف متكرر</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <input value={draft.name || ''} onChange={e => setDraft(p => ({ ...p, name: e.target.value }))}
              placeholder="اسم المصروف *" className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            <input type="number" value={draft.amount || ''} onChange={e => setDraft(p => ({ ...p, amount: +e.target.value }))}
              placeholder="المبلغ *" className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            <select value={draft.category || 'أخرى'} onChange={e => setDraft(p => ({ ...p, category: e.target.value as ExpenseCategory }))}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={draft.frequency || 'monthly'} onChange={e => setDraft(p => ({ ...p, frequency: e.target.value as Frequency }))}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
              {Object.entries(FREQ_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={draft.currency || 'EGP'} onChange={e => setDraft(p => ({ ...p, currency: e.target.value as any }))}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
              <option value="EGP">EGP</option><option value="SAR">SAR</option><option value="USD">USD</option>
            </select>
            <input type="date" value={draft.nextDue || ''} onChange={e => setDraft(p => ({ ...p, nextDue: e.target.value }))}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none" />
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
              <span className="text-xs w-16 shrink-0 text-gray-600">{cat}</span>
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
              ...CATEGORIES.map(c => ({ key: c, label: c })),
            ].map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${filter === f.key ? 'bg-orange-600 text-white border-orange-600' : 'bg-white text-gray-600 border-gray-200 hover:border-orange-300'}`}>
                {f.label}
              </button>
            ))}
          </div>

          {filtered.map(item => {
            const isEditing = editingId === item.id;
            const isOverdue = item.active && item.nextDue < TODAY;
            const isDueSoon = item.active && item.nextDue >= TODAY && item.nextDue <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
            const monthlyEq = item.currency === 'EGP' ? item.amount * FREQ_MULTIPLIER[item.frequency] / 12 : null;

            return (
              <div key={item.id} className={`bg-white border rounded-xl p-3 shadow-sm ${!item.active ? 'opacity-60' : isOverdue ? 'border-red-200' : isDueSoon ? 'border-amber-200' : 'border-gray-200'}`}>
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input value={draft.name || item.name} onChange={e => setDraft(p => ({ ...p, name: e.target.value }))}
                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
                      <input type="number" value={draft.amount ?? item.amount} onChange={e => setDraft(p => ({ ...p, amount: +e.target.value }))}
                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
                      <select value={draft.category || item.category} onChange={e => setDraft(p => ({ ...p, category: e.target.value as ExpenseCategory }))}
                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none">
                        {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                      </select>
                      <select value={draft.frequency || item.frequency} onChange={e => setDraft(p => ({ ...p, frequency: e.target.value as Frequency }))}
                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none">
                        {Object.entries(FREQ_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <input type="date" value={draft.nextDue || item.nextDue} onChange={e => setDraft(p => ({ ...p, nextDue: e.target.value }))}
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
                        <span className="font-bold text-gray-800 text-sm">{item.name}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${CAT_COLORS[item.category] || 'bg-gray-100 text-gray-600'}`}>{item.category}</span>
                        <span className="text-xs text-gray-400">{FREQ_LABELS[item.frequency]}</span>
                        {isOverdue && <span className="text-xs text-red-600 font-bold">⚠️ متأخر!</span>}
                        {isDueSoon && !isOverdue && <span className="text-xs text-amber-600">⏰ يستحق قريباً</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                        <span className="font-bold text-gray-700">{item.amount.toLocaleString()} {item.currency}</span>
                        {monthlyEq && <span className="text-gray-400">≈ {format(monthlyEq)} ج.م/شهر</span>}
                        <span><Calendar size={10} className="inline ml-0.5" />{item.nextDue}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => toggleActive(item.id)}
                        className={`text-xs px-2 py-0.5 rounded-lg border transition-colors ${item.active ? 'border-green-200 text-green-600 hover:bg-red-50' : 'border-gray-200 text-gray-400 hover:bg-green-50'}`}>
                        {item.active ? '✅' : '⏸️'}
                      </button>
                      <button onClick={() => { setEditingId(item.id); setDraft({}); }} className="text-gray-400 hover:text-orange-500"><Edit2 size={13} /></button>
                      <button onClick={() => deleteItem(item.id)} className="text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && <div className="text-center py-10 text-gray-400 text-sm">لا مصروفات</div>}
        </div>
      </div>
    </div>
  );
};

export default RecurringExpensesTab;
