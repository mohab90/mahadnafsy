import React, { useState, useEffect, useCallback } from 'react';
import { Building2, Plus, Loader2, RefreshCw, Ban, CheckCircle2 } from 'lucide-react';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;
interface Tenant { id: string; slug: string; name: string; status: string; plan_key: string | null; plan_name: string | null; subscription_status: string | null; created_at: string; }
interface Plan { id: string; plan_key: string; name: string; base_price: number; currency: string; }

const STATUS: Record<string, { label: string; cls: string }> = {
  active: { label: 'نشط', cls: 'bg-emerald-100 text-emerald-700' },
  suspended: { label: 'موقوف', cls: 'bg-amber-100 text-amber-700' },
  archived: { label: 'مؤرشف', cls: 'bg-gray-100 text-gray-500' },
};
const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

export default function TenantsAdminTab({ notify }: { notify: Notify }) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', slug: '', plan_key: '' });
  const [slugEdited, setSlugEdited] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch('/api/admin/saas/tenants', { credentials: 'include' }).then(r => r.json()),
      fetch('/api/admin/saas/plans', { credentials: 'include' }).then(r => r.json()),
    ]).then(([t, p]) => { setTenants(Array.isArray(t) ? t : []); setPlans(Array.isArray(p) ? p : []); })
      .catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!form.name.trim()) { notify('error', 'أدخل اسم المؤسسة'); return; }
    setBusy('create');
    try {
      const r = await fetch('/api/admin/saas/tenants', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '');
      notify('success', `تم إنشاء المستأجر «${d.slug}»`); setForm({ name: '', slug: '', plan_key: '' }); setSlugEdited(false); load();
    } catch (e: any) { notify('error', e.message || 'فشل الإنشاء'); } finally { setBusy(null); }
  };
  const patch = async (id: string, body: object, ok: string) => {
    setBusy(id);
    try {
      const r = await fetch(`/api/admin/saas/tenants/${id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error();
      notify('success', ok); load();
    } catch { notify('error', 'فشل تنفيذ العملية'); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-extrabold text-gray-800 text-base flex items-center gap-2"><Building2 size={18} className="text-indigo-600" /> إدارة المستأجرين (SaaS)</h3>
        <button onClick={load} className="text-xs text-indigo-600 hover:underline flex items-center gap-1"><RefreshCw size={12} /> تحديث</button>
      </div>

      {/* Provision new tenant */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4">
        <div className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1"><Plus size={13} /> إنشاء مستأجر جديد</div>
        <div className="grid sm:grid-cols-4 gap-2">
          <input value={form.name} onChange={e => { const name = e.target.value; setForm(f => ({ ...f, name, slug: slugEdited ? f.slug : slugify(name) })); }}
            placeholder="اسم المؤسسة" className="text-sm border border-gray-200 rounded-lg px-3 py-2" />
          <input value={form.slug} onChange={e => { setSlugEdited(true); setForm(f => ({ ...f, slug: slugify(e.target.value) })); }}
            placeholder="المعرّف (subdomain)" className="text-sm border border-gray-200 rounded-lg px-3 py-2 font-mono" />
          <select value={form.plan_key} onChange={e => setForm(f => ({ ...f, plan_key: e.target.value }))} className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white">
            <option value="">بدون باقة</option>
            {plans.map(p => <option key={p.id} value={p.plan_key}>{p.name} ({p.base_price} {p.currency})</option>)}
          </select>
          <button disabled={busy === 'create'} onClick={create} className="text-sm px-3 py-2 rounded-lg bg-indigo-600 text-white font-bold disabled:opacity-50 flex items-center justify-center gap-1">
            {busy === 'create' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} إنشاء
          </button>
        </div>
        {form.slug && <p className="text-[11px] text-gray-400 mt-1.5">سيكون متاحاً على: <span className="font-mono">{form.slug}.mahadnafsy.com</span></p>}
      </div>

      {/* Tenants list */}
      {loading ? (
        <div className="text-center py-10 text-gray-400"><Loader2 size={20} className="animate-spin mx-auto" /></div>
      ) : tenants.length === 0 ? (
        <div className="text-center py-10 text-gray-400 bg-white rounded-2xl border border-gray-100">لا يوجد مستأجرون بعد</div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl divide-y divide-gray-50">
          {tenants.map(t => {
            const st = STATUS[t.status] || STATUS.active;
            return (
              <div key={t.id} className="flex items-center gap-3 p-3.5 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-gray-800 text-sm">{t.name}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                    {t.plan_name && <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">{t.plan_name}</span>}
                  </div>
                  <p className="text-[11px] text-gray-400 font-mono">{t.slug}.mahadnafsy.com</p>
                </div>
                <select value={t.plan_key || ''} onChange={e => patch(t.id, { plan_key: e.target.value }, 'تم تحديث الباقة')} disabled={busy === t.id}
                  className="text-[11px] border border-gray-200 rounded-lg px-2 py-1 bg-white">
                  <option value="">بدون باقة</option>
                  {plans.map(p => <option key={p.id} value={p.plan_key}>{p.name}</option>)}
                </select>
                {t.status === 'active' ? (
                  <button disabled={busy === t.id} onClick={() => patch(t.id, { status: 'suspended' }, 'تم الإيقاف')} className="text-[11px] px-2.5 py-1 rounded-lg bg-amber-100 text-amber-700 font-bold flex items-center gap-1"><Ban size={11} />إيقاف</button>
                ) : (
                  <button disabled={busy === t.id} onClick={() => patch(t.id, { status: 'active' }, 'تم التفعيل')} className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-700 font-bold flex items-center gap-1"><CheckCircle2 size={11} />تفعيل</button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-gray-400 text-center">كل مستأجر يُوجّه عبر نطاقه الفرعي؛ الإيقاف يمنع الدخول فوراً (تحديث خلال دقيقة).</p>
    </div>
  );
}
