import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  CheckSquare, Plus, X, Trash2, 
  User, Calendar, Check,
} from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type Priority = 'low' | 'medium' | 'high' | 'urgent';
type Column = 'todo' | 'inprogress' | 'review' | 'done';

interface Task {
  id: string;
  title: string;
  description?: string;
  column: Column;
  priority: Priority;
  assigneeId?: string;
  dueDate?: string;
  tags?: string[];
  createdAt: string;
  completedAt?: string;
}

const PRIORITY_CONFIG: Record<Priority, { label: string; color: string; bg: string; icon: string }> = {
  low:    { label: 'منخفضة', color: 'text-gray-500', bg: 'bg-gray-100', icon: '🔵' },
  medium: { label: 'متوسطة', color: 'text-yellow-600', bg: 'bg-yellow-50', icon: '🟡' },
  high:   { label: 'عالية',  color: 'text-orange-600', bg: 'bg-orange-50', icon: '🟠' },
  urgent: { label: 'عاجلة',  color: 'text-red-600', bg: 'bg-red-50', icon: '🔴' },
};

const COLUMNS: { key: Column; label: string; color: string; dotColor: string }[] = [
  { key: 'todo',       label: 'للتنفيذ',     color: 'border-gray-300',   dotColor: 'bg-gray-400' },
  { key: 'inprogress', label: 'جارٍ التنفيذ', color: 'border-blue-400',  dotColor: 'bg-blue-500' },
  { key: 'review',     label: 'قيد المراجعة', color: 'border-amber-400', dotColor: 'bg-amber-500' },
  { key: 'done',       label: 'مكتمل',        color: 'border-green-400', dotColor: 'bg-green-500' },
];

const TODAY = new Date().toISOString().slice(0, 10);

interface Props { notify: NotifyFn; }

