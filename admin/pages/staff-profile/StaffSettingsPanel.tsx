// The staff settings form: contact, role, permissions, pay and login.
//
// Lifted out of StaffProfile.tsx with its own state — the draft, the password
// field and the save status, none of which the other seven tabs read. They
// display the member; this is the only one that edits it.
//
// The staff record, the viewer and the re-seed callback stay props because the
// save needs all three: a salary change to your own record is refused, and the
// page re-seeds the draft from what the server actually stored.

import { Shield, Camera, Eye, EyeOff, Save } from 'lucide-react';
import { compressImageFile } from '../../lib/imageBudget';
import { useEffect, useState } from 'react';
import type { StaffMember, StaffPermission } from '../../types';
import { mysqlAdmin, mysqlAuth } from '../../lib/mysqlapi';
import { ROLE_LABELS, PERMISSION_LABELS, ROLE_OPTIONS, ROLE_PRESETS, PERM_CATEGORIES, ACCESS_PREVIEW_TABS, ROLE_DEFAULT_PERMISSIONS } from './staffProfileConstants';

const createStaffAccount = async (staff: StaffMember, password: string): Promise<void> => {
  await mysqlAdmin.createStaffAccount({ ...staff, staffId: staff.id, password } as unknown as Record<string, unknown>);
};

