import { useEffect, useState, useCallback } from 'react';
import { UserMinus, Plus, X, Check, RefreshCw } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

type ChecklistItem = { task: string; done: boolean };
type Offboarding = {
  id: string; staff_id: string; staff_name: string | null; reason: string;
  last_working_day: string | null; status: 'in_progress' | 'completed' | 'cancelled';
  checklist: ChecklistItem[]; notes: string | null; created_at: string; completed_at: string | null;
  staff_email?: string | null; staff_role?: string | null;
};
type StaffLite = { id: string; name: string; email?: string; role?: string; is_active?: number };

const REASON_LABEL: Record<string, string> = {
  resignation: 'استقالة', termination: 'إنهاء من الإدارة', end_contract: 'انتهاء عقد', other: 'أخرى',
};
const STATUS_LABEL: Record<string, string> = { in_progress: 'قيد التنفيذ', completed: 'مكتمل', cancelled: 'ملغي' };
const STATUS_COLOR: Record<string, string> = {
  in_progress: 'bg-amber-100 text-amber-700', completed: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-gray-100 text-gray-500',
};

export default function OffboardingTab({ notify }: { notify: NotifyFn }) {
  const [list, setList] = useState<Offboarding[]>([]);
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ staff_id: '', reason: 'resignation', last_working_day: '', notes: '' });
  const [successorByCase, setSuccessorByCase] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    mysqlAdmin.adminGet<Offboarding[]>('/admin/hr/offboarding')
      .then(rows => setList(Array.isArray(rows) ? rows : []))
      .catch(() => notify('error', 'تعذر تحميل بيانات إنهاء الخدمة'))
      .finally(() => setLoading(false));
  }, [notify]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    mysqlAdmin.adminGet<StaffLite[]>('/admin/hr/employees')
      .then(rows => setStaff(Array.isArray(rows) ? rows.filter(s => s.is_active !== 0) : []))
      .catch(() => {});
  }, []);

  const startOffboarding = async () => {
    if (!form.staff_id) { notify('error', 'اختر الموظف'); return; }
    try {
      await mysqlAdmin.adminPost('/admin/hr/offboarding', form);
      setShowForm(false);
      setForm({ staff_id: '', reason: 'resignation', last_working_day: '', notes: '' });
      load();
      notify('success', 'تم بدء إجراء إنهاء الخدمة');
    } catch { notify('error', 'تعذر بدء الإجراء (قد يكون هناك إجراء جارٍ بالفعل)'); }
  };

  const patch = async (o: Offboarding, body: Record<string, unknown>) => {
    try { await mysqlAdmin.adminPut(`/admin/hr/offboarding/${o.id}`, body); load(); }
    catch { notify('error', 'تعذر التحديث'); }
  };

  const toggleItem = (o: Offboarding, idx: number) => {
    const checklist = o.checklist.map((it, i) => i === idx ? { ...it, done: !it.done } : it);
    patch(o, { checklist });
  };

  const complete = (o: Offboarding) => {
    if (!window.confirm('إتمام إنهاء الخدمة سيوقف حساب الموظف ويلغي صلاحياته. متابعة؟')) return;
    patch(o, { status: 'completed', reassign_to: successorByCase[o.id] || null });
    notify('info', 'سيتم إيقاف حساب الموظف عند الاكتمال');
  };

  if (loading && list.length === 0) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>;
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2"><UserMinus size={18} className="text-gray-500" />إنهاء خدمة الموظفين</h2>
          <p className="text-xs text-gray-500">إدارة إجراءات الخروج — قائمة مهام + إيقاف الحساب عند الاكتمال</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50" title="تحديث"><RefreshCw size={15} /></button>
          <button onClick={() => setShowForm(true)} className="flex items-center gap-1.5 bg-gray-800 text-white px-4 py-2 rounded-xl text-sm hover:bg-gray-900">
            <Plus size={15} /> بدء إنهاء خدمة
          </button>
        </div>
      </div>

      {list.length === 0 && <p className="text-center text-gray-400 text-sm py-10">لا توجد إجراءات إنهاء خدمة</p>}

      <div className="space-y-3">
        {list.map(o => {
          const doneCount = o.checklist.filter(i => i.done).length;
          return (
            <div key={o.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <span className="font-bold text-gray-900">{o.staff_name || o.staff_id}</span>
                  <span className="text-xs text-gray-400 mr-2">{o.staff_role || ''}</span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full mr-2 ${STATUS_COLOR[o.status]}`}>{STATUS_LABEL[o.status]}</span>
                </div>
                <div className="text-xs text-gray-500">
                  {REASON_LABEL[o.reason] || o.reason}
                  {o.last_working_day && <span className="mr-2">· آخر يوم: {String(o.last_working_day).slice(0, 10)}</span>}
                </div>
              </div>

              <div className="grid gap-1.5 mb-2">
                {o.checklist.map((it, idx) => (
                  <button key={idx} disabled={o.status !== 'in_progress'} onClick={() => toggleItem(o, idx)}
                    className={`flex items-center gap-2 text-right text-sm px-2 py-1 rounded-lg transition ${o.status === 'in_progress' ? 'hover:bg-gray-50' : ''}`}>
                    <span className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${it.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300'}`}>
                      {it.done && <Check size={12} />}
                    </span>
                    <span className={it.done ? 'text-gray-400 line-through' : 'text-gray-700'}>{it.task}</span>
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-gray-50">
                <span className="text-xs text-gray-400">{doneCount}/{o.checklist.length} مكتمل</span>
                {o.status === 'in_progress' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={successorByCase[o.id] || ''}
                      onChange={event => setSuccessorByCase(current => ({ ...current, [o.id]: event.target.value }))}
                      className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white"
                      title="الموظف البديل الذي ستُنقل إليه الأعمال المفتوحة"
                    >
                      <option value="">الموظف البديل عند وجود أعمال</option>
                      {staff.filter(member => member.id !== o.staff_id).map(member => (
                        <option key={member.id} value={member.id}>
                          {member.name}{member.role ? ` (${member.role})` : ''}
                        </option>
                      ))}
                    </select>
                    <button onClick={() => patch(o, { status: 'cancelled' })} className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1 rounded-lg border border-gray-200">إلغاء</button>
                    <button onClick={() => complete(o)} disabled={doneCount < o.checklist.length}
                      className="text-xs bg-emerald-600 text-white px-3 py-1 rounded-lg hover:bg-emerald-700 disabled:opacity-40" title={doneCount < o.checklist.length ? 'أكمل كل المهام أولاً' : ''}>
                      إتمام وإيقاف الحساب
                    </button>
                  </div>
                )}
                {o.completed_at && <span className="text-xs text-emerald-600">اكتمل: {String(o.completed_at).slice(0, 10)}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" dir="rtl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">بدء إنهاء خدمة</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">الموظف</label>
                <select value={form.staff_id} onChange={e => setForm(f => ({ ...f, staff_id: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                  <option value="">— اختر —</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.name}{s.role ? ` (${s.role})` : ''}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">السبب</label>
                <select value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                  {Object.entries(REASON_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">آخر يوم عمل</label>
                <input type="date" value={form.last_working_day} onChange={e => setForm(f => ({ ...f, last_working_day: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">ملاحظات (اختياري)</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none" />
              </div>
              <button onClick={startOffboarding} className="w-full bg-gray-800 text-white py-2 rounded-xl text-sm hover:bg-gray-900">بدء الإجراء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
