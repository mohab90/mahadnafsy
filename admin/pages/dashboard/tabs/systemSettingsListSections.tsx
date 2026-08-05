import React, { useState } from 'react';
import { Briefcase, CheckCircle, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { COLOR, type ListItem } from './systemSettingsSchema';

type ColorStyle = typeof COLOR[string];

export const CurrenciesSection: React.FC<{ data: ListItem[]; mutate: (v: ListItem[]) => void; c: ColorStyle }> = ({ data, mutate, c }) => {
  const items = data || [];
  const toggleActive = (idx: number) => mutate(items.map((it, i) => i === idx ? { ...it, is_active: !it.is_active } : it));
  const setDefault = (idx: number) => mutate(items.map((it, i) => ({ ...it, is_default: i === idx })));
  const updateF = (idx: number, field: string, value: string) => mutate(items.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  const add = () => mutate([...items, { key: '', label: '', symbol: '', is_active: true, is_default: false }]);
  const remove = (idx: number) => mutate(items.filter((_, i) => i !== idx));

  return (
    <div className="space-y-2">
      <div className="bg-gray-50 rounded-xl px-4 py-2 grid grid-cols-4 text-xs font-bold text-gray-400 gap-2">
        <span>الكود</span><span>الرمز</span><span>الاسم</span><span className="text-center">الإجراءات</span>
      </div>
      {items.map((item, idx) => (
        <div key={idx} className={`bg-white border rounded-xl flex items-center gap-2 px-4 py-3 transition ${item.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
          <input value={item.key || ''} onChange={e => updateF(idx, 'key', e.target.value.toUpperCase())}
            className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-mono uppercase focus:outline-none focus:ring-1 focus:ring-indigo-400" placeholder="EGP" />
          <input value={item.symbol || ''} onChange={e => updateF(idx, 'symbol', e.target.value)}
            className="w-14 text-center border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400" placeholder="ج.م" />
          <input value={item.label || ''} onChange={e => updateF(idx, 'label', e.target.value)}
            className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400" placeholder="جنيه مصري" />
          <button onClick={() => setDefault(idx)} title="اختر كافتراضي"
            className={`px-2 py-1 rounded-lg text-xs font-bold border transition ${item.is_default ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-gray-50 text-gray-400 border-gray-200 hover:border-amber-300'}`}>
            افتراضي
          </button>
          <button onClick={() => toggleActive(idx)} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
            {item.is_active ? <Eye size={14} className="text-green-500" /> : <EyeOff size={14} className="text-gray-400" />}
          </button>
          <button onClick={() => remove(idx)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600 transition">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button onClick={add} className={`flex items-center gap-1.5 px-3 py-2 ${c.bg} ${c.text} border ${c.border} rounded-xl text-xs font-bold hover:opacity-80 transition w-full justify-center`}>
        <Plus size={13} /> إضافة عملة
      </button>
    </div>
  );
};

export const CountriesSection: React.FC<{ data: ListItem[]; mutate: (v: ListItem[]) => void; c: ColorStyle }> = ({ data, mutate, c }) => {
  const items = data || [];
  const toggle = (idx: number) => mutate(items.map((it, i) => i === idx ? { ...it, is_active: !it.is_active } : it));
  const updateF = (idx: number, field: string, value: string) => mutate(items.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  const add = () => mutate([...items, { key: '', code: '', label: '', flag: '🌍', is_active: true }]);
  const remove = (idx: number) => mutate(items.filter((_, i) => i !== idx));

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {items.map((item, idx) => (
          <div key={idx} className={`bg-white border rounded-xl flex items-center gap-2 px-3 py-2.5 transition ${item.is_active ? 'border-gray-200' : 'border-gray-100 opacity-55'}`}>
            <input value={item.flag || '🌍'} onChange={e => updateF(idx, 'flag', e.target.value)}
              className="w-9 text-center border border-gray-200 rounded-lg px-1 py-1 text-sm focus:outline-none bg-gray-50" placeholder="🌍" />
            <input value={item.code || item.key || ''} onChange={e => updateF(idx, 'code', e.target.value.toUpperCase())}
              className="w-12 border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-mono uppercase focus:outline-none" placeholder="EG" />
            <input value={item.label || ''} onChange={e => updateF(idx, 'label', e.target.value)}
              className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none" placeholder="مصر" />
            <button onClick={() => toggle(idx)} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
              {item.is_active ? <Eye size={14} className="text-green-500" /> : <EyeOff size={14} className="text-gray-400" />}
            </button>
            <button onClick={() => remove(idx)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <button onClick={add} className={`flex items-center gap-1.5 px-3 py-2 ${c.bg} ${c.text} border ${c.border} rounded-xl text-xs font-bold hover:opacity-80 transition w-full justify-center`}>
        <Plus size={13} /> إضافة دولة
      </button>
    </div>
  );
};

const SHOW_ICON_FOR = ['payment_methods', 'lead_sources', 'branches'];

export const ListSection: React.FC<{ data: ListItem[]; mutate: (v: ListItem[]) => void; c: ColorStyle; sectionKey: string }> = ({ data, mutate, c, sectionKey }) => {
  const items = data || [];
  const [newLabel, setNewLabel] = useState('');
  const [newIcon, setNewIcon] = useState('');
  const showIcon = SHOW_ICON_FOR.includes(sectionKey);

  const isBranches = sectionKey === 'branches';
  const toggle = (idx: number) => mutate(items.map((it, i) => i === idx ? { ...it, is_active: !it.is_active } : it));
  const toggleInternal = (idx: number) => mutate(items.map((it, i) => i === idx ? { ...it, internal_only: !it.internal_only } : it));
  const updateLabel = (idx: number, label: string) => mutate(items.map((it, i) => i === idx ? { ...it, label } : it));
  const updateIcon = (idx: number, icon: string) => mutate(items.map((it, i) => i === idx ? { ...it, icon } : it));
  const remove = (idx: number) => mutate(items.filter((_, i) => i !== idx));
  const add = () => {
    if (!newLabel.trim()) return;
    const key = `${Date.now()}`;
    mutate([...items, { key, label: newLabel.trim(), icon: newIcon.trim() || '', is_active: true }]);
    setNewLabel('');
    setNewIcon('');
  };

  return (
    <div className="space-y-1.5">
      {isBranches && (
        <p className="text-xs text-gray-400 px-1 flex items-center gap-1">
          <Briefcase size={12} /> فرع "داخلي" يظهر للموظفين عند اختيار فرع لوظيفة أو موظف، ولا يظهر أبدًا لعملاء الموقع.
        </p>
      )}
      {items.map((item, idx) => (
        <div key={idx} className={`bg-white border rounded-xl flex items-center gap-3 px-4 py-3 transition ${item.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
          {showIcon && (
            <input value={item.icon || ''} onChange={e => updateIcon(idx, e.target.value)}
              className="w-10 text-center border border-gray-200 rounded-lg px-1 py-1.5 text-sm focus:outline-none bg-gray-50" placeholder="🏢" />
          )}
          <input value={item.label} onChange={e => updateLabel(idx, e.target.value)}
            className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400" />
          {isBranches && (
            <button onClick={() => toggleInternal(idx)}
              className={`px-2 py-1.5 rounded-lg text-[11px] font-bold border transition flex items-center gap-1 whitespace-nowrap ${item.internal_only ? 'bg-amber-50 text-amber-700 border-amber-300' : 'bg-gray-50 text-gray-400 border-gray-200 hover:border-amber-300'}`}
              title="داخلي فقط — لا يظهر لعملاء الموقع">
              <Briefcase size={12} /> {item.internal_only ? 'داخلي' : 'عام'}
            </button>
          )}
          <button onClick={() => toggle(idx)} className="p-1.5 rounded-lg hover:bg-gray-100 transition" title={item.is_active ? 'إيقاف' : 'تفعيل'}>
            {item.is_active ? <CheckCircle size={15} className="text-green-500" /> : <EyeOff size={15} className="text-gray-300" />}
          </button>
          <button onClick={() => remove(idx)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600 transition">
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      <div className={`${c.bg} border ${c.border} rounded-xl flex items-center gap-2 px-4 py-3`}>
        {showIcon && (
          <input value={newIcon} onChange={e => setNewIcon(e.target.value)}
            className="w-10 text-center border border-gray-200 rounded-lg px-1 py-1.5 text-sm focus:outline-none bg-white" placeholder="🆕" />
        )}
        <input value={newLabel} onChange={e => setNewLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="أضف عنصر جديد..." className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white" />
        <button onClick={add} disabled={!newLabel.trim()}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg transition border ${newLabel.trim() ? `${c.text} bg-white ${c.border} hover:opacity-80` : 'text-gray-300 bg-white border-gray-100 cursor-not-allowed'}`}>
          <Plus size={13} /> إضافة
        </button>
      </div>
      <p className="text-xs text-gray-400 px-1">{items.filter(i => i.is_active).length} نشط / {items.length} إجمالي</p>
    </div>
  );
};
