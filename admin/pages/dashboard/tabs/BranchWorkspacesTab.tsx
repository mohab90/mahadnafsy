import { useEffect, useMemo, useState } from 'react';
import { Building2, Plus, Trash2 } from 'lucide-react';
import { adminAuthHeaders } from '../../../lib/adminAuthHeaders';
import type { TabKey } from '../navigation';
import { Card, Field, Input, NotifyFn, SaveBar, SectionHeader, Toggle } from './saasConnectorUi';

type BranchWorkspace = {
  key: string;
  slug: string;
  label: string;
  type: 'physical' | 'online' | 'hybrid';
  is_active: boolean;
  timezone: string;
  currency: string;
  modules: string[];
  tabs: TabKey[];
};

const MODULES = ['clients', 'leads', 'schedule', 'payments', 'installments', 'reports', 'staff'];
const TAB_OPTIONS: TabKey[] = ['online_clients', 'leads', 'daqqi_schedule', 'orders', 'financial', 'installment_plans', 'staff_management'];

export default function BranchWorkspacesTab({ notify }: { notify: NotifyFn }) {
  const [items, setItems] = useState<BranchWorkspace[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/admin/sys-config?section=branch_workspaces', { credentials: 'include', headers: adminAuthHeaders() })
      .then(res => res.ok ? res.json() : [])
      .then(data => setItems(Array.isArray(data) ? data : []))
      .catch(() => notify('error', 'فشل تحميل مساحات الفروع'));
  }, [notify]);

  const activeItems = useMemo(() => items.filter(item => item.is_active), [items]);

  const update = (index: number, patch: Partial<BranchWorkspace>) => {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, ...patch } : item));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/sys-config/branch_workspaces', {
        method: 'PUT',
        credentials: 'include',
        headers: adminAuthHeaders(true),
        body: JSON.stringify(items),
      });
      if (!res.ok) throw new Error(await res.text());
      setDirty(false);
      notify('success', 'تم حفظ مساحات الفروع');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'فشل حفظ الفروع');
    } finally {
      setSaving(false);
    }
  };

  const add = () => {
    const key = `BRANCH_${Date.now()}`;
    setItems(prev => [...prev, {
      key,
      slug: key.toLowerCase().replace(/_/g, '-'),
      label: 'فرع جديد',
      type: 'physical',
      is_active: true,
      timezone: 'Africa/Cairo',
      currency: 'EGP',
      modules: ['clients', 'leads', 'payments'],
      tabs: ['online_clients', 'leads', 'orders'],
    }]);
    setDirty(true);
  };

  return (
    <div className="space-y-5" dir="rtl">
      <SectionHeader
        title="مساحات الفروع"
        subtitle="إدارة الفروع النشطة وربط كل فرع بالصفحات والوظائف المناسبة له."
        icon={<Building2 size={22} />}
        tone="amber"
      />
      <Card title="الفروع النشطة">
        <div className="flex flex-wrap gap-2">
          {activeItems.map(branch => (
            <div key={branch.key} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">
              {branch.label} <span className="text-xs font-normal text-amber-600">/{branch.slug}</span>
            </div>
          ))}
          {activeItems.length === 0 && <p className="text-sm text-gray-400">لا توجد فروع نشطة حاليًا.</p>}
        </div>
      </Card>
      <div className="space-y-3">
        {items.map((item, index) => (
          <Card key={item.key || index} title={item.label || 'فرع'}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <Field label="المعرّف (Key)"><Input value={item.key} onChange={value => update(index, { key: value.toUpperCase().replace(/\s+/g, '_') })} /></Field>
              <Field label="الرابط المختصر (Slug)"><Input value={item.slug} onChange={value => update(index, { slug: value.toLowerCase().replace(/\s+/g, '-') })} /></Field>
              <Field label="الاسم"><Input value={item.label} onChange={value => update(index, { label: value })} /></Field>
              <Field label="النوع">
                <select value={item.type} onChange={event => update(index, { type: event.target.value as BranchWorkspace['type'] })} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm">
                  <option value="physical">حضوري</option>
                  <option value="online">أونلاين</option>
                  <option value="hybrid">هجين</option>
                </select>
              </Field>
              <Field label="المنطقة الزمنية"><Input value={item.timezone} onChange={value => update(index, { timezone: value })} /></Field>
              <Field label="العملة"><Input value={item.currency} onChange={value => update(index, { currency: value.toUpperCase() })} /></Field>
              <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3">
                <span className="text-sm font-semibold text-gray-600">نشط</span>
                <Toggle checked={!!item.is_active} onChange={value => update(index, { is_active: value })} />
              </div>
              <button className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 text-sm font-bold text-red-600" onClick={() => { setItems(prev => prev.filter((_, i) => i !== index)); setDirty(true); }}>
                <Trash2 size={15} /> حذف
              </button>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-bold text-gray-500">الوظائف</p>
                <div className="flex flex-wrap gap-2">
                  {MODULES.map(module => (
                    <label key={module} className="rounded-xl border border-gray-200 px-3 py-2 text-xs">
                      <input className="ml-2" type="checkbox" checked={item.modules.includes(module)} onChange={event => update(index, { modules: event.target.checked ? [...item.modules, module] : item.modules.filter(m => m !== module) })} />
                      {module}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-bold text-gray-500">الصفحات المرتبطة</p>
                <div className="flex flex-wrap gap-2">
                  {TAB_OPTIONS.map(tab => (
                    <label key={tab} className="rounded-xl border border-gray-200 px-3 py-2 text-xs">
                      <input className="ml-2" type="checkbox" checked={item.tabs.includes(tab)} onChange={event => update(index, { tabs: event.target.checked ? [...item.tabs, tab] : item.tabs.filter(t => t !== tab) })} />
                      {tab}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <button className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-700" onClick={add}>
        <Plus size={15} /> إضافة مساحة فرع
      </button>
      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
