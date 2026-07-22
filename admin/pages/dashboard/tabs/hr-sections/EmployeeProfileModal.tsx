import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Target, Edit3, Save, X, Plus, Trash2, Wallet, ExternalLink } from 'lucide-react';
import type { StaffMember, StaffRole, StaffAbsence } from '../../../../types';
import { ROLE_LABELS, ABSENCE_LABELS, ABSENCE_COLORS, getMonthsOfService, fmtMoney } from './shared';

export default function EmployeeProfileModal({ member, orders, leads, onClose, onSave }: {
  member: StaffMember; orders: any[]; leads: any[]; onClose: () => void; onSave: (u: StaffMember) => void;
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<StaffMember>({ ...member });
  const [subTab, setSubTab] = useState<'info' | 'performance' | 'salary' | 'absences'>('info');
  const [editing, setEditing] = useState(false);
  const [newAbs, setNewAbs] = useState<{ open: boolean; type: StaffAbsence['type']; date: string; notes: string }>({ open: false, type: 'absence', date: new Date().toISOString().slice(0, 10), notes: '' });
  const [perfMonth, setPerfMonth] = useState(new Date().toISOString().slice(0, 7));
  // Customer-service performance for this employee (from the HR KPI endpoint).
  const [csKpi, setCsKpi] = useState<{ tickets_assigned: number; tickets_resolved: number; avg_first_response_min: number | null; sla_compliance: number | null } | null>(null);
  useEffect(() => {
    if (subTab !== 'performance' || !member.id) return;
    const [y, mo] = perfMonth.split('-');
    fetch(`/api/admin/hr/kpi/${member.id}?month=${parseInt(mo)}&year=${y}`, { credentials: 'include' })
      .then(r => r.json()).then(d => setCsKpi(d?.cs || null)).catch(() => setCsKpi(null));
  }, [subTab, perfMonth, member.id]);

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
              <button onClick={() => navigate(`/staff/${member.id}`)} title="فتح صفحة الموظف الكاملة"
                className="flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition"><ExternalLink size={13}/> الملف الكامل</button>
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
              {/* Customer-service performance (CS ↔ HR interconnection) */}
              {csKpi && (csKpi.tickets_assigned > 0 || csKpi.tickets_resolved > 0) && (
                <div>
                  <h4 className="text-xs font-bold text-gray-500 mb-2">🎧 أداء خدمة العملاء</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { l: 'تذاكر مُسندة', v: String(csKpi.tickets_assigned), c: 'text-rose-600' },
                      { l: 'تم حلّها', v: String(csKpi.tickets_resolved), c: 'text-emerald-600' },
                      { l: 'متوسط أول رد', v: csKpi.avg_first_response_min != null ? `${csKpi.avg_first_response_min}د` : '—', c: 'text-violet-600' },
                      { l: 'التزام SLA', v: csKpi.sla_compliance != null ? `${csKpi.sla_compliance}%` : '—', c: 'text-sky-600' },
                    ].map(s => (
                      <div key={s.l} className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                        <div className={`text-xl font-black ${s.c}`}>{s.v}</div>
                        <div className="text-xs text-gray-400 mt-0.5">{s.l}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
