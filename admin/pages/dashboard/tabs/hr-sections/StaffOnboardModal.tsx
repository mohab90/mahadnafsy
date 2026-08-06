import { useMemo, useState } from 'react';
import { Eye, EyeOff, RefreshCw, ShieldCheck, X } from 'lucide-react';
import {
  PERMISSION_CATEGORIES, PERMISSION_LABELS, ROLE_LABELS, getDefaultPermsArray,
  type PermissionKey, type RoleKey,
} from '../../../../constants/permissions';
import { useBranches } from '../../../../hooks/useBranches';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;

export type OnboardResult = {
  name: string; email: string; phone: string; password: string;
  role: string; position: string; branchId: string;
  permissions: string[] | null; activate: boolean;
};

/**
 * Roles a person can be hired into, ordered the way the desk thinks about them
 * (front-line first, management after) rather than alphabetically. Labels come
 * from the shared ROLE_LABELS so this list can never drift from the rest of the
 * dashboard; the API validates the value against its own STAFF_ROLES set.
 */
const HIRE_ROLES: RoleKey[] = [
  'sales', 'collection', 'support', 'reception_daqqi', 'accountant', 'hr',
  'online_manager', 'daqqi_manager', 'sales_collection_manager', 'manager', 'admin',
  'instructor', 'trainer', 'expert', 'consultant', 'other',
];
const ROLE_OPTIONS = HIRE_ROLES.map(role => ({
  value: role.toUpperCase(),
  label: ROLE_LABELS[role] || role,
}));

const strongPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const pick = (n: number) => Array.from({ length: n },
    () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${pick(9)}!${Math.floor(Math.random() * 90 + 10)}`;
};

/**
 * One dialog for both doors into the staff table: hiring an accepted applicant,
 * and adding an employee directly. Hiring used to create the record silently
 * with a guessed role, no login and no position, leaving the desk to go and fix
 * three things afterwards — and adding an employee outright had no screen at all.
 */
export default function StaffOnboardModal({
  open, title, initial, submitLabel, onClose, onSubmit, notify,
}: {
  open: boolean;
  title: string;
  initial?: Partial<OnboardResult>;
  submitLabel?: string;
  onClose: () => void;
  onSubmit: (result: OnboardResult) => Promise<void>;
  notify: Notify;
}) {
  const branches = useBranches();
  const [form, setForm] = useState<OnboardResult>(() => ({
    name: initial?.name || '', email: initial?.email || '', phone: initial?.phone || '',
    password: '', role: initial?.role || 'SALES', position: initial?.position || '',
    branchId: initial?.branchId || '', permissions: null, activate: true,
  }));
  const [showPassword, setShowPassword] = useState(false);
  const [customisePerms, setCustomisePerms] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof OnboardResult>(key: K, value: OnboardResult[K]) =>
    setForm(f => ({ ...f, [key]: value }));

  // What the chosen role grants by default — shown so the desk can see the
  // consequence of the role before overriding anything.
  const rolePerms = useMemo<string[]>(
    () => getDefaultPermsArray(form.role.toLowerCase()) as string[],
    [form.role],
  );
  const effectivePerms = form.permissions ?? rolePerms;

  if (!open) return null;

  const togglePerm = (perm: string) => {
    const base = form.permissions ?? rolePerms;
    set('permissions', base.includes(perm) ? base.filter(p => p !== perm) : [...base, perm]);
  };

  const submit = async () => {
    if (!form.name.trim()) { notify('error', 'اسم الموظف مطلوب'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) { notify('error', 'بريد إلكتروني غير صحيح'); return; }
    if (form.password && form.password.length < 8) { notify('error', 'كلمة المرور 8 أحرف على الأقل'); return; }
    setBusy(true);
    try {
      await onSubmit({ ...form, email: form.email.trim().toLowerCase(), name: form.name.trim() });
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4" dir="rtl"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-indigo-50 px-5 py-4">
          <h3 className="flex items-center gap-2 font-extrabold text-gray-900">
            <ShieldCheck size={17} className="text-indigo-600" /> {title}
          </h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-gray-600">الاسم</label>
              <input value={form.name} onChange={e => set('name', e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-gray-600">رقم الهاتف</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)} dir="ltr"
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-gray-600">
                البريد الإلكتروني <span className="text-gray-400">(يدخل بيه على السيستم)</span>
              </label>
              <input value={form.email} onChange={e => set('email', e.target.value)} dir="ltr"
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-gray-600">كلمة المرور</label>
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <input type={showPassword ? 'text' : 'password'} value={form.password}
                    onChange={e => set('password', e.target.value)} dir="ltr"
                    placeholder="اتركها فارغة لعدم إنشاء حساب دخول"
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 pl-9 text-sm" />
                  <button type="button" onClick={() => setShowPassword(v => !v)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <button type="button" onClick={() => { set('password', strongPassword()); setShowPassword(true); }}
                  className="rounded-xl bg-gray-100 px-2.5 text-gray-600 hover:bg-gray-200" title="توليد كلمة مرور">
                  <RefreshCw size={14} />
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-gray-600">الدور في السيستم (الصلاحيات)</label>
              <select value={form.role} onChange={e => { set('role', e.target.value); set('permissions', null); }}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
                {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-gray-600">
                المسمى الوظيفي <span className="text-gray-400">(البوزيشن)</span>
              </label>
              <input value={form.position} onChange={e => set('position', e.target.value)}
                placeholder="مثال: مندوب مبيعات أول — فرع الدقي"
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-bold text-gray-600">الفرع</label>
              <select value={form.branchId} onChange={e => set('branchId', e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
                <option value="">— الفرع الافتراضي —</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
            </div>
          </div>

          {/* Permissions — role default, visible, overridable */}
          <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs font-bold text-gray-700">
                صلاحيات هذا الدور: <span className="text-indigo-700">{effectivePerms.length}</span> صلاحية
              </p>
              <button type="button" onClick={() => setCustomisePerms(v => !v)}
                className="text-[11px] font-bold text-indigo-600 hover:underline">
                {customisePerms ? 'إخفاء' : 'تخصيص الصلاحيات'}
              </button>
            </div>
            {!customisePerms && (
              <div className="mt-2 flex flex-wrap gap-1">
                {effectivePerms.slice(0, 10).map(p => (
                  <span key={p} className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-gray-600 border border-gray-200">
                    {PERMISSION_LABELS[p as PermissionKey] || p}
                  </span>
                ))}
                {effectivePerms.length > 10 && (
                  <span className="text-[10px] text-gray-400">+{effectivePerms.length - 10}</span>
                )}
              </div>
            )}
            {customisePerms && (
              <div className="mt-3 max-h-64 space-y-3 overflow-y-auto">
                {PERMISSION_CATEGORIES.map(category => (
                  <div key={category.label}>
                    <p className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-gray-400">
                      {category.label}
                    </p>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {category.perms.map(perm => (
                        <label key={perm} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-xs">
                          <input type="checkbox" checked={effectivePerms.includes(perm)}
                            onChange={() => togglePerm(perm)} className="h-3.5 w-3.5" />
                          <span className="text-gray-700">{PERMISSION_LABELS[perm] || perm}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm font-bold text-gray-700">
            <input type="checkbox" checked={form.activate} onChange={e => set('activate', e.target.checked)}
              className="h-4 w-4" />
            تنشيط الحساب فورًا
            <span className="text-xs font-normal text-gray-400">(بدون تنشيط لن يستطيع الدخول)</span>
          </label>
          {form.activate && !form.password && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800">
              لازم تحدد كلمة مرور عشان الموظف يقدر يدخل فعلًا.
            </p>
          )}

          <div className="flex gap-2 border-t border-gray-100 pt-4">
            <button type="button" disabled={busy} onClick={submit}
              className="flex-1 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60 transition">
              {busy ? 'جارٍ الحفظ…' : (submitLabel || 'تأكيد')}
            </button>
            <button type="button" onClick={onClose}
              className="rounded-xl bg-gray-100 px-5 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-200 transition">
              إلغاء
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { ROLE_OPTIONS };
