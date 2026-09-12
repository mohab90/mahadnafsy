// The new-lead form: contact, source, interest and the duplicate check.
//
// Moved out of LeadSubcomponents.tsx, which had grown to 1,277 lines across
// seventeen unrelated exports. It still re-exports this, so the ten files that
// import from it are untouched.

import { useState } from 'react';
import { Modal } from '../../../../../shared/ui/Modal';
import { Plus, Tag, UserPlus, X } from 'lucide-react';
import type { LeadItem, LeadStatus, CommunicationRecord, Course, Bundle } from '../../../../types';
import { EMPTY_LEAD_DRAFT } from '../crmConstants';
import { courseBadgeLabel, isRawCourse } from './leadCourseLabel';
import {
  BRANCH_ENUM_LABELS,
  IL_LABEL,
  STATUS_CFG,
} from '../leadUtils';
import { TagInput } from './LeadInputs';


export function AddLeadModal({ courses, bundles, salesReps, leads, sources, branches, onClose, onSave }: {
  courses: Course[];
  bundles: Bundle[];
  salesReps: { id: string; name: string }[];
  leads: LeadItem[];
  sources: string[];
  branches: { id: string; label: string }[];
  onClose: () => void;
  onSave: (draft: typeof EMPTY_LEAD_DRAFT & { interestedCourseIds: string[] }) => Promise<void>;
}) {
  // Escape closes, and focus starts on the first field instead of behind the
  // overlay on <body>.
  const [draft, setDraft] = useState({ ...EMPTY_LEAD_DRAFT });
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [dupInfo, setDupInfo] = useState<{ name: string; status: LeadStatus } | null>(null);

  const set = (k: keyof typeof EMPTY_LEAD_DRAFT, v: string) =>
    setDraft(d => ({ ...d, [k]: v }));

  const toggleCourse = (id: string) =>
    setSelectedCourses(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );

  const handleSubmit = async (overrideDup = false) => {
    if (!draft.name.trim()) return setErr('الاسم مطلوب');
    if (!draft.phone.trim()) return setErr('رقم الهاتف مطلوب');
    if (!draft.branch) return setErr('الفرع مطلوب — اختر الفرع أولاً');
    if (!overrideDup) {
      const normalise = (p?: string | null) => (p || '').replace(/\D/g, '');
      const draftPhone = normalise(draft.phone);
      const dup = leads.find(l => !l.hidden && draftPhone.length >= 7 && normalise(l.phone) === draftPhone);
      if (dup) { setDupInfo({ name: dup.name, status: dup.status }); return; }
    }
    setDupInfo(null);
    setSaving(true);
    setErr('');
    try {
      await onSave({ ...draft, interestedCourseIds: selectedCourses });
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'حدث خطأ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="إضافة ليد جديد"
      icon={<UserPlus size={18} className="text-primary-600" />}
      size="sm"
    >

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {err && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700">{err}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-bold text-gray-600 mb-1 block">الاسم *</label>
              <input value={draft.name} onChange={e => set('name', e.target.value)}
                placeholder="اسم العميل"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-600 mb-1 block">رقم الهاتف *</label>
              <input value={draft.phone} onChange={e => set('phone', e.target.value)}
                placeholder="01XXXXXXXXX" dir="ltr"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-600 mb-1 block">البريد الإلكتروني</label>
              <input value={draft.email} onChange={e => set('email', e.target.value)}
                placeholder="example@email.com" dir="ltr"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-gray-600 mb-1 block">مستوى الاهتمام</label>
              <div className="flex gap-1.5">
                {(['high', 'medium', 'low'] as const).map(il => (
                  <button key={il} onClick={() => set('interestLevel', il)}
                    className={`flex-1 text-xs py-1.5 rounded-lg border transition ${
                      draft.interestLevel === il
                        ? 'bg-primary-50 border-primary-300 text-primary-800 font-bold'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}>
                    {IL_LABEL[il]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-600 mb-1 block">مصدر الليد</label>
              <select value={draft.source} onChange={e => set('source', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs bg-white">
                <option value="">—</option>
                {sources.map(src => <option key={src} value={src}>{src}</option>)}
              </select>
            </div>
          </div>

          {/* Branch — required */}
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">
              🏢 الفرع <span className="text-red-500">*</span>
            </label>
            <select
              value={draft.branch}
              onChange={e => set('branch', e.target.value)}
              className={`w-full border rounded-xl px-3 py-2 text-sm bg-white ${!draft.branch ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
            >
              <option value="">— اختر الفرع (مطلوب) *</option>
              {(branches.length > 0
                ? branches
                : Object.entries(BRANCH_ENUM_LABELS).map(([id, label]) => ({ id, label }))
              ).map(b => (
                <option key={b.id} value={b.id}>{b.label}</option>
              ))}
            </select>
          </div>

          {salesReps.length > 0 && (
            <div>
              <label className="text-xs font-bold text-gray-600 mb-1 block">تعيين لمندوب</label>
              <select value={draft.autoAssign ? '__auto__' : draft.assignedSalesId}
                onChange={e => {
                  if (e.target.value === '__auto__') {
                    setDraft(d => ({ ...d, autoAssign: true, assignedSalesId: '' }));
                  } else {
                    setDraft(d => ({ ...d, autoAssign: false, assignedSalesId: e.target.value }));
                  }
                }}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
                <option value="">— غير معين</option>
                <option value="__auto__">🤖 توزيع تلقائي (الأقل تحميلاً)</option>
                <option value="__rr__">🔄 Round-Robin (بالتسلسل)</option>
                {salesReps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              {draft.autoAssign && (
                <p className="text-xs text-emerald-600 mt-1">✓ سيتم تعيين الليد تلقائياً للمندوب الأقل عبئاً</p>
              )}
              {draft.assignedSalesId === '__rr__' && (
                <p className="text-xs text-blue-600 mt-1">🔄 سيتم التوزيع بالتسلسل بين المندوبين</p>
              )}
            </div>
          )}

          {/* Interested courses + bundles — scrollable checkbox list */}
          {(courses.length > 0 || bundles.length > 0) && (
            <div>
              <label className="text-xs font-bold text-gray-600 mb-1 block">الكورسات والمسارات المهتم بها</label>
              <div className="border border-gray-200 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                {courses.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wide sticky top-0">كورسات</div>
                    {courses.map(c => (
                      <label key={c.id} className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-blue-50 transition border-b border-gray-50 last:border-0 ${selectedCourses.includes(c.id) ? 'bg-blue-50' : ''}`}>
                        <input type="checkbox" checked={selectedCourses.includes(c.id)} onChange={() => toggleCourse(c.id)} className="accent-primary-600 w-3.5 h-3.5 flex-shrink-0" />
                        <span className="text-sm text-gray-800">{c.title}</span>
                      </label>
                    ))}
                  </>
                )}
                {bundles.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 bg-teal-50 border-b border-teal-100 text-[10px] font-bold text-teal-600 uppercase tracking-wide sticky top-0">مسارات تعليمية</div>
                    {bundles.map(b => (
                      <label key={b.id} className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-teal-50 transition border-b border-gray-50 last:border-0 ${selectedCourses.includes(b.id) ? 'bg-teal-50' : ''}`}>
                        <input type="checkbox" checked={selectedCourses.includes(b.id)} onChange={() => toggleCourse(b.id)} className="accent-teal-600 w-3.5 h-3.5 flex-shrink-0" />
                        <span className="text-sm text-gray-800">📚 {b.title}</span>
                      </label>
                    ))}
                  </>
                )}
              </div>
              {selectedCourses.length > 0 && (
                <p className="text-[11px] text-primary-600 font-medium mt-1">✓ {selectedCourses.length} {selectedCourses.length === 1 ? 'عنصر مختار' : 'عناصر مختارة'}</p>
              )}
            </div>
          )}

          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">ملاحظات</label>
            <textarea value={draft.notes} onChange={e => set('notes', e.target.value)}
              rows={2} placeholder="أي تفاصيل إضافية..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none" />
          </div>

          {/* Tags */}
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block flex items-center gap-1">
              <Tag size={11} /> تصنيفات
            </label>
            <TagInput tags={draft.tags} onChange={tags => setDraft(d => ({ ...d, tags }))} />
          </div>

          {/* Duplicate warning */}
          {dupInfo && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-3">
              <p className="text-xs font-bold text-amber-800">⚠️ رقم الهاتف موجود بالفعل!</p>
              <p className="text-xs text-amber-700 mt-0.5">الليد: <strong>{dupInfo.name}</strong> — {STATUS_CFG[dupInfo.status].label}</p>
              <div className="flex gap-2 mt-2">
                <button type="button" onClick={() => handleSubmit(true)}
                  className="text-xs bg-amber-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-amber-700 transition">
                  إضافة رغم ذلك
                </button>
                <button type="button" onClick={() => setDupInfo(null)}
                  className="text-xs bg-gray-100 px-3 py-1.5 rounded-lg text-gray-700 hover:bg-gray-200 transition">
                  إلغاء
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex gap-3">
          <button onClick={() => handleSubmit()} disabled={saving}
            className="flex-1 bg-primary-600 text-white py-2.5 rounded-xl font-bold hover:bg-primary-700 transition disabled:opacity-60 flex items-center justify-center gap-2">
            {saving ? <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Plus size={16} />}
            {saving ? 'جاري الحفظ...' : 'حفظ الليد'}
          </button>
          <button onClick={onClose} className="px-4 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition">إلغاء</button>
        </div>
    </Modal>
  );
}

// ── Bulk WhatsApp Modal ───────────────────────────────────────────────────────
