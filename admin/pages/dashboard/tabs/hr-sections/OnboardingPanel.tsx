import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Loader2, Plus, Trash2 } from 'lucide-react';
import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;
type Template = { id: string; name: string; role?: string; description?: string; task_count: number };
type Task = { id: string; title: string; category: string; due_days: number; sort_order: number };
type Employee = {
  id: string; name: string; role: string; onboarding_id?: string;
  onboarding_status?: string; total_items?: number; done_items?: number; template_name?: string;
};
type Item = { id: string; task_title: string; category: string; due_date?: string; completed_at?: string; notes?: string };

async function request<T>(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: options.body ? adminAuthHeaders(true) : adminAuthHeaders(),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'تعذر تنفيذ الإجراء');
  return data as T;
}

export default function OnboardingPanel({ notify }: { notify: Notify }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [onboardingId, setOnboardingId] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [templateRows, employeeRows] = await Promise.all([
        request<Template[]>('/api/admin/hr/onboarding/templates'),
        request<Employee[]>('/api/admin/hr/onboarding/employees'),
      ]);
      setTemplates(templateRows); setEmployees(employeeRows);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحميل التهيئة الوظيفية');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  const selectTemplate = async (id: string) => {
    setTemplateId(id);
    setTasks(id ? await request<Task[]>(`/api/admin/hr/onboarding/templates/${id}/tasks`) : []);
  };
  const openItems = async (id: string) => {
    setOnboardingId(id);
    setItems(await request<Item[]>(`/api/admin/hr/onboarding/${id}/items`));
  };
  const createTemplate = async () => {
    const name = window.prompt('اسم قالب التهيئة الوظيفية:')?.trim();
    if (!name) return;
    try {
      const created = await request<Template>('/api/admin/hr/onboarding/templates', { method: 'POST', body: JSON.stringify({ name }) });
      notify('success', 'تم إنشاء القالب'); await load(); await selectTemplate(created.id);
    } catch (error) { notify('error', error instanceof Error ? error.message : 'فشل إنشاء القالب'); }
  };
  const addTask = async () => {
    if (!templateId) return;
    const title = window.prompt('مهمة التهيئة الجديدة:')?.trim();
    if (!title) return;
    try {
      await request(`/api/admin/hr/onboarding/templates/${templateId}/tasks`, {
        method: 'POST', body: JSON.stringify({ title, due_days: 7, category: 'other', sort_order: tasks.length }),
      });
      notify('success', 'تمت إضافة المهمة'); await selectTemplate(templateId); await load();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'فشل إضافة المهمة'); }
  };
  const deleteTask = async (id: string) => {
    if (!window.confirm('حذف المهمة من القالب؟')) return;
    try {
      await request(`/api/admin/hr/onboarding/tasks/${id}`, { method: 'DELETE' });
      await selectTemplate(templateId); await load();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'فشل الحذف'); }
  };
  const start = async () => {
    if (!staffId || !templateId) return;
    try {
      const result = await request<{ id: string }>('/api/admin/hr/onboarding/start', {
        method: 'POST', body: JSON.stringify({ staff_id: staffId, template_id: templateId }),
      });
      notify('success', 'بدأت التهيئة الوظيفية وربطت المهام بالموظف'); await load(); await openItems(result.id);
    } catch (error) { notify('error', error instanceof Error ? error.message : 'فشل بدء التهيئة'); }
  };
  const toggle = async (item: Item) => {
    try {
      await request(`/api/admin/hr/onboarding/items/${item.id}`, {
        method: 'PUT', body: JSON.stringify({ done: !item.completed_at }),
      });
      await openItems(onboardingId); await load();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'فشل تحديث المهمة'); }
  };

  if (loading) return <section className="rounded-2xl border bg-white p-8"><Loader2 className="mx-auto animate-spin text-gray-400" /></section>;
  const selectedTemplate = templates.find(template => template.id === templateId);

  return (
    <section className="space-y-4 rounded-2xl border border-gray-100 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="flex items-center gap-2 text-sm font-bold text-slate-700"><ClipboardCheck size={16} /> التهيئة الوظيفية</h3><p className="text-xs text-gray-400">قالب مهام ثابت، تنفيذ قابل للتتبع، وسجل لا يُحذف بعد الاستخدام.</p></div>
        <button onClick={() => void createTemplate()} className="flex items-center gap-1 rounded-lg bg-slate-700 px-3 py-2 text-xs font-bold text-white"><Plus size={13} /> قالب جديد</button>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2 rounded-xl bg-gray-50 p-3">
          <div className="flex gap-2">
            <select value={templateId} onChange={event => void selectTemplate(event.target.value)} className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm">
              <option value="">اختر قالبًا لإدارة مهامه</option>
              {templates.map(template => <option key={template.id} value={template.id}>{template.name} ({template.task_count})</option>)}
            </select>
            <button disabled={!templateId} onClick={() => void addTask()} className="rounded-lg bg-indigo-600 px-3 text-white disabled:opacity-40"><Plus size={15} /></button>
          </div>
          {selectedTemplate && tasks.length === 0 && <p className="py-4 text-center text-xs text-amber-600">أضف مهمة واحدة على الأقل قبل استخدام القالب.</p>}
          {tasks.map(task => <div key={task.id} className="flex items-center gap-2 rounded-lg border bg-white p-2 text-xs"><span className="flex-1">{task.title}</span><span className="text-gray-400">{task.due_days} أيام</span><button onClick={() => void deleteTask(task.id)} className="text-red-500"><Trash2 size={13} /></button></div>)}
        </div>
        <div className="space-y-2 rounded-xl bg-gray-50 p-3">
          <select value={staffId} onChange={event => setStaffId(event.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm">
            <option value="">اختر موظفًا نشطًا بدون تهيئة جارية</option>
            {employees.filter(employee => employee.onboarding_status !== 'in_progress').map(employee => <option key={employee.id} value={employee.id}>{employee.name} — {employee.role}</option>)}
          </select>
          <button disabled={!staffId || !templateId || tasks.length === 0} onClick={() => void start()} className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-bold text-white disabled:opacity-40">بدء التهيئة وربط المهام</button>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {employees.filter(employee => employee.onboarding_id).map(employee => (
              <button key={employee.id} onClick={() => void openItems(employee.onboarding_id!)} className="flex w-full items-center gap-2 rounded-lg border bg-white p-2 text-right text-xs">
                <span className="flex-1 font-bold">{employee.name}<small className="mr-2 font-normal text-gray-400">{employee.template_name}</small></span>
                <span>{Number(employee.done_items || 0)}/{Number(employee.total_items || 0)}</span>
                {employee.onboarding_status === 'completed' && <CheckCircle2 size={14} className="text-emerald-600" />}
              </button>
            ))}
          </div>
        </div>
      </div>
      {onboardingId && <div className="space-y-2 border-t pt-3">
        {items.map(item => <button key={item.id} onClick={() => void toggle(item)} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-right text-sm ${item.completed_at ? 'border-emerald-200 bg-emerald-50' : 'bg-white'}`}><CheckCircle2 size={17} className={item.completed_at ? 'text-emerald-600' : 'text-gray-300'} /><span className="flex-1">{item.task_title}</span><span className="text-xs text-gray-400">{item.due_date?.slice(0, 10) || ''}</span></button>)}
      </div>}
    </section>
  );
}
