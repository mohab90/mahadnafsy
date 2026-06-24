import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { Users, Briefcase, Award, Search, BarChart3, Target, Edit3, Save, X, Plus, Trash2, ChevronRight, Wallet, Calendar, Clock, CheckCircle, XCircle, Upload, AlertCircle } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import type { StaffMember, StaffRole, StaffAbsence } from '../../../types';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }

const ROLE_LABELS: Record<string, string> = {
  instructor: 'مدرب', trainer: 'مدرب', expert: 'خبير', sales: 'مبيعات',
  manager: 'مدير', admin: 'مسؤول', support: 'دعم فني', reception_daqqi: 'استقبال دقي',
  daqqi_manager: 'مدير دقي', collection: 'تحصيل', accountant: 'محاسب',
  consultant: 'مستشار', other: 'أخرى',
};
const ROLE_COLORS: Record<string, string> = {
  manager: 'bg-purple-100 text-purple-700', admin: 'bg-gray-100 text-gray-700',
  sales: 'bg-blue-100 text-blue-700', support: 'bg-teal-100 text-teal-700',
  instructor: 'bg-indigo-100 text-indigo-700', trainer: 'bg-indigo-100 text-indigo-700',
  collection: 'bg-orange-100 text-orange-700', accountant: 'bg-amber-100 text-amber-700',
  reception_daqqi: 'bg-cyan-100 text-cyan-700', daqqi_manager: 'bg-cyan-100 text-cyan-700',
  consultant: 'bg-rose-100 text-rose-700', expert: 'bg-pink-100 text-pink-700',
  other: 'bg-gray-100 text-gray-700',
};
const ABSENCE_LABELS: Record<string, string> = {
  absence: 'غياب', leave: 'إجازة', sick: 'مرضي', late: 'تأخير'
};
const ABSENCE_COLORS: Record<string, string> = {
  absence: 'bg-red-100 text-red-700', leave: 'bg-blue-100 text-blue-700',
  sick: 'bg-amber-100 text-amber-700', late: 'bg-orange-100 text-orange-700'
};

const LEAVE_TYPE_LABELS: Record<string, string> = {
  ANNUAL: 'إجازة سنوية', SICK: 'إجازة مرضية', UNPAID: 'إجازة بدون راتب',
  MATERNITY: 'إجازة أمومة', EMERGENCY: 'إجازة طارئة',
  PERMISSION: 'إذن', OTHER: 'أخرى',
};
const LEAVE_TYPE_COLORS: Record<string, string> = {
  ANNUAL: 'bg-blue-100 text-blue-700', SICK: 'bg-amber-100 text-amber-700',
  UNPAID: 'bg-gray-100 text-gray-600', MATERNITY: 'bg-pink-100 text-pink-700',
  EMERGENCY: 'bg-red-100 text-red-700', PERMISSION: 'bg-cyan-100 text-cyan-700',
  OTHER: 'bg-gray-100 text-gray-600',
};
const LEAVE_STATUS_LABELS: Record<string, string> = {
  PENDING: 'معلق', APPROVED: 'موافق عليه', REJECTED: 'مرفوض', CANCELLED: 'ملغي',
};
const LEAVE_STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700', APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700', CANCELLED: 'bg-gray-100 text-gray-500',
};
const PAYROLL_STATUS_LABELS: Record<string, string> = {
  CALCULATED: 'محسوب', APPROVED: 'معتمد', PAID: 'مدفوع', CANCELLED: 'ملغي',
};
const PAYROLL_STATUS_COLORS: Record<string, string> = {
  CALCULATED: 'bg-blue-100 text-blue-700', APPROVED: 'bg-emerald-100 text-emerald-700',
  PAID: 'bg-green-100 text-green-800', CANCELLED: 'bg-gray-100 text-gray-500',
};

function getMonthsOfService(joinedAt: string) {
  const ms = Date.now() - new Date(joinedAt).getTime();
  const months = ms / (30.4 * 86400000);
  if (months < 1) return `${Math.round(ms / 86400000)} يوم`;
  if (months < 12) return `${Math.round(months)} شهر`;
  const y = Math.floor(months / 12); const m = Math.round(months % 12);
  return m > 0 ? `${y} سنة ${m} شهر` : `${y} سنة`;
}
const fmt = (n: number) => n.toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 0 });
const fmtMoney = (n: number) => `${fmt(n)} ج.م`;