const TasksBoardTab: React.FC<Props> = ({ notify }) => {
  const { staffMembers } = useSiteData();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoadDone = useRef(false);
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [addingColumn, setAddingColumn] = useState<Column | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [filterPriority, setFilterPriority] = useState<Priority | 'all'>('all');
  const [filterAssignee, setFilterAssignee] = useState<string>('all');
  const [draft, setDraft] = useState<Partial<Task>>({});

  useEffect(() => {
    mysqlAdmin.adminGet<{ ok: boolean; data: Task[] | null }>('/admin/kv/tasks_board')
      .then(res => {
        if (res.data) setTasks(res.data);
      })
      .catch(() => {})
      .finally(() => { setLoading(false); initialLoadDone.current = true; });
  }, []);

  // Debounced save to API whenever tasks change (skip first render)
  useEffect(() => {
    if (!initialLoadDone.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      mysqlAdmin.adminPut('/admin/kv/tasks_board', tasks).catch(() => {});
    }, 800);
  }, [tasks]);

  const teamMembers = staffMembers.filter(s => s.status === 'active');

  const addTask = useCallback(() => {
    if (!draft.title?.trim()) { notify('error', 'اكتب عنوان المهمة'); return; }
    const task: Task = {
      id: Date.now().toString(),
      title: draft.title.trim(),
      description: draft.description,
      column: addingColumn!,
      priority: draft.priority || 'medium',
      assigneeId: draft.assigneeId,
      dueDate: draft.dueDate,
      tags: draft.tags,
      createdAt: new Date().toISOString(),
    };
    setTasks(prev => [task, ...prev]);
    setDraft({});
    setAddingColumn(null);
    notify('success', 'تمت إضافة المهمة');
  }, [draft, addingColumn, notify]);


  const deleteTask = useCallback((id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
    notify('success', 'تم حذف المهمة');
  }, [notify]);

  const moveTask = useCallback((id: string, col: Column) => {
    const updates: Partial<Task> = { column: col };
    if (col === 'done') updates.completedAt = new Date().toISOString();
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, []);

  const filtered = tasks.filter(t => {
    if (filterPriority !== 'all' && t.priority !== filterPriority) return false;
    if (filterAssignee !== 'all' && t.assigneeId !== filterAssignee) return false;
    return true;
  });

  const stats = {
    total: tasks.length,
    done: tasks.filter(t => t.column === 'done').length,
    inprogress: tasks.filter(t => t.column === 'inprogress').length,
    overdue: tasks.filter(t => t.dueDate && t.dueDate < TODAY && t.column !== 'done').length,
    urgent: tasks.filter(t => t.priority === 'urgent' && t.column !== 'done').length,
  };

  return (
    <div className="space-y-5" dir="rtl">
      {loading && (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mr-3" />
          جاري تحميل المهام...
        </div>
      )}
      {!loading && (<>
      <div className="bg-gradient-to-l from-violet-700 to-indigo-600 rounded-2xl p-5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><CheckSquare size={22} /> لوحة المهام</h2>
            <p className="text-indigo-200 text-sm mt-0.5">تتبع وإدارة مهام الفريق بنظام Kanban</p>
          </div>
          <div className="flex gap-2">
            {(['kanban','list'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${view === v ? 'bg-white text-indigo-700' : 'bg-white/15 text-white hover:bg-white/25'}`}>
                {v === 'kanban' ? '📋 كانبان' : '📄 قائمة'}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4">
          {[
            { label: 'إجمالي المهام', value: stats.total, bg: 'bg-white/15' },
            { label: 'جارٍ التنفيذ', value: stats.inprogress, bg: 'bg-blue-500/30' },
            { label: 'مكتملة', value: stats.done, bg: 'bg-green-500/30' },
            { label: 'متأخرة', value: stats.overdue, bg: stats.overdue > 0 ? 'bg-red-500/30' : 'bg-white/10' },
            { label: 'عاجلة', value: stats.urgent, bg: stats.urgent > 0 ? 'bg-orange-500/30' : 'bg-white/10' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
              <div className="text-2xl font-black">{s.value}</div>
              <div className="text-xs text-indigo-200 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value as Priority | 'all')}
          className="border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
          <option value="all">كل الأولويات</option>
          {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>
        <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}
          className="border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
          <option value="all">كل الموظفين</option>
          {teamMembers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {(filterPriority !== 'all' || filterAssignee !== 'all') && (
          <button onClick={() => { setFilterPriority('all'); setFilterAssignee('all'); }}
            className="text-xs text-rose-500 hover:text-rose-700 flex items-center gap-1">
            <X size={12} /> مسح التصفية
          </button>
        )}
        <span className="text-xs text-gray-400 mr-auto">{filtered.length} مهمة</span>
      </div>

      {/* Kanban View */}
      {view === 'kanban' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {COLUMNS.map(col => {
            const colTasks = filtered.filter(t => t.column === col.key);
            return (
              <div key={col.key} className={`bg-gray-50 rounded-2xl border-t-4 ${col.color} p-3 space-y-3 min-h-[200px]`}>
                {/* Column header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${col.dotColor}`} />
                    <span className="font-bold text-gray-700 text-sm">{col.label}</span>
                    <span className="text-xs bg-gray-200 text-gray-600 rounded-full px-1.5 py-0.5">{colTasks.length}</span>
                  </div>
                  <button onClick={() => { setAddingColumn(col.key); setDraft({ priority: 'medium' }); }}
                    className="w-6 h-6 rounded-lg bg-gray-200 hover:bg-gray-300 flex items-center justify-center text-gray-600 transition-colors">
                    <Plus size={13} />
                  </button>
                </div>

                {/* Add form */}
                {addingColumn === col.key && (
                  <div className="bg-white rounded-xl p-3 border border-indigo-200 shadow-sm space-y-2">
                    <input
                      autoFocus
                      value={draft.title || ''}
                      onChange={e => setDraft(p => ({ ...p, title: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') addTask(); if (e.key === 'Escape') { setAddingColumn(null); setDraft({}); } }}
                      placeholder="عنوان المهمة..."
                      className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    <textarea
                      value={draft.description || ''}
                      onChange={e => setDraft(p => ({ ...p, description: e.target.value }))}
                      placeholder="وصف (اختياري)..."
                      rows={2}
                      className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <select value={draft.priority || 'medium'} onChange={e => setDraft(p => ({ ...p, priority: e.target.value as Priority }))}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none">
                        {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                      </select>
                      <select value={draft.assigneeId || ''} onChange={e => setDraft(p => ({ ...p, assigneeId: e.target.value || undefined }))}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none">
                        <option value="">— مسؤول —</option>
                        {teamMembers.map(s => <option key={s.id} value={s.id}>{s.name.split(' ')[0]}</option>)}
                      </select>
                    </div>
                    <input type="date" value={draft.dueDate || ''} onChange={e => setDraft(p => ({ ...p, dueDate: e.target.value }))}
                      className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none" />
                    <div className="flex gap-2">
                      <button onClick={addTask} className="flex-1 bg-indigo-600 text-white text-xs py-1.5 rounded-lg hover:bg-indigo-700 font-medium">إضافة</button>
                      <button onClick={() => { setAddingColumn(null); setDraft({}); }} className="flex-1 bg-gray-100 text-gray-600 text-xs py-1.5 rounded-lg hover:bg-gray-200">إلغاء</button>
                    </div>
                  </div>
                )}

                {/* Tasks */}
                {colTasks.length === 0 && addingColumn !== col.key && (
                  <p className="text-center text-gray-400 text-xs py-8">لا مهام هنا</p>
                )}
                {colTasks.map(task => {
                  const assignee = teamMembers.find(s => s.id === task.assigneeId);
                  const isOverdue = task.dueDate && task.dueDate < TODAY && task.column !== 'done';
                  const p = PRIORITY_CONFIG[task.priority];
                  return (
                    <div key={task.id} className={`bg-white rounded-xl border p-3 shadow-sm space-y-2 ${isOverdue ? 'border-red-200' : 'border-gray-100'}`}>
                      <div className="flex items-start gap-2">
                        <button onClick={() => moveTask(task.id, task.column === 'done' ? 'inprogress' : 'done')}
                          className={`mt-0.5 shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${task.column === 'done' ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 hover:border-green-400'}`}>
                          {task.column === 'done' && <Check size={10} />}
                        </button>
                        <p className={`text-sm font-medium flex-1 ${task.column === 'done' ? 'line-through text-gray-400' : 'text-gray-800'}`}>{task.title}</p>
                        <button onClick={() => deleteTask(task.id)} className="text-gray-300 hover:text-red-400 shrink-0">
                          <X size={13} />
                        </button>
                      </div>
                      {task.description && <p className="text-xs text-gray-500 pr-6">{task.description}</p>}
                      <div className="flex flex-wrap items-center gap-1.5 pr-6">
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${p.bg} ${p.color}`}>{p.icon} {p.label}</span>
                        {assignee && (
                          <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                            <User size={9} /> {assignee.name.split(' ')[0]}
                          </span>
                        )}
                        {task.dueDate && (
                          <span className={`text-xs px-1.5 py-0.5 rounded-full flex items-center gap-0.5 ${isOverdue ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-500'}`}>
                            <Calendar size={9} /> {task.dueDate}
                          </span>
                        )}
                      </div>
                      {/* Move buttons */}
                      <div className="flex gap-1 pr-6">
                        {COLUMNS.filter(c => c.key !== col.key).map(c => (
                          <button key={c.key} onClick={() => moveTask(task.id, c.key)}
                            className="text-xs text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 px-1.5 py-0.5 rounded transition-colors">
                            → {c.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* List View */}
      {view === 'list' && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-bold text-gray-800">جميع المهام</h3>
            <button onClick={() => { setAddingColumn('todo'); setDraft({ priority: 'medium' }); setView('kanban'); }}
              className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800">
              <Plus size={14} /> مهمة جديدة
            </button>
          </div>
          <div className="divide-y divide-gray-50">
            {filtered.length === 0 ? (
              <div className="py-16 text-center text-gray-400">
                <CheckSquare size={40} className="mx-auto mb-3 opacity-30" />
                <p>لا مهام بعد</p>
              </div>
            ) : filtered.map(task => {
              const assignee = teamMembers.find(s => s.id === task.assigneeId);
              const col = COLUMNS.find(c => c.key === task.column)!;
              const p = PRIORITY_CONFIG[task.priority];
              const isOverdue = task.dueDate && task.dueDate < TODAY && task.column !== 'done';
              return (
                <div key={task.id} className={`px-4 py-3 flex items-center gap-3 hover:bg-gray-50 ${isOverdue ? 'bg-red-50/50' : ''}`}>
                  <button onClick={() => moveTask(task.id, task.column === 'done' ? 'todo' : 'done')}
                    className={`shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center ${task.column === 'done' ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 hover:border-green-400'}`}>
                    {task.column === 'done' && <Check size={11} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${task.column === 'done' ? 'line-through text-gray-400' : 'text-gray-800'}`}>{task.title}</p>
                    {task.description && <p className="text-xs text-gray-400 truncate">{task.description}</p>}
                  </div>
                  <div className="flex items-center gap-2 text-xs shrink-0">
                    <span className={`px-2 py-0.5 rounded-full ${p.bg} ${p.color}`}>{p.icon} {p.label}</span>
                    <span className={`px-2 py-0.5 rounded-full font-medium ${col.dotColor.replace('bg-', 'bg-').replace('-500', '-100')} text-gray-600`}>{col.label}</span>
                    {assignee && <span className="text-gray-400">{assignee.name.split(' ')[0]}</span>}
                    {task.dueDate && <span className={isOverdue ? 'text-red-500 font-bold' : 'text-gray-400'}>{task.dueDate}</span>}
                    <button onClick={() => deleteTask(task.id)} className="text-gray-300 hover:text-red-400 mr-1"><Trash2 size={13} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </>)}
    </div>
  );
};

export default TasksBoardTab;
