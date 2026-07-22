import React, { useEffect, useState, useCallback } from 'react';
import { BookOpen, Plus, X, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

type Faq = {
  id: string; question: string; answer: string; category: string;
  sort_order: number; is_published: number; created_at: string;
};
type Draft = { id?: string; question: string; answer: string; category: string; sort_order: number; is_published: boolean };
const BLANK: Draft = { question: '', answer: '', category: 'عام', sort_order: 0, is_published: true };

export default function FaqManagerTab({ notify }: { notify: NotifyFn }) {
  const [list, setList] = useState<Faq[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(BLANK);

  const load = useCallback(() => {
    setLoading(true);
    mysqlAdmin.adminGet<Faq[]>('/admin/faq')
      .then(rows => setList(Array.isArray(rows) ? rows : []))
      .catch(() => notify('error', 'تعذر تحميل الأسئلة'))
      .finally(() => setLoading(false));
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!draft.question.trim() || !draft.answer.trim()) { notify('error', 'السؤال والإجابة مطلوبان'); return; }
    const body = { question: draft.question, answer: draft.answer, category: draft.category, sort_order: draft.sort_order, is_published: draft.is_published };
    try {
      if (draft.id) await mysqlAdmin.adminPut(`/admin/faq/${draft.id}`, body);
      else await mysqlAdmin.adminPost('/admin/faq', body);
      setFormOpen(false); setDraft(BLANK); load();
      notify('success', 'تم الحفظ');
    } catch { notify('error', 'تعذر الحفظ'); }
  };
  const remove = async (id: string) => {
    if (!window.confirm('حذف هذا السؤال؟')) return;
    try { await mysqlAdmin.adminDelete(`/admin/faq/${id}`); load(); } catch { notify('error', 'تعذر الحذف'); }
  };
  const togglePublish = async (f: Faq) => {
    try { await mysqlAdmin.adminPut(`/admin/faq/${f.id}`, { question: f.question, answer: f.answer, category: f.category, sort_order: f.sort_order, is_published: !f.is_published }); load(); }
    catch { notify('error', 'تعذر التحديث'); }
  };

  const byCat = list.reduce<Record<string, Faq[]>>((acc, f) => { (acc[f.category] ||= []).push(f); return acc; }, {});

  if (loading && list.length === 0) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-rose-500" /></div>;
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2"><BookOpen size={18} className="text-rose-500" />قاعدة المعرفة (الأسئلة الشائعة)</h2>
          <p className="text-xs text-gray-500">أسئلة وأجوبة تظهر للعملاء على صفحة <span className="font-mono">/faq</span> — تقلّل تذاكر الدعم</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50" title="تحديث"><RefreshCw size={15} /></button>
          <button onClick={() => { setDraft(BLANK); setFormOpen(true); }} className="flex items-center gap-1.5 bg-rose-500 text-white px-4 py-2 rounded-xl text-sm hover:bg-rose-600"><Plus size={15} /> سؤال جديد</button>
        </div>
      </div>

      {list.length === 0 && <p className="text-center text-gray-400 text-sm py-10">لا توجد أسئلة بعد — أضف أول سؤال</p>}

      {Object.entries(byCat).map(([cat, items]) => (
        <div key={cat} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
          <h3 className="font-bold text-gray-700 text-sm mb-2">{cat}</h3>
          <div className="space-y-1.5">
            {items.map(f => (
              <div key={f.id} className={`flex items-start gap-2 border rounded-lg px-3 py-2 ${f.is_published ? 'border-gray-100' : 'border-gray-100 bg-gray-50 opacity-70'}`}>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-gray-800">{f.question}</div>
                  <div className="text-xs text-gray-500 line-clamp-2">{f.answer}</div>
                </div>
                <button onClick={() => togglePublish(f)} title={f.is_published ? 'منشور — إخفاء' : 'مخفي — نشر'}
                  className={`flex-shrink-0 ${f.is_published ? 'text-emerald-500' : 'text-gray-400'} hover:opacity-70`}>
                  {f.is_published ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
                <button onClick={() => { setDraft({ id: f.id, question: f.question, answer: f.answer, category: f.category, sort_order: f.sort_order, is_published: !!f.is_published }); setFormOpen(true); }}
                  className="text-xs text-blue-600 hover:text-blue-700 flex-shrink-0">تعديل</button>
                <button onClick={() => remove(f.id)} className="text-xs text-red-500 hover:text-red-600 flex-shrink-0">حذف</button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {formOpen && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setFormOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[88vh] flex flex-col" dir="rtl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">{draft.id ? 'تعديل سؤال' : 'سؤال جديد'}</h3>
              <button onClick={() => setFormOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <input value={draft.question} onChange={e => setDraft(d => ({ ...d, question: e.target.value }))}
                placeholder="السؤال" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
              <textarea value={draft.answer} onChange={e => setDraft(d => ({ ...d, answer: e.target.value }))}
                placeholder="الإجابة" rows={5} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none" />
              <div className="flex gap-2">
                <input value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}
                  placeholder="التصنيف" className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
                <input type="number" value={draft.sort_order} onChange={e => setDraft(d => ({ ...d, sort_order: Number(e.target.value) }))}
                  placeholder="الترتيب" className="w-24 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" title="ترتيب العرض" />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={draft.is_published} onChange={e => setDraft(d => ({ ...d, is_published: e.target.checked }))} />
                منشور (ظاهر للعملاء)
              </label>
              <button onClick={save} className="w-full bg-rose-500 text-white py-2 rounded-xl text-sm hover:bg-rose-600">{draft.id ? 'حفظ التعديل' : 'إضافة'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