export default function StaffSettingsPanel({
  staff, currentStaff, isAdmin, reloadStaffMembers, saveMsg, setSaveMsg,
}: {
  staff: StaffMember;
  currentStaff: StaffMember | null;
  isAdmin: boolean;
  reloadStaffMembers: () => Promise<void>;
  saveMsg: string;
  setSaveMsg: (message: string) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);

  const handlePasswordReset = async () => {
    if (!staff.email) return;
    try {
      const { temporaryPassword: tmpPw } = await mysqlAuth.forceResetPassword(staff.email);
      setSaveMsg(`✅ تم تعيين كلمة مرور مؤقتة: ${tmpPw} — يرجى تسليمها للموظف`);
    } catch (err: unknown) {
      setSaveMsg(`❌ ${err instanceof Error ? err.message : 'فشل تعيين كلمة المرور'}`);
    }
    setTimeout(() => setSaveMsg(''), 4000);
  };
  const [draft, setDraft] = useState<StaffMember | null>(null);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  // Initialise draft when staff loads, and re-seed it after a save so the form
  // shows what the server kept rather than what was typed at it.
  const [resyncKey, setResyncKey] = useState(0);
  useEffect(() => {
    if (staff && (!draft || resyncKey > 0)) setDraft({ ...staff });
    // draft is deliberately not a dependency: including it would re-seed on
    // every keystroke and make the form unusable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff, resyncKey]);

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.name || !draft.email) { setSaveMsg('❌ الاسم والبريد الإلكتروني مطلوبان'); return; }
    const salaryChanged = Number(draft.salary || 0) !== Number(staff.salary || 0);
    if (salaryChanged && currentStaff?.id === draft.id) {
      setSaveMsg('❌ لا يمكنك تعديل راتبك بنفسك؛ يلزم موظف HR آخر');
      return;
    }
    const samePerms = JSON.stringify([...(draft.permissions || [])].sort())
      === JSON.stringify([...(staff.permissions || [])].sort());
    const accessChanged = currentStaff?.id !== draft.id
      && (!samePerms || (draft.dataScope || '') !== (staff.dataScope || ''));
    setSaving(true);
    setSaveMsg('');
    const payload: StaffMember = { ...draft };
    try {
      if (!draft.firebaseUid && password.trim()) {
        await createStaffAccount(payload, password.trim());
        await reloadStaffMembers();
      } else {
        await mysqlAdmin.updateHrEmployee(payload.id, {
          name: payload.name.trim(),
          email: payload.email.trim().toLowerCase(),
          phone: payload.phone.trim(),
          image: payload.image || null,
          specialization: payload.specialization || null,
          joined_at: payload.joinedAt?.slice(0, 10) || null,
          notes: payload.notes || null,
          national_id: payload.nationalId || null,
          address: payload.address || null,
          hr_notes: payload.hrNotes || null,
          commission_rate: Number(payload.commissionRate) || 0,
          monthly_target: Number(payload.monthlyTarget) || 0,
          monthly_target_type: payload.monthlyTargetType || 'egp',
          monthly_bonus: Number(payload.monthlyBonus) || 0,
          ...(isAdmin ? { role: payload.role } : {}),
          // Access control travels with the save; the server drops both unless
          // the caller is a super admin. Before this, the permission grid and
          // the scope picker on this page edited nothing that ever persisted.
          // Only sent when actually changed and never for your own record —
          // the server rejects self-edits of these two fields outright.
          ...(isAdmin && accessChanged ? {
            permissions: payload.permissions || [],
            data_scope: payload.dataScope || null,
          } : {}),
        });
        let salaryPending = false;
        if (salaryChanged) {
          const effectiveDate = new Date();
          effectiveDate.setUTCDate(1);
          effectiveDate.setUTCMonth(effectiveDate.getUTCMonth() + 1);
          await mysqlAdmin.adminPost('/admin/hr/salary', {
            staff_id: payload.id,
            base_salary: Number(payload.salary) || 0,
            currency: 'EGP',
            effective_from: effectiveDate.toISOString().slice(0, 10),
          });
          salaryPending = true;
        }
        await reloadStaffMembers();
        // Re-seed the draft from what the server actually stored. Keeping the
        // optimistic draft meant a field the server declined still looked saved
        // until the page was reopened, which is how "the permissions do not
        // save" stayed invisible: the screen agreed with the admin right up
        // until they came back to it.
        setResyncKey(k => k + 1);
        if (salaryPending) {
          setDraft(d => d ? { ...d, salary: staff.salary } : d);
          setSaveMsg('ℹ️ تم حفظ البيانات وإرسال تعديل الراتب للاعتماد');
          setSaving(false);
          setTimeout(() => setSaveMsg(''), 4000);
          return;
        }
      }
    } catch (err: unknown) {
      setSaving(false);
      setSaveMsg(`❌ ${err instanceof Error ? err.message : 'فشل حفظ الموظف أو حساب الدخول'}`);
      return;
    }
    setSaving(false);
    setSaveMsg('✅ تم حفظ البيانات بنجاح');
    setTimeout(() => setSaveMsg(''), 3000);
  };

  if (!draft) return null;
  return (
        <div className="space-y-6">
          {saveMsg && (
            <div className={`rounded-xl px-4 py-3 text-sm font-bold ${saveMsg.startsWith('✅') ? 'bg-green-50 text-green-700 border border-green-200' : saveMsg.startsWith('⚠️') ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              {saveMsg}
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm space-y-5">
            <h3 className="text-base font-bold text-gray-800 flex items-center gap-2"><Shield size={16} /> البيانات الأساسية</h3>

            <div className="flex items-center gap-4">
              <div className="relative w-20 h-20 flex-shrink-0">
                {draft.image ? (
                  <img src={draft.image} alt={draft.name} className="w-20 h-20 rounded-2xl object-cover border border-gray-200" />
                ) : (
                  <div className="w-20 h-20 rounded-2xl bg-primary-100 text-primary-700 flex items-center justify-center text-2xl font-black">
                    {draft.name.charAt(0) || '?'}
                  </div>
                )}
                <label className="absolute -bottom-1.5 -left-1.5 w-7 h-7 rounded-full bg-primary-600 text-white flex items-center justify-center cursor-pointer hover:bg-primary-700 transition shadow">
                  <Camera size={13} />
                  <input type="file" accept="image/*" className="hidden" onChange={async e => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    try {
                      const dataUrl = await compressImageFile(file, { maxPx: 320, maxBytes: 45_000 });
                      setDraft(d => d ? { ...d, image: dataUrl } : d);
                    } catch {
                      setSaveMsg('❌ الصورة كبيرة جداً أو تعذّر ضغطها — جرّب صورة أصغر');
                    }
                  }} />
                </label>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-600 mb-1">صورة الموظف</p>
                <p className="text-xs text-gray-400">اضغط على أيقونة الكاميرا لرفع صورة (تُضغط تلقائيًا لحجم مناسب)</p>
                {draft.image && (
                  <button type="button" onClick={() => setDraft(d => d ? { ...d, image: undefined } : d)}
                    className="mt-1.5 text-xs font-bold text-red-500 hover:underline">إزالة الصورة</button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">الاسم *</label>
                <input className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-400"
                  placeholder="الاسم" value={draft.name}
                  onChange={e => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">البريد الإلكتروني *</label>
                <input className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-400"
                  placeholder="البريد الإلكتروني" value={draft.email}
                  onChange={e => setDraft({ ...draft, email: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">الهاتف</label>
                <input className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-400"
                  placeholder="الهاتف" value={draft.phone}
                  onChange={e => setDraft({ ...draft, phone: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">الدور الوظيفي</label>
                <select className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-400"
                  value={draft.role}
                  onChange={e => setDraft({ ...draft, role: e.target.value as StaffMember['role'] })}>
                  {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">التخصص</label>
                <input className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-400"
                  placeholder="التخصص" value={draft.specialization ?? ''}
                  onChange={e => setDraft({ ...draft, specialization: e.target.value })} />
              </div>
              {draft.role === 'sales' && (
                <div>
                  <label className="block text-xs font-semibold text-orange-600 mb-1">نسبة العمولة %</label>
                  <input type="number" min="0" max="100"
                    className="w-full border border-orange-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-orange-400"
                    placeholder="مثال: 10" value={draft.commissionRate ?? ''}
                    onChange={e => setDraft({ ...draft, commissionRate: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">تاريخ الانضمام</label>
                <input type="date" className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-400"
                  value={draft.joinedAt}
                  onChange={e => setDraft({ ...draft, joinedAt: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">الحالة</label>
                <select className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-400"
                  value={draft.status}
                  onChange={e => setDraft({ ...draft, status: e.target.value as 'active' | 'inactive' })}>
                  <option value="active">نشط</option>
                  <option value="inactive">غير نشط</option>
                </select>
              </div>
              <div className="md:col-span-2 lg:col-span-3">
                <label className="block text-xs font-semibold text-gray-600 mb-1">ملاحظات</label>
                <textarea className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-400" rows={2}
                  placeholder="ملاحظات..." value={draft.notes ?? ''}
                  onChange={e => setDraft({ ...draft, notes: e.target.value })} />
              </div>
            </div>

            {/* Password section */}
            {isAdmin && (
              <div className="border-t border-gray-100 pt-4 space-y-3">
                <p className="text-xs font-semibold text-gray-600">حساب الدخول</p>
                {staff.firebaseUid && (
                  <p className="text-xs text-green-600 font-medium flex items-center gap-1">✓ حساب Firebase مرتبط</p>
                )}
                <div className="flex gap-3 flex-wrap">
                  <div className="relative flex-1 min-w-[200px]">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className="w-full border border-indigo-200 rounded-xl px-4 py-2.5 text-sm pl-10 focus:outline-none focus:border-indigo-400"
                      placeholder={staff.firebaseUid ? 'كلمة مرور جديدة (اتركها فارغة)' : 'كلمة مرور الدخول'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                    />
                    <button type="button" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                      onClick={() => setShowPassword(!showPassword)}>
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {staff.email && (
                    <button type="button" onClick={() => void handlePasswordReset()}
                      className="px-4 py-2.5 rounded-xl border border-indigo-200 text-indigo-700 text-sm font-bold hover:bg-indigo-50 transition whitespace-nowrap">
                      إرسال رابط إعادة تعيين
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Permissions ── */}
          <div className="bg-white border border-indigo-100 rounded-2xl shadow-sm overflow-hidden">

            {/* Header */}
            <div className="bg-gradient-to-l from-indigo-50 to-white px-6 py-4 border-b border-indigo-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-indigo-900 flex items-center gap-2">
                  <Shield size={16} className="text-indigo-600" /> الصلاحيات والوصول
                </h3>
                <p className="text-xs text-indigo-400 mt-0.5">
                  {(draft.permissions || []).length} صلاحية مفعّلة من أصل {Object.keys(PERMISSION_LABELS).length}
                </p>
                {/* Say up front when this grid cannot be saved, instead of
                    letting it be filled in and silently discarded. */}
                {!isAdmin && (
                  <p className="text-xs text-amber-600 font-bold mt-1">
                    للعرض فقط — تعديل الصلاحيات متاح لمدير النظام
                  </p>
                )}
                {isAdmin && currentStaff?.id === draft.id && (
                  <p className="text-xs text-amber-600 font-bold mt-1">
                    لا يمكنك تعديل صلاحيات حسابك بنفسك
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button type="button"
                  className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-indigo-700 transition"
                  onClick={() => setDraft({ ...draft, permissions: Object.keys(PERMISSION_LABELS) as StaffPermission[] })}>
                  تحديد الكل
                </button>
                <button type="button"
                  className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg font-bold hover:bg-gray-200 transition"
                  onClick={() => setDraft({ ...draft, permissions: [] })}>
                  إلغاء الكل
                </button>
              </div>
            </div>

            {/* Role Presets strip */}
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/60">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-3">🎯 ضبط سريع حسب الوظيفة — اضغط لتطبيق الإعدادات الافتراضية</p>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {ROLE_PRESETS.map(preset => {
                  const isActive = draft.role === preset.role;
                  return (
                    <button key={preset.role} type="button"
                      onClick={() => setDraft({ ...draft, permissions: ROLE_DEFAULT_PERMISSIONS[preset.role] || [] })}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition text-center group ${
                        isActive
                          ? 'border-primary-400 bg-primary-50 shadow-sm'
                          : 'border-gray-200 bg-white hover:border-primary-300 hover:bg-primary-50 hover:shadow-sm'
                      }`}>
                      <span className="text-xl leading-none">{preset.icon}</span>
                      <span className={`text-[11px] font-bold leading-tight ${isActive ? 'text-primary-700' : 'text-gray-700 group-hover:text-primary-700'}`}>{preset.label}</span>
                      <span className="text-[9px] text-gray-400 leading-tight text-center">{preset.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Role description box for current role */}
            {draft.role && ROLE_DEFAULT_PERMISSIONS[draft.role] && (
              <div className="px-6 py-3 bg-blue-50 border-b border-blue-100 flex items-start gap-2">
                <span className="text-blue-500 mt-0.5 flex-shrink-0">ℹ️</span>
                <div>
                  <p className="text-xs font-bold text-blue-800">
                    الصلاحيات الافتراضية لـ {ROLE_LABELS[draft.role] || draft.role}:
                  </p>
                  <p className="text-[11px] text-blue-600 mt-0.5">
                    {(() => {
                      const map: Record<string,string> = {
                        sales:          'يشوف الليدات بتاعته بس — ليدات + مشتركين مرتبطين + طلباتهم + استشارات',
                        collection:     'يشوف كل المشتركين — مشتركين + مدفوعات + تقارير مالية + إدارة الطلبات',
                        support:        'ليدات + مشتركين + صندوق الوارد + إشعارات + تقارير + استشارات',
                        manager:        'وصول كامل لجميع أقسام لوحة التحكم',
                        admin:          'وصول كامل — مثل المدير تماماً',
                        accountant:     'طلبات + تقارير مالية فقط — لا يرى الليدات أو المشتركين',
                        consultant:     'استشارات + ليدات + مشتركين + تقارير',
                        trainer:        'كورسات + محاضرات + مشتركين + استشارات',
                        instructor:     'كورسات ومحاضرات فقط + عرض المشتركين',
                        expert:         'عرض الكورسات والمشتركين فقط',
                        reception_daqqi:'ليدات + مشتركين + رسائل + جدول كورسات الدقي',
                        other:          'اللوحة الرئيسية فقط',
                      };
                      return map[draft.role] || 'صلاحيات مخصصة';
                    })()}
                  </p>
                </div>
              </div>
            )}

            {/* ── Data reach ──
                Permissions decide which *screens* open; this decides which
                *rows* the server returns. They used to be welded together
                through the single `role` column, so a hybrid job (HR lead who
                also runs sales) got HR's scope — 'none' — and every sales
                screen came back empty or 403. */}
            <div className="px-6 py-4 border-b border-amber-100 bg-amber-50/50">
              <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wide mb-2">
                🎯 نطاق البيانات — الصفوف اللي الموظف يشوفها فعلاً
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {([
                  ['',               'حسب الوظيفة (افتراضي)'],
                  ['all',            'كل الداتا'],
                  ['assigned_sales', 'المُسنَد له كمبيعات فقط'],
                  ['assigned_cs',    'المُسنَد له كخدمة عملاء فقط'],
                  ['none',           'لا يرى أي داتا عملاء'],
                ] as const).map(([val, label]) => (
                  <button key={val || 'default'} type="button"
                    onClick={() => setDraft({ ...draft, dataScope: val })}
                    className={`text-xs px-3 py-1.5 rounded-lg font-bold border transition ${
                      (draft.dataScope || '') === val
                        ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                        : 'bg-white text-amber-700 border-amber-200 hover:border-amber-400'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-amber-600 mt-2">
                سيب الافتراضي إلا لو الموظف بيشتغل في أكتر من قسم — ساعتها الوظيفة الواحدة
                مش كفاية تعبّر عن اللي المفروض يشوفه.
              </p>
            </div>

            {/* Grouped permission categories */}
            <div className="p-5 space-y-3">
              {PERM_CATEGORIES.map(cat => {
                const cur = draft.permissions || [];
                const checkedCount = cat.perms.filter(p => cur.includes(p)).length;
                const allChecked = checkedCount === cat.perms.length;
                return (
                  <div key={cat.key} className={`rounded-xl border ${cat.border} overflow-hidden`}>
                    {/* Category header */}
                    <div className={`${cat.bg} px-4 py-2.5 flex items-center justify-between`}>
                      <div className="flex items-center gap-2">
                        <span className="text-base leading-none">{cat.icon}</span>
                        <span className={`text-sm font-bold ${cat.text}`}>{cat.label}</span>
                        <span className={`text-[10px] font-normal px-1.5 py-0.5 rounded-full border ${cat.border} ${cat.text} opacity-70`}>
                          {checkedCount}/{cat.perms.length}
                        </span>
                      </div>
                      <button type="button"
                        className={`text-[11px] font-bold ${cat.text} opacity-80 hover:opacity-100 transition border ${cat.border} bg-white rounded-lg px-2.5 py-0.5`}
                        onClick={() => {
                          if (allChecked) {
                            setDraft({ ...draft, permissions: cur.filter(p => !cat.perms.includes(p)) });
                          } else {
                            setDraft({ ...draft, permissions: [...new Set([...cur, ...cat.perms])] });
                          }
                        }}>
                        {allChecked ? '✗ إلغاء الكل' : '✓ تحديد الكل'}
                      </button>
                    </div>
                    {/* Permission checkboxes */}
                    <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5 bg-white">
                      {cat.perms.map(perm => {
                        const isChecked = cur.includes(perm);
                        return (
                          <label key={perm}
                            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer text-xs transition ${
                              isChecked
                                ? `${cat.bg} ${cat.border} ${cat.text} font-medium`
                                : 'border-gray-100 text-gray-500 hover:border-gray-200 hover:bg-gray-50'
                            }`}>
                            <input type="checkbox" className="accent-indigo-600 w-3.5 h-3.5 flex-shrink-0" checked={isChecked}
                              onChange={() => {
                                setDraft({
                                  ...draft,
                                  permissions: isChecked ? cur.filter(p => p !== perm) : [...cur, perm],
                                });
                              }} />
                            <span className="leading-tight">{PERMISSION_LABELS[perm]}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Access preview */}
            <div className="px-5 pb-5">
              <div className="bg-gradient-to-l from-gray-50 to-white border border-gray-200 rounded-xl p-4">
                <p className="text-xs font-bold text-gray-600 mb-3 flex items-center gap-1.5">
                  <Eye size={12} /> ملخص الوصول — التبويبات المتاحة لهذا الموظف
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {ACCESS_PREVIEW_TABS.map(t => {
                    const accessible = (draft.permissions || []).some(p => t.perms.includes(p));
                    return (
                      <span key={t.label}
                        className={`flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full border font-bold transition ${
                          accessible
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-gray-50 text-gray-300 border-gray-200 line-through'
                        }`}>
                        {t.icon} {t.label}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>

          </div>

          {/* Save button */}
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white font-bold px-6 py-3 rounded-xl text-sm transition flex items-center justify-center gap-2"
          >
            {saving ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save size={16} />}
            {saving ? 'جارٍ الحفظ...' : 'حفظ التغييرات'}
          </button>
        </div>
  );
}
