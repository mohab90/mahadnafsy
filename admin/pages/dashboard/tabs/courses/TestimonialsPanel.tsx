// Client testimonials: the list, and the add/edit form beside it.
//
// Lifted out of CoursesTab.tsx with its own state — three drafts and two
// handlers that no other section read. The list and its writers come from
// useSiteData here rather than being threaded down, so only notify is a prop.
//
// The saving flag is its own. CoursesTab has one catalogSaving shared by the
// courses, lectures and bundles sections, which meant a save in one of them
// disabled the button in another.

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useSiteData } from '../../../../context/SiteDataContext';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

export default function TestimonialsPanel({ notify }: { notify: NotifyFn }) {
  const { testimonials, addTestimonial, updateTestimonial, deleteTestimonial } = useSiteData();
  const [saving, setSaving] = useState(false);
  const [editingTestimonialId, setEditingTestimonialId] = useState<number | null>(null);
  const [isTestimonialFormOpen, setIsTestimonialFormOpen] = useState(false);
  const [testimonialDraft, setTestimonialDraft] = useState({ id: 0, name: '', role: '', text: '', image: '' });

  const startEditTestimonial = (row: { id: number; name: string; role: string; text: string; image: string }) => {
  setEditingTestimonialId(row.id);
  setIsTestimonialFormOpen(true);
  setTestimonialDraft({ ...row });
};

  const saveTestimonial = async () => {
  if (!testimonialDraft.name || !testimonialDraft.text) return;
  const payload = {
    ...testimonialDraft,
    id: testimonialDraft.id || Date.now(),
    image: testimonialDraft.image || '',
  };
  setSaving(true);
  const saved = editingTestimonialId ? await updateTestimonial(payload) : await addTestimonial(payload);
  setSaving(false);
  if (!saved) { notify('error', 'تعذر حفظ رأي العميل.'); return; }
  setEditingTestimonialId(null);
  setIsTestimonialFormOpen(false);
  setTestimonialDraft({ id: 0, name: '', role: '', text: '', image: '' });
};

  return (
  <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <h3 className="font-bold text-gray-900">إدارة آراء العملاء</h3>
      <button
        onClick={() => {
          if (isTestimonialFormOpen && !editingTestimonialId) {
            setIsTestimonialFormOpen(false);
            return;
          }
          setEditingTestimonialId(null);
          setTestimonialDraft({ id: 0, name: '', role: '', text: '', image: '' });
          setIsTestimonialFormOpen(true);
        }}
        className="bg-primary-600 hover:bg-primary-700 text-white rounded-xl px-4 py-2.5 font-bold text-sm"
      >
        <Plus size={16} className="inline ml-1" />
        {isTestimonialFormOpen ? 'إغلاق نموذج الرأي' : 'إضافة رأي'}
      </button>
    </div>

    {isTestimonialFormOpen && (
      <div className="border border-gray-200 rounded-2xl p-4 mb-4 bg-gray-50/70 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="الاسم" value={testimonialDraft.name} onChange={(e) => setTestimonialDraft({ ...testimonialDraft, name: e.target.value })} />
          <input className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="الصفة" value={testimonialDraft.role} onChange={(e) => setTestimonialDraft({ ...testimonialDraft, role: e.target.value })} />
          <input className="md:col-span-2 border border-gray-300 rounded-xl px-4 py-2.5" placeholder="رابط الصورة" value={testimonialDraft.image} onChange={(e) => setTestimonialDraft({ ...testimonialDraft, image: e.target.value })} />
          <textarea className="md:col-span-2 border border-gray-300 rounded-xl px-4 py-2.5" rows={3} placeholder="نص الرأي" value={testimonialDraft.text} onChange={(e) => setTestimonialDraft({ ...testimonialDraft, text: e.target.value })} />
        </div>
        <button onClick={() => void saveTestimonial()} disabled={saving} className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-bold px-5 py-2.5 rounded-xl transition">{editingTestimonialId ? 'تحديث الرأي' : 'إضافة رأي'}</button>
      </div>
    )}
    <div className="mt-5 border-t pt-4 space-y-2 max-h-80 overflow-auto">
      {testimonials.map((row) => (
        <div key={row.id} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl p-3">
          <div><p className="font-bold text-gray-800">{row.name}</p><p className="text-xs text-gray-500">{row.role}</p></div>
          <div className="flex gap-2"><button onClick={() => startEditTestimonial(row)} className="px-3 py-1.5 rounded-lg bg-primary-50 text-primary-700 text-sm">تعديل</button><button onClick={() => { void deleteTestimonial(row.id).then(ok => notify(ok ? 'success' : 'error', ok ? 'تم حذف الرأي.' : 'تعذر حذف الرأي.')); }} className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-sm">حذف</button></div>
        </div>
      ))}
    </div>
  </article>
  );
}
