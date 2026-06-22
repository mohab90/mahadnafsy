import React from 'react';
import { Plus } from 'lucide-react';
import type { TestimonialItem } from '../../../types';

export type TestimonialDraft = { id: number; name: string; role: string; text: string; image: string };

interface Props {
  testimonials: TestimonialItem[];
  draft: TestimonialDraft;
  setDraft: React.Dispatch<React.SetStateAction<TestimonialDraft>>;
  isFormOpen: boolean;
  setIsFormOpen: React.Dispatch<React.SetStateAction<boolean>>;
  editingId: number | null;
  setEditingId: React.Dispatch<React.SetStateAction<number | null>>;
  onSave: () => void;
  onStartEdit: (row: TestimonialDraft) => void;
  onDelete: (id: number) => void;
}

/** آراء العملاء manager — extracted from CoursesTab. */
export default function TestimonialsManager({
  testimonials, draft, setDraft, isFormOpen, setIsFormOpen, editingId, setEditingId,
  onSave, onStartEdit, onDelete,
}: Props) {
  return (
    <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="font-bold text-gray-900">إدارة آراء العملاء</h3>
        <button
          onClick={() => {
            if (isFormOpen && !editingId) { setIsFormOpen(false); return; }
            setEditingId(null);
            setDraft({ id: 0, name: '', role: '', text: '', image: '' });
            setIsFormOpen(true);
          }}
          className="bg-primary-600 hover:bg-primary-700 text-white rounded-xl px-4 py-2.5 font-bold text-sm"
        >
          <Plus size={16} className="inline ml-1" />
          {isFormOpen ? 'إغلاق نموذج الرأي' : 'إضافة رأي'}
        </button>
      </div>

      {isFormOpen && (
        <div className="border border-gray-200 rounded-2xl p-4 mb-4 bg-gray-50/70 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="الاسم" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <input className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="الصفة" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
            <input className="md:col-span-2 border border-gray-300 rounded-xl px-4 py-2.5" placeholder="رابط الصورة" value={draft.image} onChange={(e) => setDraft({ ...draft, image: e.target.value })} />
            <textarea className="md:col-span-2 border border-gray-300 rounded-xl px-4 py-2.5" rows={3} placeholder="نص الرأي" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
          </div>
          <button onClick={onSave} className="bg-primary-600 hover:bg-primary-700 text-white font-bold px-5 py-2.5 rounded-xl transition">{editingId ? 'تحديث الرأي' : 'إضافة رأي'}</button>
        </div>
      )}
      <div className="mt-5 border-t pt-4 space-y-2 max-h-80 overflow-auto">
        {testimonials.map((row) => (
          <div key={row.id} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl p-3">
            <div><p className="font-bold text-gray-800">{row.name}</p><p className="text-xs text-gray-500">{row.role}</p></div>
            <div className="flex gap-2"><button onClick={() => onStartEdit(row as TestimonialDraft)} className="px-3 py-1.5 rounded-lg bg-primary-50 text-primary-700 text-sm">تعديل</button><button onClick={() => onDelete(row.id)} className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-sm">حذف</button></div>
          </div>
        ))}
      </div>
    </article>
  );
}
