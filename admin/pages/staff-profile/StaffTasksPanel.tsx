import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ListChecks, Plus, RefreshCw, Check, X } from 'lucide-react';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Task = {
  id: string;
  title: string;
  description: string | null;
  assigned_to: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'todo' | 'in_progress' | 'done' | 'cancelled';
  due_date: string | null;
  created_at: string;
};

const PRIORITY: Record<Task['priority'], { label: string; cls: string }> = {
  urgent: { label: 'عاجلة', cls: 'bg-red-100 text-red-700' },
  high: { label: 'مرتفعة', cls: 'bg-amber-100 text-amber-700' },
  medium: { label: 'متوسطة', cls: 'bg-blue-100 text-blue-700' },
  low: { label: 'منخفضة', cls: 'bg-gray-100 text-gray-600' },
};
const STATUS: Record<Task['status'], { label: string; cls: string }> = {
  todo: { label: 'لم تبدأ', cls: 'bg-gray-100 text-gray-600' },
  in_progress: { label: 'جارية', cls: 'bg-indigo-100 text-indigo-700' },
  done: { label: 'منجزة', cls: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: 'ملغاة', cls: 'bg-gray-100 text-gray-400' },
};

/**
 * Tasks assigned to this employee. Reuses the existing tasks API (which returns
 * the tenant's tasks for a manager) and filters to this employee client-side —
 * GET /api/admin/tasks has no per-assignee filter, and adding one would change
 * a shared endpoint the tasks board also relies on.
 */
export default function StaffTasksPanel({
  staffId, staffName, notify,
}: {
  staffId: string;
  staffName: string;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ title: '', description: '', priority: 'medium' as Task['priority'], due_date: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await mysqlAdmin.adminGet<Task[]>('/admin/tasks');
      setTasks((Array.isArray(rows) ? rows : []).filter(row => String(row.assigned_to || '') === String(staffId)));
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحميل المهام');
    } finally {
      setLoading(false);
    }
  }, [staffId, notify]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => ({
    open: tasks.filter(t => t.status === 'todo' || t.status === 'in_progress').length,
    done: tasks.filter(t => t.status === 'done').length,
    overdue: tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled' && t.due_date && t.due_date.slice(0, 10) < new Date().toISOString().slice(0, 10)).length,
  }), [tasks]);

  const addTask = async () => {
    if (!draft.title.trim()) { notify('error', 'عنوان المهمة مطلوب'); return; }
    setBusyId('new');
    try {
      await mysqlAdmin.adminPost('/admin/tasks', {
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        assigned_to: staffId,
        assigned_name: staffName,
        priority: draft.priority,
        status: 'todo',
        due_date: draft.due_date || null,
      });
      setDraft({ title: '', description: '', priority: 'medium', due_date: '' });
      setShowAdd(false);
      await load();
      notify('success', 'تم إسناد المهمة');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر إضافة المهمة');
    } finally { setBusyId(null); }
  };

  const setStatus = async (task: Task, status: Task['status']) => {
    setBusyId(task.id);
    try {
      await mysqlAdmin.adminPut(`/admin/tasks/${task.id}`, {
        title: task.title,
        description: task.description,
        assigned_to: task.assigned_to,
        assigned_name: staffName,
        priority: task.priority,
        status,
        due_date: task.due_date,
      });
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحديث المهمة');
    } finally { setBusyId(null); }
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-bold text-gray-800">
          <ListChecks size={17} className="text-indigo-600" /> المهام
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700">{counts.open} مفتوحة</span>
          {counts.overdue > 0 && (
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-600">{counts.overdue} متأخرة</span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} disabled={loading}
            className="flex items-center gap-1.5 rounded-xl bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-200 disabled:opacity-50">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
          <button onClick={() => setShowAdd(v => !v)}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700">
            <Plus size={13} /> إسناد مهمة
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="mb-4 space-y-2 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
          <input value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
            placeholder="عنوان المهمة *" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <textarea value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
            rows={2} placeholder="تفاصيل (اختياري)" className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <select value={draft.priority} onChange={e => setDraft(d => ({ ...d, priority: e.target.value as Task['priority'] }))}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
              {(Object.keys(PRIORITY) as Task['priority'][]).map(k => <option key={k} value={k}>{PRIORITY[k].label}</option>)}
            </select>
            <input type="date" value={draft.due_date} onChange={e => setDraft(d => ({ ...d, due_date: e.target.value }))}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          </div>
          <button onClick={() => void addTask()} disabled={busyId === 'new'}
            className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
            {busyId === 'new' ? 'جارٍ الإسناد...' : 'إسناد'}
          </button>
        </div>
      )}

      {tasks.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-400">
          {loading ? 'جاري التحميل...' : 'لا توجد مهام مسندة لهذا الموظف.'}
        </p>
      ) : (
        <div className="space-y-2">
          {tasks.map(task => {
            const overdue = task.status !== 'done' && task.status !== 'cancelled'
              && task.due_date && task.due_date.slice(0, 10) < new Date().toISOString().slice(0, 10);
            return (
              <div key={task.id} className={`rounded-xl border p-3 ${overdue ? 'border-red-200 bg-red-50/40' : 'border-gray-100'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-bold ${task.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{task.title}</p>
                    {task.description && <p className="mt-0.5 text-xs text-gray-500">{task.description}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${PRIORITY[task.priority].cls}`}>{PRIORITY[task.priority].label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS[task.status].cls}`}>{STATUS[task.status].label}</span>
                      {task.due_date && (
                        <span className={`text-[10px] font-bold ${overdue ? 'text-red-600' : 'text-gray-400'}`}>
                          موعد: {task.due_date.slice(0, 10)}{overdue ? ' (متأخرة)' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {task.status !== 'done' && (
                      <button onClick={() => void setStatus(task, 'done')} disabled={busyId === task.id}
                        title="تم الإنجاز"
                        className="rounded-lg bg-emerald-50 p-1.5 text-emerald-600 hover:bg-emerald-100 disabled:opacity-40">
                        <Check size={14} />
                      </button>
                    )}
                    {task.status === 'todo' && (
                      <button onClick={() => void setStatus(task, 'in_progress')} disabled={busyId === task.id}
                        title="بدء التنفيذ"
                        className="rounded-lg bg-indigo-50 px-2 py-1.5 text-[10px] font-bold text-indigo-600 hover:bg-indigo-100 disabled:opacity-40">
                        بدء
                      </button>
                    )}
                    {task.status !== 'cancelled' && task.status !== 'done' && (
                      <button onClick={() => void setStatus(task, 'cancelled')} disabled={busyId === task.id}
                        title="إلغاء"
                        className="rounded-lg bg-gray-50 p-1.5 text-gray-400 hover:bg-gray-100 disabled:opacity-40">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
