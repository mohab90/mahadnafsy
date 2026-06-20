/**
 * RbacSettingsTab — edit per-role default permissions from the UI.
 * Saves to site_config (key 'rbac.roleOverrides'); applied at runtime via
 * setRoleOverrides in permissions.ts. Full-access roles (admin/manager/...) are
 * excluded so an admin can never lock themselves out. view_dashboard is always kept.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Shield, Save, RotateCcw, Check } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import {
  ROLE_LABELS, FULL_ACCESS_ROLES, PERMISSION_CATEGORIES, PERMISSION_LABELS,
  getDefaultPermsArray, type RoleKey, type PermissionKey,
} from '../../../constants/permissions';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

const EDITABLE_ROLES = (Object.keys(ROLE_LABELS) as RoleKey[]).filter(r => !FULL_ACCESS_ROLES.includes(r));

export default function RbacSettingsTab({ notify }: { notify: NotifyFn }) {
  const { content, setContentValue } = useSiteData();
  const overrides = useMemo<Record<string, PermissionKey[]>>(() => {
    try { return content['rbac.roleOverrides'] ? JSON.parse(content['rbac.roleOverrides']) : {}; }
    catch { return {}; }
  }, [content]);

  const [role, setRole] = useState<RoleKey>(EDITABLE_ROLES[0]);
  const [perms, setPerms] = useState<Set<PermissionKey>>(new Set());
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const ov = overrides[role];
    setPerms(new Set(Array.isArray(ov) ? ov : getDefaultPermsArray(role)));
  }, [role, overrides]);

  const isCustom = Array.isArray(overrides[role]);
  const toggle = (p: PermissionKey) => setPerms(s => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });

  const save = () => {
    const list = Array.from(new Set<PermissionKey>([...perms, 'view_dashboard']));
    const next = { ...overrides, [role]: list };
    setContentValue('rbac.roleOverrides', JSON.stringify(next));
    notify('success', `تم حفظ صلاحيات «${ROLE_LABELS[role]}»`);
    setSaved(true); setTimeout(() => setSaved(false), 1500);
  };

  const resetToDefault = () => {
    const next = { ...overrides }; delete next[role];
    setContentValue('rbac.roleOverrides', JSON.stringify(next));
    setPerms(new Set(getDefaultPermsArray(role)));
    notify('success', `تمت إعادة «${ROLE_LABELS[role]}» للصلاحيات الافتراضية`);
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-rose-700 grid place-items-center"><Shield size={20} className="text-white" /></div>
        <div>
          <h2 className="text-xl font-extrabold text-gray-900">الصلاحيات والأدوار (RBAC)</h2>
          <p className="text-sm text-gray-500">تحكّم بما يراه/يعدّله كل دور. أدوار المدراء مفتوحة دائماً ولا تُقيَّد من هنا.</p>
        </div>
      </div>

      {/* Role selector */}
      <div className="flex flex-wrap gap-2">
        {EDITABLE_ROLES.map(r => (
          <button key={r} onClick={() => setRole(r)}
            className={`px-3 py-2 rounded-xl text-sm font-bold transition ${role === r ? 'bg-rose-600 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {ROLE_LABELS[r]}{Array.isArray(overrides[r]) && <span className="mr-1 text-[10px] opacity-80">●</span>}
          </button>
        ))}
      </div>

      {/* Permission grid */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="font-bold text-gray-800">صلاحيات: <span className="text-rose-700">{ROLE_LABELS[role]}</span>
            <span className="text-xs text-gray-400 mr-2">({perms.size} مفعّلة){isCustom ? ' · مُخصّصة' : ' · افتراضية'}</span>
          </p>
          <div className="flex gap-2">
            <button onClick={resetToDefault} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm font-bold hover:bg-gray-200"><RotateCcw size={14} /> افتراضي</button>
            <button onClick={save} className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 text-white rounded-xl text-sm font-bold hover:bg-rose-700">{saved ? <Check size={15} /> : <Save size={15} />} حفظ</button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {PERMISSION_CATEGORIES.map(cat => (
            <div key={cat.label} className="border border-gray-100 rounded-xl p-3">
              <p className="text-xs font-extrabold text-gray-500 mb-2">{cat.label}</p>
              <div className="space-y-1.5">
                {cat.perms.map(p => (
                  <label key={p} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 hover:text-rose-700">
                    <input type="checkbox" checked={perms.has(p)} onChange={() => toggle(p)} className="accent-rose-600 w-4 h-4" />
                    {PERMISSION_LABELS[p]}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