function EmployeeProfileModal({ member, orders, leads, onClose, onSave }: {
  member: StaffMember; orders: any[]; leads: any[]; onClose: () => void; onSave: (u: StaffMember) => void;
}) {
  const [draft, setDraft] = useState<StaffMember>({ ...member });
  const [subTab, setSubTab] = useState<'info' | 'performance' | 'salary' | 'absences'>('info');
  const [editing, setEditing] = useState(false);
  const [newAbs, setNewAbs] = useState<{ open: boolean; type: StaffAbsence['type']; date: string; notes: string }>({ open: false, type: 'absence', date: new Date().toISOString().slice(0, 10), notes: '' });
  const [perfMonth, setPerfMonth] = useState(new Date().toISOString().slice(0, 7));

  const monthOrders = useMemo(() => {
    const start = perfMonth + '-01';
    const end = new Date(new Date(start).getTime() + 32 * 86400000).toISOString().slice(0, 7) + '-01';
    return orders.filter(o => o.staffId === member.id && o.status === 'paid' && (o.paidAt || o.createdAt) >= start && (o.paidAt || o.createdAt) < end);
  }, [orders, member.id, perfMonth]);

  const monthRev = useMemo(() => monthOrders.reduce((s, o) => s + (o.amount || 0), 0), [monthOrders]);
  const monthLeads = useMemo(() => leads.filter(l => l.assignedSalesId === member.id), [leads, member.id]);
  const converted = useMemo(() => monthLeads.filter(l => l.status === 'converted').length, [monthLeads]);
  const commission = monthRev * (draft.commissionRate || 0) / 100;
  const targetType = draft.monthlyTargetType || 'egp';
  const progress = targetType === 'egp' ? monthRev : converted;
  const targetValue = draft.monthlyTarget || 0;
  const targetPct = targetValue > 0 ? Math.min(100, Math.round(progress / targetValue * 100)) : 0;
  const targetHit = targetValue > 0 && progress >= targetValue;
  const absences = draft.absences || [];

  const save = () => { onSave(draft); setEditing(false); };
  const addAbs = () => {
    if (!newAbs.date) return;
    setDraft(d => ({ ...d, absences: [...(d.absences || []), { id: `abs-${Date.now()}`, date: newAbs.date, type: newAbs.type, notes: newAbs.notes || undefined }] }));
    setNewAbs(a => ({ ...a, open: false, notes: '' }));
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mt-8 mb-8" dir="rtl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="bg-gradient-to-l from-slate-700 to-gray-600 rounded-t-2xl p-5 text-white">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center text-2xl font-black">{member.name.charAt(0)}</div>
              <div>
                <h2 className="text-xl font-black">{member.name}</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">{ROLE_LABELS[member.role] || member.role}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${member.status === 'active' ? 'bg-green-400/30' : 'bg-red-400/30'}`}>{member.status === 'active' ? '● نشط' : '● غير نشط'}</span>
                </div>
                <p className="text-xs text-slate-300 mt-1">منضم منذ {member.joinedAt?.slice(0, 10)} · {getMonthsOfService(member.joinedAt || new Date().toISOString())}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {editing ? (
                <>
                  <button onClick={save} className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 rounded-lg text-sm font-bold transition"><Save size={13}/> حفظ</button>
                  <button onClick={() => { setDraft({ ...member }); setEditing(false); }} className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition"><X size={14}/></button>
                </>
              ) : (
                <button onClick={() => setEditing(true)} className="flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition"><Edit3 size={13}/> تعديل</button>
              )}
              <button onClick={onClose} className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition"><X size={14}/></button>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-4">
            {[
              { label: 'مبيعات الشهر', v: fmtMoney(monthRev) },
              { label: 'عمولة', v: fmtMoney(commission) },
              { label: 'ليدات', v: String(monthLeads.length) },
              { label: 'تحويل', v: monthLeads.length > 0 ? `${Math.round(converted / monthLeads.length * 100)}%` : '—' },
            ].map(s => (
              <div key={s.label} className="bg-white/10 rounded-xl p-2 text-center">
                <div className="font-black text-sm">{s.v}</div>
                <div className="text-[10px] text-slate-300 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
        {/* Sub tabs */}
        <div className="flex border-b border-gray-100 px-4">
          {([['info', '👤 بيانات'], ['performance', '📊 أداء'], ['salary', '💰 راتب وتارجيت'], ['absences', '📅 غياب']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setSubTab(k)} className={`py-3 px-3 text-xs font-bold border-b-2 transition-colors ${subTab === k ? 'border-slate-600 text-slate-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>{l}</button>
          ))}
        </div>
        <div className="p-5 space-y-4">
          {/* Info */}
          {subTab === 'info' && (
            <div className="grid grid-cols-2 gap-4">
              {[
                ['name', 'الاسم', 'text'], ['email', 'البريد الإلكتروني', 'email'],
                ['phone', 'الهاتف', 'text'], ['joinedAt', 'تاريخ الانضمام', 'date'],
                ['specialization', 'التخصص', 'text'], ['nationalId', 'الرقم القومي', 'text'],
                ['address', 'العنوان', 'text'], ['department', 'القسم', 'text'],
              ].map(([field, label, type]) => (
                <div key={field}>
                  <label className="text-xs font-bold text-gray-500 mb-1 block">{label}</label>
                  <input type={type} disabled={!editing} value={String((draft as any)[field] || '')} onChange={e => setDraft(d => ({ ...d, [field]: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50" />
                </div>
              ))}
              <div>
                <label className="text-xs font-bold text-gray-500 mb-1 block">الدور الوظيفي</label>
                <select disabled={!editing} value={draft.role} onChange={e => setDraft(d => ({ ...d, role: e.target.value as StaffRole }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-50">
                  {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 mb-1 block">الحالة</label>
                <select disabled={!editing} value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value as 'active' | 'inactive' }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-50">
                  <option value="active">نشط</option>
                  <option value="inactive">غير نشط</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-bold text-gray-500 mb-1 block">ملاحظات HR</label>
                <textarea disabled={!editing} value={draft.hrNotes || ''} onChange={e => setDraft(d => ({ ...d, hrNotes: e.target.value }))} rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none disabled:bg-gray-50" />
              </div>
              {draft.permissions && draft.permissions.length > 0 && (
                <div className="col-span-2">
                  <label className="text-xs font-bold text-gray-500 mb-1 block">الصلاحيات ({draft.permissions.length})</label>
                  <div className="flex flex-wrap gap-1">
                    {draft.permissions.map(p => <span key={p} className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">{p}</span>)}
                  </div>
                </div>
              )}
            </div>
          )}
          {/* Performance */}
          {subTab === 'performance' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <label className="text-sm font-bold text-gray-700">شهر التقرير:</label>
                <input type="month" value={perfMonth} onChange={e => setPerfMonth(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              {targetValue > 0 && (
                <div className={`p-4 rounded-2xl border ${targetHit ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-sm flex items-center gap-2"><Target size={15}/> التارجيت: {targetType === 'egp' ? fmtMoney(targetValue) : `${targetValue} عميل`}</span>
                    <span className={`text-sm font-black ${targetHit ? 'text-emerald-700' : 'text-amber-700'}`}>{targetHit ? '✅ تحقق!' : `${targetPct}%`}</span>
                  </div>
                  <div className="h-3 bg-white/60 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${targetHit ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${targetPct}%` }} />
                  </div>
                  <p className="text-xs mt-1.5 opacity-70">المحقق: {targetType === 'egp' ? fmtMoney(progress) : `${progress} عميل`}</p>
                  {targetHit && draft.monthlyBonus && <p className="text-xs text-emerald-700 font-bold mt-1">🎁 مكافأة: {fmtMoney(draft.monthlyBonus)}</p>}
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { l: 'إجمالي المبيعات', v: fmtMoney(monthRev), c: 'text-green-600' },
                  { l: 'العمولة', v: fmtMoney(commission), c: 'text-amber-600' },
                  { l: 'عدد الطلبات', v: String(monthOrders.length), c: 'text-blue-600' },
                  { l: 'ليدات', v: String(monthLeads.length), c: 'text-indigo-600' },
                  { l: 'محولون', v: String(converted), c: 'text-teal-600' },
                  { l: 'معدل التحويل', v: monthLeads.length > 0 ? `${Math.round(converted / monthLeads.length * 100)}%` : '—', c: 'text-gray-700' },
                ].map(s => (
                  <div key={s.l} className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                    <div className={`text-xl font-black ${s.c}`}>{s.v}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{s.l}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Salary */}
          {subTab === 'salary' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-gray-500 mb-1 block">الراتب الأساسي (ج.م)</label>
                  <input type="number" disabled={!editing} value={draft.salary || ''} onChange={e => setDraft(d => ({ ...d, salary: Number(e.target.value) }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50" placeholder="0" />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 mb-1 block">نسبة العمولة %</label>
                  <input type="number" disabled={!editing} value={draft.commissionRate || ''} onChange={e => setDraft(d => ({ ...d, commissionRate: Number(e.target.value) }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50" placeholder="0" />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 mb-1 block">نوع التارجيت</label>
                  <select disabled={!editing} value={draft.monthlyTargetType || 'egp'} onChange={e => setDraft(d => ({ ...d, monthlyTargetType: e.target.value as 'egp' | 'clients' }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-50">
                    <option value="egp">مبلغ مالي (ج.م)</option>
                    <option value="clients">عدد عملاء</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 mb-1 block">قيمة التارجيت</label>
                  <input type="number" disabled={!editing} value={draft.monthlyTarget || ''} onChange={e => setDraft(d => ({ ...d, monthlyTarget: Number(e.target.value) }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50" placeholder="0" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-bold text-gray-500 mb-1 block">مكافأة عند تحقيق التارجيت (ج.م)</label>
                  <input type="number" disabled={!editing} value={draft.monthlyBonus || ''} onChange={e => setDraft(d => ({ ...d, monthlyBonus: Number(e.target.value) }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50" placeholder="0" />
                </div>
              </div>
              {(draft.salary || draft.commissionRate) ? (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2">
                  <h4 className="font-bold text-slate-700 text-sm flex items-center gap-2"><Wallet size={14}/> ملخص الراتب هذا الشهر</h4>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between"><span className="text-gray-500">راتب أساسي</span><span className="font-bold">{fmtMoney(draft.salary || 0)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">عمولة ({draft.commissionRate || 0}%)</span><span className="font-bold text-amber-700">{fmtMoney(commission)}</span></div>
                    {targetHit && draft.monthlyBonus ? <div className="flex justify-between"><span className="text-gray-500">مكافأة التارجيت</span><span className="font-bold text-emerald-700">{fmtMoney(draft.monthlyBonus)}</span></div> : null}
                    <div className="flex justify-between border-t border-slate-200 pt-1.5 mt-1.5">
                      <span className="font-black text-slate-700">الإجمالي</span>
                      <span className="font-black text-slate-700">{fmtMoney((draft.salary || 0) + commission + (targetHit ? (draft.monthlyBonus || 0) : 0))}</span>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}
          {/* Absences */}
          {subTab === 'absences' && (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-2">
                {(['absence', 'leave', 'sick', 'late'] as const).map(t => (
                  <div key={t} className={`text-center rounded-xl p-2 border ${ABSENCE_COLORS[t]}`}>
                    <div className="text-xl font-black">{absences.filter(a => a.type === t).length}</div>
                    <div className="text-[10px] font-bold">{ABSENCE_LABELS[t]}</div>
                  </div>
                ))}
              </div>
              {editing && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2">
                  <h4 className="text-sm font-bold text-blue-700 flex items-center gap-1"><Plus size={13}/> إضافة سجل</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <select value={newAbs.type} onChange={e => setNewAbs(a => ({ ...a, type: e.target.value as StaffAbsence['type'] }))} className="border border-blue-200 rounded-lg px-3 py-2 text-sm bg-white">
                      {Object.entries(ABSENCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <input type="date" value={newAbs.date} onChange={e => setNewAbs(a => ({ ...a, date: e.target.value }))} className="border border-blue-200 rounded-lg px-3 py-2 text-sm" />
                    <input className="col-span-2 border border-blue-200 rounded-lg px-3 py-2 text-sm" placeholder="ملاحظة" value={newAbs.notes} onChange={e => setNewAbs(a => ({ ...a, notes: e.target.value }))} />
                  </div>
                  <button onClick={addAbs} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition">إضافة</button>
                </div>
              )}
              <div className="space-y-2">
                {absences.length === 0 ? <p className="text-center text-gray-400 text-sm py-8">لا سجلات غياب</p> :
                  absences.sort((a, b) => b.date.localeCompare(a.date)).map(a => (
                    <div key={a.id} className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${ABSENCE_COLORS[a.type]}`}>{ABSENCE_LABELS[a.type]}</span>
                      <span className="text-sm font-mono text-gray-700">{a.date}</span>
                      {a.notes && <span className="text-xs text-gray-400 flex-1 truncate">{a.notes}</span>}
                      {editing && <button onClick={() => setDraft(d => ({ ...d, absences: (d.absences || []).filter(x => x.id !== a.id) }))} className="text-red-400 hover:text-red-600 ml-auto"><Trash2 size={13}/></button>}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
        {editing && (
          <div className="border-t border-gray-100 px-5 py-3 flex gap-2">
            <button onClick={save} className="flex-1 py-2 bg-slate-700 text-white rounded-xl font-bold hover:bg-slate-800 transition flex items-center justify-center gap-2"><Save size={15}/> حفظ التغييرات</button>
            <button onClick={() => { setDraft({ ...member }); setEditing(false); }} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition">إلغاء</button>
          </div>
        )}
      </div>
    </div>
  );
}

const HrTab: React.FC<Props> = ({ notify }) => {
  const { staffMembers, orders, leads, updateStaffMember } = useSiteData() as any;
  const [subTab, setSubTab] = useState<'directory' | 'performance' | 'attendance' | 'leaves' | 'payroll'>('directory');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedMember, setSelectedMember] = useState<StaffMember | null>(null);
  const [perfMonth, setPerfMonth] = useState(new Date().toISOString().slice(0, 7));

  // ── Attendance state ────────────────────────────────────────
  const [attMonth, setAttMonth] = useState(new Date().toISOString().slice(0, 7));
  const [attSummary, setAttSummary] = useState<any[]>([]);
  const [loadingAtt, setLoadingAtt] = useState(false);
  const [attReport, setAttReport] = useState<{ workDays: number; staff: any[] } | null>(null);
  const [loadingAttReport, setLoadingAttReport] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualEntry, setManualEntry] = useState({ staff_id: '', date: new Date().toISOString().slice(0, 10), check_in: '', check_out: '', status: 'PRESENT', notes: '' });
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);

  // ── Leaves state ────────────────────────────────────────────
  const [leavesFilter, setLeavesFilter] = useState<'all' | 'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const [leaves, setLeaves] = useState<any[]>([]);
  const [loadingLeaves, setLoadingLeaves] = useState(false);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ staff_id: '', type: 'ANNUAL', start_date: '', end_date: '', reason: '' });

  // ── Server payroll state ─────────────────────────────────────
  const [payrollRuns, setPayrollRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [payrollItems, setPayrollItems] = useState<any[]>([]);
  const [loadingPayroll, setLoadingPayroll] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [payrollMonth, setPayrollMonth] = useState(new Date().toISOString().slice(0, 7));

  // ── Fetch functions ─────────────────────────────────────────
  const fetchAttendanceSummary = useCallback(async (month?: string) => {
    const m = month || attMonth;
    const [y, mo] = m.split('-');
    setLoadingAtt(true);
    try {
      const res = await fetch(`/api/admin/hr/attendance/summary?month=${parseInt(mo)}&year=${y}`, { credentials: 'include' });
      if (res.ok) setAttSummary(await res.json());
    } catch { /* silently fail */ } finally { setLoadingAtt(false); }
  }, [attMonth]);

  const fetchAttendanceReport = useCallback(async (month?: string) => {
    const m = month || attMonth;
    setLoadingAttReport(true);
    try {
      const res = await fetch(`/api/admin/hr/attendance-report?month=${m}`, { credentials: 'include' });
      if (res.ok) setAttReport(await res.json());
    } catch { /* silently fail */ } finally { setLoadingAttReport(false); }
  }, [attMonth]);

  const fetchLeaves = useCallback(async () => {
    setLoadingLeaves(true);
    try {
      const url = leavesFilter === 'all' ? '/api/admin/hr/leaves' : `/api/admin/hr/leaves?status=${leavesFilter}`;
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) setLeaves(await res.json());
    } catch { /* silently fail */ } finally { setLoadingLeaves(false); }
  }, [leavesFilter]);

  const fetchPayrollRuns = useCallback(async () => {
    setLoadingPayroll(true);
    try {
      const res = await fetch('/api/admin/hr/payroll', { credentials: 'include' });
      if (res.ok) setPayrollRuns(await res.json());
    } catch { /* silently fail */ } finally { setLoadingPayroll(false); }
  }, []);

  const fetchRunItems = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/admin/hr/payroll/${runId}`, { credentials: 'include' });
      if (res.ok) { const data = await res.json(); setPayrollItems(data.items || []); }
    } catch { /* silently fail */ }
  }, []);

  // ── Side effects ─────────────────────────────────────────────
  useEffect(() => { if (subTab === 'attendance') { fetchAttendanceSummary(); fetchAttendanceReport(); } }, [subTab, fetchAttendanceSummary, fetchAttendanceReport]);
  useEffect(() => { if (subTab === 'leaves') fetchLeaves(); }, [subTab, leavesFilter, fetchLeaves]);
  useEffect(() => { if (subTab === 'payroll') fetchPayrollRuns(); }, [subTab, fetchPayrollRuns]);

  // ── Actions ──────────────────────────────────────────────────
  const submitManualAttendance = useCallback(async () => {
    if (!manualEntry.staff_id || !manualEntry.date) return;
    try {
      const res = await fetch('/api/admin/hr/attendance', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manualEntry),
      });
      if (res.ok) {
        notify('success', 'تم تسجيل الحضور ✅');
        setShowManualEntry(false);
        setManualEntry({ staff_id: '', date: new Date().toISOString().slice(0, 10), check_in: '', check_out: '', status: 'PRESENT', notes: '' });
        fetchAttendanceSummary();
      } else { const d = await res.json(); notify('error', d.error || 'فشل التسجيل'); }
    } catch { notify('error', 'خطأ في الاتصال'); }
  }, [manualEntry, notify, fetchAttendanceSummary]);

  const submitCsvImport = useCallback(async () => {
    if (!csvText.trim()) return;
    try {
      const [y, mo] = attMonth.split('-');
      const res = await fetch('/api/admin/hr/attendance/import', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText, month: parseInt(mo), year: parseInt(y) }),
      });
      if (res.ok) {
        const data = await res.json();
        setImportResult(data);
        notify('success', `تم استيراد ${data.imported} سجل ✅`);
        fetchAttendanceSummary();
      } else { const d = await res.json(); notify('error', d.error || 'فشل الاستيراد'); }
    } catch { notify('error', 'خطأ في الاتصال'); }
  }, [csvText, attMonth, notify, fetchAttendanceSummary]);

  const updateLeaveStatus = useCallback(async (leaveId: string, status: 'APPROVED' | 'REJECTED') => {
    try {
      const res = await fetch(`/api/admin/hr/leaves/${leaveId}/status`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        notify('success', status === 'APPROVED' ? 'تمت الموافقة على الإجازة ✅' : 'تم رفض الإجازة');
        fetchLeaves();
      } else { const d = await res.json(); notify('error', d.error || 'فشل التحديث'); }
    } catch { notify('error', 'خطأ في الاتصال'); }
  }, [notify, fetchLeaves]);

  const submitLeaveRequest = useCallback(async () => {
    if (!leaveForm.staff_id || !leaveForm.start_date || !leaveForm.end_date) return;
    try {
      const res = await fetch('/api/admin/hr/leaves', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...leaveForm, leave_type: leaveForm.type }),
      });
      if (res.ok) {
        notify('success', 'تم إرسال طلب الإجازة ✅');
        setShowLeaveForm(false);
        setLeaveForm({ staff_id: '', type: 'ANNUAL', start_date: '', end_date: '', reason: '' });
        fetchLeaves();
      } else { const d = await res.json(); notify('error', d.error || 'فشل الإرسال'); }
    } catch { notify('error', 'خطأ في الاتصال'); }
  }, [leaveForm, notify, fetchLeaves]);

  const calculatePayroll = useCallback(async () => {
    setCalculating(true);
    try {
      const [y, mo] = payrollMonth.split('-');
      const res = await fetch('/api/admin/hr/payroll/calculate', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: parseInt(mo), year: parseInt(y) }),
      });
      if (res.ok) {
        const data = await res.json();
        notify('success', `تم احتساب كشف الرواتب ✅`);
        fetchPayrollRuns();
        setSelectedRun(data.run || data);
        setPayrollItems(data.items || []);
        if ((data.run || data).id) fetchRunItems((data.run || data).id);
      } else { const d = await res.json(); notify('error', d.error || 'فشل الاحتساب'); }
    } catch { notify('error', 'خطأ في الاتصال'); } finally { setCalculating(false); }
  }, [payrollMonth, notify, fetchPayrollRuns, fetchRunItems]);

  const updatePayrollRunStatus = useCallback(async (runId: string, status: string) => {
    try {
      const res = await fetch(`/api/admin/hr/payroll/${runId}/status`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        notify('success', `تم تحديث حالة الكشف إلى "${PAYROLL_STATUS_LABELS[status] || status}" ✅`);
        fetchPayrollRuns();
        if (selectedRun?.id === runId) setSelectedRun((r: any) => ({ ...r, status }));
      } else { const d = await res.json(); notify('error', d.error || 'فشل التحديث'); }
    } catch { notify('error', 'خطأ في الاتصال'); }
  }, [notify, fetchPayrollRuns, selectedRun]);

  const safeOrders = orders || [];
  const safeLeads = leads || [];
  const safeStaff: StaffMember[] = staffMembers || [];

  const filtered = useMemo(() => safeStaff.filter(s => {
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    if (roleFilter !== 'all' && s.role !== roleFilter) return false;
    if (search) { const q = search.toLowerCase(); return s.name.toLowerCase().includes(q) || (s.email || '').toLowerCase().includes(q) || (s.phone || '').includes(q); }
    return true;
  }), [safeStaff, search, roleFilter, statusFilter]);

  const stats = useMemo(() => {
    const active = safeStaff.filter(s => s.status === 'active');
    const byRole: Record<string, number> = {};
    active.forEach(s => { byRole[s.role] = (byRole[s.role] || 0) + 1; });
    return { total: safeStaff.length, active: active.length, inactive: safeStaff.length - active.length, byRole };
  }, [safeStaff]);

  const getPerfData = useCallback((month: string) => {
    const start = month + '-01';
    const end = new Date(new Date(start).getTime() + 32 * 86400000).toISOString().slice(0, 7) + '-01';
    return safeStaff.map(s => {
      const myOrders = safeOrders.filter((o: any) => o.staffId === s.id && o.status === 'paid' && (o.paidAt || o.createdAt) >= start && (o.paidAt || o.createdAt) < end);
      const revenue = myOrders.reduce((sum: number, o: any) => sum + (o.amount || 0), 0);
      const myLeads = safeLeads.filter((l: any) => l.assignedSalesId === s.id);
      const converted = myLeads.filter((l: any) => l.status === 'converted').length;
      const commission = revenue * (s.commissionRate || 0) / 100;
      const tType = s.monthlyTargetType || 'egp';
      const prog = tType === 'egp' ? revenue : converted;
      const targetHit = (s.monthlyTarget || 0) > 0 && prog >= (s.monthlyTarget || 0);
      const tPct = (s.monthlyTarget || 0) > 0 ? Math.min(100, Math.round(prog / s.monthlyTarget! * 100)) : 0;
      return { member: s, revenue, commission, converted, leadsCount: myLeads.length, convRate: myLeads.length > 0 ? Math.round(converted / myLeads.length * 100) : 0, targetPct: tPct, targetHit, bonus: targetHit ? (s.monthlyBonus || 0) : 0 };
    }).filter(x => x.revenue > 0 || x.leadsCount > 0 || x.member.salary).sort((a, b) => b.revenue - a.revenue);
  }, [safeStaff, safeOrders, safeLeads]);

  const perfData = useMemo(() => getPerfData(perfMonth), [getPerfData, perfMonth]);

  const handleSave = useCallback((updated: StaffMember) => {
    if (updateStaffMember) updateStaffMember(updated);
    notify('success', `تم حفظ بيانات ${updated.name} ✅`);
    setSelectedMember(updated);
  }, [updateStaffMember, notify]);

  const uniqueRoles = [...new Set(safeStaff.map(s => s.role))];

  return (
    <div className="space-y-5" dir="rtl">
      <div className="bg-gradient-to-l from-slate-700 to-gray-600 rounded-2xl p-5 text-white">
        <h2 className="text-xl font-bold flex items-center gap-2"><Briefcase size={22}/> إدارة الموارد البشرية</h2>
        <p className="text-slate-300 text-sm mt-0.5">ملفات الموظفين · الرواتب · التارجت · الغياب</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {[
            { label: 'إجمالي الموظفين', v: stats.total, bg: 'bg-white/15' },
            { label: 'نشطون', v: stats.active, bg: 'bg-emerald-500/20' },
            { label: 'غير نشطين', v: stats.inactive, bg: stats.inactive > 0 ? 'bg-red-500/20' : 'bg-white/10' },
            { label: 'أدوار مختلفة', v: Object.keys(stats.byRole).length, bg: 'bg-blue-400/20' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
              <div className="text-2xl font-black">{s.v}</div>
              <div className="text-xs text-slate-300 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          ['directory', 'دليل الموظفين'],
          ['performance', 'الأداء والتارجت'],
          ['attendance', 'الحضور والغياب'],
          ['leaves', 'الإجازات'],
          ['payroll', 'كشف الرواتب'],
        ] as const).map(([k, l]) => (
          <button key={k} onClick={() => setSubTab(k)} className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${subTab === k ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-gray-600 border-gray-200 hover:border-slate-400'}`}>{l}</button>
        ))}
      </div>

      {subTab === 'directory' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={14} className="absolute right-3 top-2.5 text-gray-400"/>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالاسم أو الإيميل..." className="w-full pr-8 pl-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"/>
            </div>
            <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm">
              <option value="all">كل الأدوار</option>
              {uniqueRoles.map(r => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm">
              <option value="all">كل الحالات</option>
              <option value="active">نشط</option>
              <option value="inactive">غير نشط</option>
            </select>
            <span className="text-sm text-gray-400 self-center">{filtered.length} موظف</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.length === 0 ? (
              <div className="col-span-3 text-center py-16 text-gray-400"><Users size={40} className="mx-auto mb-3 opacity-20"/><p>لا نتائج</p></div>
            ) : filtered.map(member => {
              const myRev = safeOrders.filter((o: any) => o.staffId === member.id && o.status === 'paid').reduce((s: number, o: any) => s + (o.amount || 0), 0);
              const myLeads = safeLeads.filter((l: any) => l.assignedSalesId === member.id).length;
              const myConverted = safeLeads.filter((l: any) => l.assignedSalesId === member.id && l.status === 'converted').length;
              const tType = member.monthlyTargetType || 'egp';
              const prog = tType === 'egp' ? myRev : myConverted;
              const tPct = (member.monthlyTarget || 0) > 0 ? Math.min(100, Math.round(prog / member.monthlyTarget! * 100)) : 0;
              return (
                <button key={member.id} onClick={() => setSelectedMember(member)} className="bg-white border border-gray-200 rounded-2xl p-4 text-right hover:shadow-md hover:border-slate-400 transition-all group">
                  <div className="flex items-start gap-3 mb-3">
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center text-white font-black text-base shrink-0 ${member.status === 'active' ? 'bg-slate-600' : 'bg-gray-400'}`}>{member.name.charAt(0)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-800 truncate group-hover:text-slate-700">{member.name}</p>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${ROLE_COLORS[member.role] || 'bg-gray-100 text-gray-600'}`}>{ROLE_LABELS[member.role] || member.role}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${member.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{member.status === 'active' ? '● نشط' : '● غير نشط'}</span>
                      </div>
                    </div>
                    <ChevronRight size={14} className="text-gray-300 group-hover:text-slate-500 transition-colors shrink-0 mt-1"/>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-gray-50 rounded-lg py-1.5"><div className="text-xs font-bold text-gray-700">{getMonthsOfService(member.joinedAt || new Date().toISOString())}</div><div className="text-[10px] text-gray-400">مدة الخدمة</div></div>
                    <div className="bg-gray-50 rounded-lg py-1.5"><div className="text-xs font-bold text-gray-700">{myLeads}</div><div className="text-[10px] text-gray-400">ليدات</div></div>
                    <div className="bg-gray-50 rounded-lg py-1.5"><div className={`text-xs font-bold ${myRev > 0 ? 'text-green-700' : 'text-gray-400'}`}>{myRev > 0 ? `${Math.round(myRev / 1000)}k` : '—'}</div><div className="text-[10px] text-gray-400">مبيعات</div></div>
                  </div>
                  {(member.monthlyTarget || 0) > 0 && (
                    <div className="mt-2">
                      <div className="flex justify-between text-[10px] text-gray-400 mb-0.5">
                        <span>التارجت</span>
                        <span>{tType === 'clients' ? `${member.monthlyTarget} عميل` : fmtMoney(member.monthlyTarget!)}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${tPct >= 100 ? 'bg-emerald-500' : 'bg-slate-500'}`} style={{ width: `${tPct}%` }}/></div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {subTab === 'performance' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-sm font-bold text-gray-700">شهر التقرير:</label>
            <input type="month" value={perfMonth} onChange={e => setPerfMonth(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm"/>
          </div>
          {perfData.length === 0 ? (
            <div className="text-center py-16 text-gray-400"><BarChart3 size={40} className="mx-auto mb-3 opacity-20"/><p className="text-sm">لا بيانات أداء لهذا الشهر</p></div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b border-gray-100 text-right text-xs font-bold text-gray-500">
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">الموظف</th>
                  <th className="px-4 py-3">المبيعات</th>
                  <th className="px-4 py-3">العمولة</th>
                  <th className="px-4 py-3">التارجت</th>
                  <th className="px-4 py-3">ليدات / تحويل</th>
                  <th className="px-4 py-3">مكافأة</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {perfData.map((p, i) => (
                    <tr key={p.member.id} className="hover:bg-gray-50 transition cursor-pointer" onClick={() => setSelectedMember(p.member)}>
                      <td className="px-4 py-3 text-center"><span className="text-sm font-bold text-gray-500">{i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i+1}`}</span></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 font-bold text-xs shrink-0">{p.member.name.charAt(0)}</div>
                          <div><p className="font-bold text-gray-800 text-xs">{p.member.name}</p><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${ROLE_COLORS[p.member.role] || 'bg-gray-100 text-gray-600'}`}>{ROLE_LABELS[p.member.role]}</span></div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-bold text-green-700 text-xs">{fmtMoney(p.revenue)}</td>
                      <td className="px-4 py-3 font-bold text-amber-700 text-xs">{fmtMoney(p.commission)}</td>
                      <td className="px-4 py-3">
                        {p.member.monthlyTarget ? (
                          <div>
                            <div className="flex items-center gap-1.5 mb-1">
                              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${p.targetHit ? 'bg-emerald-500' : 'bg-slate-400'}`} style={{ width: `${p.targetPct}%` }}/></div>
                              <span className={`text-[10px] font-bold ${p.targetHit ? 'text-emerald-700' : 'text-gray-500'}`}>{p.targetPct}%</span>
                            </div>
                            {p.targetHit && <span className="text-[10px] text-emerald-600 font-bold">✅ تحقق</span>}
                          </div>
                        ) : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">{p.leadsCount} / {p.converted} ({p.convRate}%)</td>
                      <td className="px-4 py-3 text-xs">{p.bonus > 0 ? <span className="text-emerald-700 font-bold">+{fmtMoney(p.bonus)}</span> : <span className="text-gray-300">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {subTab === 'attendance' && (
        <div className="space-y-4">
          {/* Controls */}
          <div className="flex flex-wrap gap-3 items-center">
            <label className="text-sm font-bold text-gray-700">الشهر:</label>
            <input type="month" value={attMonth} onChange={e => { setAttMonth(e.target.value); fetchAttendanceSummary(e.target.value); fetchAttendanceReport(e.target.value); }} className="border border-gray-200 rounded-xl px-3 py-2 text-sm"/>
            <button onClick={() => { fetchAttendanceSummary(); fetchAttendanceReport(); }} className="px-4 py-2 bg-slate-600 text-white rounded-xl text-sm font-bold hover:bg-slate-700 transition">تحديث</button>
            <button onClick={() => setShowManualEntry(true)} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition flex items-center gap-2"><Plus size={14}/> تسجيل يدوي</button>
            <button onClick={() => setShowCsvImport(true)} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition flex items-center gap-2"><Upload size={14}/> استيراد CSV</button>
          </div>

          {/* ── Attendance % Report card ── */}
          {(attReport || loadingAttReport) && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
                <h3 className="text-sm font-bold text-slate-700">📊 نسبة الحضور الشهري</h3>
                {attReport && <span className="text-xs text-slate-500">{attReport.workDays} يوم عمل فعلي (بدون جمعة وسبت)</span>}
              </div>
              {loadingAttReport ? (
                <div className="text-center py-6 text-gray-400 text-sm">جاري التحميل...</div>
              ) : attReport && attReport.staff.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 font-semibold text-right">
                        <th className="px-4 py-2">الموظف</th>
                        <th className="px-4 py-2 text-center">حاضر</th>
                        <th className="px-4 py-2 text-center">غياب</th>
                        <th className="px-4 py-2 text-center">إجازة</th>
                        <th className="px-4 py-2 text-center w-48">نسبة الحضور</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...attReport.staff].sort((a, b) => b.attendancePct - a.attendancePct).map((s: any) => {
                        const pct: number = s.attendancePct;
                        const barColor = pct >= 90 ? 'bg-emerald-500' : pct >= 75 ? 'bg-yellow-500' : 'bg-red-500';
                        const txtColor = pct >= 90 ? 'text-emerald-700' : pct >= 75 ? 'text-yellow-700' : 'text-red-700';
                        return (
                          <tr key={s.staffId} className="border-t border-gray-50 hover:bg-gray-50">
                            <td className="px-4 py-2 font-medium text-gray-800 text-xs">{s.name}</td>
                            <td className="px-4 py-2 text-center"><span className="bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5 text-xs font-bold">{s.presentDays}</span></td>
                            <td className="px-4 py-2 text-center"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${s.absenceDays > 0 ? 'bg-red-100 text-red-700' : 'text-gray-300'}`}>{s.absenceDays}</span></td>
                            <td className="px-4 py-2 text-center"><span className={`rounded-full px-2 py-0.5 text-xs ${s.leaveDays > 0 ? 'bg-blue-100 text-blue-700 font-bold' : 'text-gray-300'}`}>{s.leaveDays || '—'}</span></td>
                            <td className="px-4 py-2">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                                </div>
                                <span className={`text-xs font-bold w-9 text-left ${txtColor}`}>{pct}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-center py-6 text-gray-400 text-sm">لا بيانات</p>
              )}
            </div>
          )}

          {/* Summary table */}
          {loadingAtt ? (
            <div className="text-center py-12 text-gray-400">
              <div className="animate-spin w-8 h-8 border-2 border-slate-300 border-t-slate-600 rounded-full mx-auto mb-3"/>
              <p className="text-sm">جاري تحميل بيانات الحضور...</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-right text-xs font-bold text-gray-500">
                    <th className="px-4 py-3">الموظف</th>
                    <th className="px-4 py-3 text-center">حاضر</th>
                    <th className="px-4 py-3 text-center">غائب</th>
                    <th className="px-4 py-3 text-center">متأخر</th>
                    <th className="px-4 py-3 text-center">دقائق التأخير</th>
                    <th className="px-4 py-3 text-center">إجازة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {attSummary.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-12 text-gray-400">
                      <Clock size={32} className="mx-auto mb-2 opacity-20"/><p className="text-sm">لا بيانات حضور لهذا الشهر</p>
                    </td></tr>
                  ) : attSummary.map(row => (
                    <tr key={row.id} className="hover:bg-gray-50 transition">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 font-bold text-xs shrink-0">{row.name?.charAt(0)}</div>
                          <div>
                            <p className="font-bold text-xs text-gray-800">{row.name}</p>
                            <span className="text-[10px] text-gray-400">{row.department_name || '—'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center"><span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full text-xs font-bold">{row.present_days || 0}</span></td>
                      <td className="px-4 py-3 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-bold ${row.absent_days > 0 ? 'bg-red-100 text-red-700' : 'text-gray-300'}`}>{row.absent_days || 0}</span></td>
                      <td className="px-4 py-3 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-bold ${row.late_days > 0 ? 'bg-amber-100 text-amber-700' : 'text-gray-300'}`}>{row.late_days || 0}</span></td>
                      <td className="px-4 py-3 text-center text-xs text-gray-600">{row.total_late_minutes > 0 ? `${row.total_late_minutes} د` : '—'}</td>
                      <td className="px-4 py-3 text-center text-xs text-blue-600 font-semibold">{row.leave_days > 0 ? row.leave_days : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Manual entry modal */}
          {showManualEntry && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowManualEntry(false)}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" dir="rtl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-800 flex items-center gap-2"><Calendar size={16}/> تسجيل حضور يدوي</h3>
                  <button onClick={() => setShowManualEntry(false)} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
                </div>
                <div className="space-y-3">
                  <select value={manualEntry.staff_id} onChange={e => setManualEntry(m => ({ ...m, staff_id: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
                    <option value="">اختر موظف</option>
                    {safeStaff.filter(s => s.status === 'active').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <input type="date" value={manualEntry.date} onChange={e => setManualEntry(m => ({ ...m, date: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"/>
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className="text-xs text-gray-500 mb-1 block">وقت الحضور</label><input type="time" value={manualEntry.check_in} onChange={e => setManualEntry(m => ({ ...m, check_in: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"/></div>
                    <div><label className="text-xs text-gray-500 mb-1 block">وقت الانصراف</label><input type="time" value={manualEntry.check_out} onChange={e => setManualEntry(m => ({ ...m, check_out: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"/></div>
                  </div>
                  <select value={manualEntry.status} onChange={e => setManualEntry(m => ({ ...m, status: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
                    <option value="PRESENT">حاضر</option>
                    <option value="ABSENT">غائب</option>
                    <option value="LATE">متأخر</option>
                    <option value="LEAVE">إجازة</option>
                    <option value="HALF_DAY">نصف يوم</option>
                  </select>
                  <input placeholder="ملاحظة (اختياري)" value={manualEntry.notes} onChange={e => setManualEntry(m => ({ ...m, notes: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"/>
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={submitManualAttendance} disabled={!manualEntry.staff_id || !manualEntry.date} className="flex-1 py-2 bg-slate-700 text-white rounded-xl font-bold hover:bg-slate-800 transition disabled:opacity-50">حفظ</button>
                  <button onClick={() => setShowManualEntry(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition">إلغاء</button>
                </div>
              </div>
            </div>
          )}

          {/* CSV Import modal */}
          {showCsvImport && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowCsvImport(false)}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6" dir="rtl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-800 flex items-center gap-2"><Upload size={16}/> استيراد CSV من جهاز البصمة</h3>
                  <button onClick={() => { setShowCsvImport(false); setImportResult(null); setCsvText(''); }} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
                </div>
                <div className="space-y-3">
                  <div className="bg-blue-50 text-blue-700 text-xs rounded-xl p-3">
                    <p className="font-bold mb-1">تنسيق الأعمدة المطلوب:</p>
                    <code>employee_id أو name, date, check_in, check_out</code>
                  </div>
                  <input type="month" value={attMonth} onChange={e => setAttMonth(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"/>
                  <textarea value={csvText} onChange={e => setCsvText(e.target.value)} rows={8} placeholder="الصق محتوى CSV هنا..." className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono resize-none"/>
                  {importResult && (
                    <div className={`rounded-xl p-3 text-sm ${importResult.errors.length > 0 ? 'bg-amber-50 border border-amber-200 text-amber-700' : 'bg-emerald-50 border border-emerald-200 text-emerald-700'}`}>
                      <p className="font-bold">تم الاستيراد: {importResult.imported} سجل · تجاهل: {importResult.skipped}</p>
                      {importResult.errors.slice(0, 5).map((err, i) => <p key={i} className="text-xs mt-1 opacity-80">{err}</p>)}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={submitCsvImport} disabled={!csvText.trim()} className="flex-1 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition disabled:opacity-50 flex items-center justify-center gap-2"><Upload size={14}/> استيراد</button>
                  <button onClick={() => { setShowCsvImport(false); setImportResult(null); setCsvText(''); }} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition">إغلاق</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {subTab === 'leaves' && (
        <div className="space-y-4">
          {/* Filter bar */}
          <div className="flex flex-wrap gap-2 items-center">
            {(['PENDING', 'APPROVED', 'REJECTED', 'all'] as const).map(s => (
              <button key={s} onClick={() => setLeavesFilter(s)} className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${leavesFilter === s ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-gray-600 border-gray-200 hover:border-slate-400'}`}>
                {s === 'PENDING' ? '⏳ معلق' : s === 'APPROVED' ? '✅ موافق' : s === 'REJECTED' ? '❌ مرفوض' : '📋 الكل'}
              </button>
            ))}
            <button onClick={() => setShowLeaveForm(true)} className="mr-auto px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition flex items-center gap-2"><Plus size={14}/> طلب إجازة</button>
          </div>

          {loadingLeaves ? (
            <div className="text-center py-12 text-gray-400">
              <div className="animate-spin w-8 h-8 border-2 border-slate-300 border-t-slate-600 rounded-full mx-auto mb-3"/>
              <p className="text-sm">جاري تحميل طلبات الإجازات...</p>
            </div>
          ) : (
            <div className="space-y-2">
              {leaves.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <Calendar size={40} className="mx-auto mb-3 opacity-20"/>
                  <p className="text-sm">لا توجد إجازات{leavesFilter !== 'all' ? ` بحالة "${LEAVE_STATUS_LABELS[leavesFilter]}"` : ''}</p>
                </div>
              ) : leaves.map(leave => (
                <div key={leave.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <span className="font-bold text-sm text-gray-800">{leave.staff_name || 'موظف'}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${LEAVE_TYPE_COLORS[leave.leave_type] || 'bg-gray-100 text-gray-600'}`}>{LEAVE_TYPE_LABELS[leave.leave_type] || leave.leave_type}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${LEAVE_STATUS_COLORS[leave.status] || ''}`}>{LEAVE_STATUS_LABELS[leave.status] || leave.status}</span>
                    </div>
                    <p className="text-xs text-gray-500">{leave.start_date?.slice(0, 10)} — {leave.end_date?.slice(0, 10)} · <strong>{leave.total_days}</strong> {leave.total_days === 1 ? 'يوم' : 'أيام'}</p>
                    {leave.reason && <p className="text-xs text-gray-400 mt-0.5 truncate">{leave.reason}</p>}
                    {leave.approved_by_name && <p className="text-[10px] text-gray-400 mt-0.5">بواسطة: {leave.approved_by_name}</p>}
                  </div>
                  {leave.status === 'PENDING' && (
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => updateLeaveStatus(leave.id, 'APPROVED')} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition flex items-center gap-1"><CheckCircle size={12}/> موافقة</button>
                      <button onClick={() => updateLeaveStatus(leave.id, 'REJECTED')} className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-xs font-bold hover:bg-red-200 transition flex items-center gap-1"><XCircle size={12}/> رفض</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Leave request form modal */}
          {showLeaveForm && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowLeaveForm(false)}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" dir="rtl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-800 flex items-center gap-2"><Calendar size={16}/> طلب إجازة جديدة</h3>
                  <button onClick={() => setShowLeaveForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
                </div>
                <div className="space-y-3">
                  <select value={leaveForm.staff_id} onChange={e => setLeaveForm(f => ({ ...f, staff_id: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
                    <option value="">اختر موظف</option>
                    {safeStaff.filter(s => s.status === 'active').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <select value={leaveForm.type} onChange={e => setLeaveForm(f => ({ ...f, type: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
                    {Object.entries(LEAVE_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className="text-xs text-gray-500 mb-1 block">من تاريخ</label><input type="date" value={leaveForm.start_date} onChange={e => setLeaveForm(f => ({ ...f, start_date: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"/></div>
                    <div><label className="text-xs text-gray-500 mb-1 block">إلى تاريخ</label><input type="date" value={leaveForm.end_date} onChange={e => setLeaveForm(f => ({ ...f, end_date: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"/></div>
                  </div>
                  <textarea placeholder="سبب الإجازة" value={leaveForm.reason} onChange={e => setLeaveForm(f => ({ ...f, reason: e.target.value }))} rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none"/>
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={submitLeaveRequest} disabled={!leaveForm.staff_id || !leaveForm.start_date || !leaveForm.end_date} className="flex-1 py-2 bg-slate-700 text-white rounded-xl font-bold hover:bg-slate-800 transition disabled:opacity-50">إرسال الطلب</button>
                  <button onClick={() => setShowLeaveForm(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition">إلغاء</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {subTab === 'payroll' && (
        <div className="space-y-4">
          {/* Server payroll section */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5">
            <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Wallet size={16}/> كشوف الرواتب الرسمية</h3>
            <div className="flex flex-wrap gap-3 items-end mb-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">شهر الاحتساب</label>
                <input type="month" value={payrollMonth} onChange={e => setPayrollMonth(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm"/>
              </div>
              <button onClick={calculatePayroll} disabled={calculating} className="px-5 py-2 bg-slate-700 text-white rounded-xl font-bold hover:bg-slate-800 transition disabled:opacity-50 flex items-center gap-2">
                {calculating ? <span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full"/> : <Award size={15}/>}
                {calculating ? 'جاري الاحتساب...' : 'احتساب كشف الرواتب'}
              </button>
              <button onClick={fetchPayrollRuns} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-bold hover:bg-gray-200 transition">تحديث</button>
            </div>

            {loadingPayroll ? (
              <div className="text-center py-8 text-gray-400">
                <div className="animate-spin w-8 h-8 border-2 border-slate-300 border-t-slate-600 rounded-full mx-auto mb-3"/>
                <p className="text-sm">جاري تحميل الكشوف...</p>
              </div>
            ) : payrollRuns.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <Wallet size={36} className="mx-auto mb-2 opacity-20"/>
                <p className="text-sm">لا توجد كشوف رواتب محتسبة بعد</p>
                <p className="text-xs mt-1">اختر الشهر واضغط "احتساب كشف الرواتب" لبدء العملية</p>
              </div>
            ) : (
              <div className="space-y-2">
                {payrollRuns.map(run => (
                  <div key={run.id} className={`border rounded-xl p-4 cursor-pointer transition ${selectedRun?.id === run.id ? 'border-slate-500 bg-slate-50' : 'border-gray-200 bg-white hover:border-slate-300'}`}
                    onClick={() => { setSelectedRun(run); fetchRunItems(run.id); }}>
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-sm text-gray-800">{run.month}/{run.year}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${PAYROLL_STATUS_COLORS[run.status] || 'bg-gray-100'}`}>{PAYROLL_STATUS_LABELS[run.status] || run.status}</span>
                          <span className="text-xs text-gray-400">{run.employee_count} موظف</span>
                        </div>
                        <div className="flex gap-4 text-xs text-gray-600">
                          <span>الإجمالي: <strong className="text-gray-800">{fmtMoney(run.total_amount || run.total_gross || 0)}</strong></span>
                          <span>الصافي: <strong className="text-emerald-700">{fmtMoney(run.total_amount || run.total_net || 0)}</strong></span>
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        {run.status === 'CALCULATED' && (
                          <button onClick={e => { e.stopPropagation(); updatePayrollRunStatus(run.id, 'APPROVED'); }} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition">اعتماد</button>
                        )}
                        {run.status === 'APPROVED' && (
                          <button onClick={e => { e.stopPropagation(); updatePayrollRunStatus(run.id, 'PAID'); }} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition">تأكيد الصرف</button>
                        )}
                        {(run.status === 'CALCULATED' || run.status === 'APPROVED') && (
                          <button onClick={e => { e.stopPropagation(); updatePayrollRunStatus(run.id, 'CANCELLED'); }} className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs font-bold hover:bg-red-100 hover:text-red-700 transition">إلغاء</button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Run items breakdown */}
            {selectedRun && payrollItems.length > 0 && (
              <div className="mt-4">
                <h4 className="font-bold text-sm text-gray-700 mb-3 flex items-center gap-2">
                  <BarChart3 size={14}/> تفاصيل كشف {selectedRun.month}/{selectedRun.year}
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100 text-right text-[11px] font-bold text-gray-500">
                        <th className="px-3 py-2">الموظف</th>
                        <th className="px-3 py-2">الراتب الأساسي</th>
                        <th className="px-3 py-2">البدلات</th>
                        <th className="px-3 py-2">العمولة</th>
                        <th className="px-3 py-2">مكافآت</th>
                        <th className="px-3 py-2">استقطاعات</th>
                        <th className="px-3 py-2 font-black text-slate-700">صافي الراتب</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {payrollItems.map(item => {
                        const allowances = (item.total_allowances || item.allowances_total || 0);
                        const deductions = (item.absence_deductions || item.absence_deduction || 0) +
                          (item.late_deductions || item.late_deduction || 0) +
                          (item.other_deductions || item.other_deduction || 0) +
                          (item.advance_deductions || item.advance_deduction || 0);
                        const bonuses = (item.commission || 0) + (item.instructor_earnings || 0) + (item.bonus_amount || 0);
                        return (
                          <tr key={item.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-bold text-gray-800">{item.staff_name || item.name || '—'}</td>
                            <td className="px-3 py-2">{fmtMoney(item.base_salary || 0)}</td>
                            <td className="px-3 py-2 text-blue-600">{allowances > 0 ? fmtMoney(allowances) : '—'}</td>
                            <td className="px-3 py-2 text-amber-600">{item.commission > 0 ? fmtMoney(item.commission) : '—'}</td>
                            <td className="px-3 py-2 text-emerald-600">{bonuses - (item.commission || 0) > 0 ? fmtMoney(bonuses - (item.commission || 0)) : '—'}</td>
                            <td className="px-3 py-2 text-red-600">{deductions > 0 ? `-${fmtMoney(deductions)}` : '—'}</td>
                            <td className="px-3 py-2 font-black text-slate-700">{fmtMoney(item.net_salary || 0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 border-t-2 border-slate-200">
                        <td colSpan={6} className="px-3 py-2 font-black text-slate-700">الإجمالي</td>
                        <td className="px-3 py-2 font-black text-slate-700">{fmtMoney(payrollItems.reduce((s, i) => s + (i.net_salary || 0), 0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Quick estimate (local) */}
          <details className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <summary className="px-5 py-3 cursor-pointer font-bold text-sm text-gray-600 flex items-center gap-2 select-none hover:bg-gray-50">
              <BarChart3 size={14}/> تقدير سريع (من بيانات النظام المحلية)
            </summary>
            <div className="px-0 overflow-x-auto">
              <div className="px-4 py-2 border-t border-gray-100">
                <div className="flex items-center gap-3 mb-3">
                  <label className="text-xs text-gray-500">شهر التقدير:</label>
                  <input type="month" value={perfMonth} onChange={e => setPerfMonth(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-1.5 text-xs"/>
                </div>
              </div>
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b border-gray-100 text-right text-xs font-bold text-gray-500">
                  <th className="px-4 py-2">الموظف</th>
                  <th className="px-4 py-2">الراتب الأساسي</th>
                  <th className="px-4 py-2">العمولة</th>
                  <th className="px-4 py-2">المكافأة</th>
                  <th className="px-4 py-2">الإجمالي</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {safeStaff.filter(s => s.status === 'active').map(s => {
                    const start = perfMonth + '-01';
                    const end = new Date(new Date(start).getTime() + 32 * 86400000).toISOString().slice(0, 7) + '-01';
                    const rev = safeOrders.filter((o: any) => o.staffId === s.id && o.status === 'paid' && (o.paidAt || o.createdAt) >= start && (o.paidAt || o.createdAt) < end).reduce((sm: number, o: any) => sm + (o.amount || 0), 0);
                    const comm = rev * (s.commissionRate || 0) / 100;
                    const conv = safeLeads.filter((l: any) => l.assignedSalesId === s.id && l.status === 'converted').length;
                    const prog = (s.monthlyTargetType || 'egp') === 'egp' ? rev : conv;
                    const bon = (s.monthlyTarget || 0) > 0 && prog >= (s.monthlyTarget || 0) ? (s.monthlyBonus || 0) : 0;
                    return (
                      <tr key={s.id} className="hover:bg-gray-50 cursor-pointer text-xs" onClick={() => setSelectedMember(s)}>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 font-bold text-[10px] shrink-0">{s.name.charAt(0)}</div>
                            <span className="font-bold text-gray-800">{s.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2">{s.salary ? fmtMoney(s.salary) : <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-2 text-amber-700 font-bold">{comm > 0 ? fmtMoney(comm) : <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-2 text-emerald-700 font-bold">{bon > 0 ? fmtMoney(bon) : <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-2 font-black text-slate-700">{(s.salary || 0) + comm + bon > 0 ? fmtMoney((s.salary || 0) + comm + bon) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}

      {selectedMember && (
        <EmployeeProfileModal
          member={selectedMember}
          orders={safeOrders}
          leads={safeLeads}
          onClose={() => setSelectedMember(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
};

export default HrTab;
