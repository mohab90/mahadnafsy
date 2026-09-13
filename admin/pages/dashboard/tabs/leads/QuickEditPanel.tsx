// Inline edit for a single lead, without leaving the list.
//
// Moved out of LeadSubcomponents.tsx, which had grown to 1,277 lines across
// seventeen unrelated exports. It still re-exports this, so the ten files that
// import from it are untouched.

import { useState } from 'react';
import { cairoDateOnly } from '../../../../../shared/cairoDate';
import { Modal } from '../../../../../shared/ui/Modal';
import { MessageCircle, Phone, Plus, Tag, X } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { LeadItem, LeadStatus, CommunicationRecord, Course, Bundle } from '../../../../types';
import type { NotifyFn } from '../CrmSettingsModal';
import { toDialable } from '../../../../lib/whatsappLink';
import { courseBadgeLabel, isRawCourse } from './leadCourseLabel';
import {
  IL_LABEL,
  STATUS_CFG,
  calcLeadScore,
} from '../leadUtils';
import { TagInput } from './LeadInputs';
import { ScoreBadge, getScoreBreakdown, LeadJourneyTimeline } from './LeadScoreAndTimeline';
import { confirmDialog } from '../../../../../shared/ui/confirmDialog';


export function QuickEditPanel({ lead, onClose, onSave, courses, bundles, notify, instituteBranches }: {
  lead: LeadItem;
  onClose: () => void;
  onSave: (updated: LeadItem) => void;
  courses: Course[];
  bundles: Bundle[];
  notify: NotifyFn;
  instituteBranches: { id: string; label: string }[];
}) {
  const [draft, setDraft] = useState<LeadItem>({ ...lead });
  const [commNote, setCommNote] = useState('');
  const [commType, setCommType] = useState<CommunicationRecord['type']>('call');
  const [deactivating, setDeactivating] = useState(false);

  const handleDeactivateUser = async () => {
    if (!lead.email) return notify('error', 'لا يوجد بريد إلكتروني لهذا العميل');
    if (!await confirmDialog(`هل أنت متأكد أنك تريد تعطيل حساب "${lead.name}"؟\nلن يتمكن من تسجيل الدخول بعد ذلك.`)) return;
    setDeactivating(true);
    try {
      // Resolve the sign-in account from the lead's email — the server matches a
      // complete address exactly, so this is one indexed row, not a full dump.
      const found = await mysqlAdmin.findAccountByEmail(lead.email);
      const user = (found?.rows || [])[0];
      if (!user) { notify('error', 'لم يتم العثور على حساب لهذا العميل'); return; }
      const result = await mysqlAdmin.setAccountActive(user.id, false);
      notify('success', result?.message || `تم تعطيل حساب ${lead.name} بنجاح — لن يتمكن من الدخول`);
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'فشل تعطيل الحساب، حاول مرة أخرى');
    } finally {
      setDeactivating(false);
    }
  };

  const addComm = () => {
    if (!commNote.trim()) return;
    const rec: CommunicationRecord = {
      id: `cr-${Date.now()}`, type: commType,
      date: cairoDateOnly(), notes: commNote.trim(),
    };
    setDraft(d => ({ ...d, communications: [...(d.communications || []), rec] }));
    setCommNote('');
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={draft.name}
      subtitle={<>{draft.phone} · <ScoreBadge score={calcLeadScore(draft)} /></>}
      align="drawer"
      bodyClassName="p-0"
    >

        <div className="p-5 space-y-4 flex-1">
          {/* Status */}
          <div>
            <label className="text-xs font-bold text-gray-600 mb-2 block">الحالة</label>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(STATUS_CFG) as LeadStatus[]).filter(s => s !== 'converted').map(s => (
                <button key={s} onClick={() => setDraft(d => ({ ...d, status: s }))}
                  className={`text-xs px-2 py-1.5 rounded-lg border font-medium transition ${
                    draft.status === s
                      ? STATUS_CFG[s].color + ' ring-2 ring-offset-0 ring-current'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}>
                  {STATUS_CFG[s].label}
                </button>
              ))}
            </div>
          </div>

          {/* Interest level */}
          <div>
            <label className="text-xs font-bold text-gray-600 mb-2 block">مستوى الاهتمام</label>
            <div className="flex gap-2">
              {(['high', 'medium', 'low'] as const).map(il => (
                <button key={il} onClick={() => setDraft(d => ({ ...d, interestLevel: il }))}
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

          {/* Next follow-up */}
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">موعد المتابعة القادمة</label>
            <input type="date" value={draft.nextFollowUpDate || ''}
              onChange={e => setDraft(d => ({ ...d, nextFollowUpDate: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
          </div>

          {/* Branch */}
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">الفرع</label>
            {(() => {
              const normB = (v: string) => v.toUpperCase().replace(/[-\s]/g, '_');
              const branchSelectId = draft.branch
                ? (instituteBranches.find(b => normB(b.id) === normB(draft.branch || ''))?.id ?? draft.branch)
                : '';
              return (
                <select value={branchSelectId} onChange={e => setDraft(d => ({ ...d, branch: (e.target.value || undefined) as typeof d.branch }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
                  <option value="">— غير محدد</option>
                  {instituteBranches.map(b => (
                    <option key={b.id} value={b.id}>{b.label}</option>
                  ))}
                </select>
              );
            })()}
          </div>

          {/* Interested courses + bundles (editable) */}
          {(courses.length > 0 || bundles.length > 0) && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-600 mb-1 block">الكورسات والمسارات المهتم بها</label>
              {courses.length > 0 && (
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {courses.map(c => (
                    <button key={c.id} type="button"
                      onClick={() => setDraft(d => ({
                        ...d,
                        interestedCourseIds: (d.interestedCourseIds || []).includes(c.id)
                          ? (d.interestedCourseIds || []).filter(id => id !== c.id)
                          : [...(d.interestedCourseIds || []), c.id],
                      }))}
                      className={`text-xs px-2.5 py-1 rounded-full border transition ${
                        (draft.interestedCourseIds || []).includes(c.id)
                          ? 'bg-primary-600 text-white border-primary-600'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}>
                      {c.title}
                    </button>
                  ))}
                </div>
              )}
              {bundles.length > 0 && (
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {bundles.map(b => (
                    <button key={b.id} type="button"
                      onClick={() => setDraft(d => ({
                        ...d,
                        interestedCourseIds: (d.interestedCourseIds || []).includes(b.id)
                          ? (d.interestedCourseIds || []).filter(id => id !== b.id)
                          : [...(d.interestedCourseIds || []), b.id],
                      }))}
                      className={`text-xs px-2.5 py-1 rounded-full border transition ${
                        (draft.interestedCourseIds || []).includes(b.id)
                          ? 'bg-teal-600 text-white border-teal-600'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}>
                      📚 {b.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">ملاحظات</label>
            <textarea value={draft.notes || ''} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
              rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none" />
          </div>

          {/* Add communication */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
            <p className="text-xs font-bold text-gray-700 flex items-center gap-1"><MessageCircle size={12} /> سجل تواصل جديد</p>
            <div className="flex gap-1.5">
              <select value={commType} onChange={e => setCommType(e.target.value as CommunicationRecord['type'])}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white">
                <option value="call">📞 مكالمة</option>
                <option value="whatsapp">💬 واتساب</option>
                <option value="email">✉️ إيميل</option>
                <option value="meeting">🤝 اجتماع</option>
                <option value="note">📝 ملاحظة</option>
              </select>
              <input value={commNote} onChange={e => setCommNote(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addComm()}
                placeholder="ملاحظة التواصل..."
                className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs" />
              <button onClick={addComm} className="bg-primary-600 text-white px-2.5 py-1.5 rounded-lg text-xs font-bold">
                <Plus size={13} />
              </button>
            </div>
            <div className="space-y-1 max-h-28 overflow-y-auto">
              {(draft.communications || []).slice().reverse().slice(0, 5).map(c => (
                <div key={c.id} className="text-xs text-gray-600 bg-white border border-gray-100 rounded-lg px-2 py-1">
                  <span className="font-medium text-gray-400">{c.date}</span> · {c.notes}
                </div>
              ))}
            </div>
          </div>

          {/* Phone quick links */}
          <div className="flex gap-2">
            <a href={`tel:${draft.phone}`}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs border border-gray-200 rounded-xl py-2 hover:bg-gray-50 text-gray-600 font-medium">
              <Phone size={13} /> اتصال
            </a>
            <a href={`https://wa.me/${toDialable(draft.phone)}`} target="_blank" rel="noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 text-xs border border-emerald-200 rounded-xl py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-medium">
              💬 واتساب
            </a>
          </div>

          {/* ── Tags ── */}
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block flex items-center gap-1">
              <Tag size={11} /> تصنيفات
            </label>
            <TagInput tags={draft.tags || []} onChange={tags => setDraft(d => ({ ...d, tags }))} />
          </div>

          {/* ── AI Score Breakdown ── */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-700">تحليل السكور</span>
              <ScoreBadge score={calcLeadScore(draft)} />
            </div>
            <div className="space-y-1.5">
              {getScoreBreakdown(draft).map(item => (
                <div key={item.label}>
                  <div className="flex items-center justify-between text-[10px] text-gray-500 mb-0.5">
                    <span>{item.label}</span>
                    <div className="flex items-center gap-1">
                      <span className="font-bold text-gray-700">{item.pts}/{item.max}</span>
                      {item.tip && <span className="text-amber-600 font-bold">→ {item.tip}</span>}
                    </div>
                  </div>
                  <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-primary-500 rounded-full transition-all"
                      style={{ width: `${Math.round((item.pts / item.max) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Journey Timeline (DB-backed) ── */}
          <LeadJourneyTimeline leadId={lead.id} communications={draft.communications} />
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-100 p-4 space-y-2">
          <div className="flex gap-3">
            <button onClick={() => onSave(draft)}
              className="flex-1 bg-primary-600 text-white py-2.5 rounded-xl font-bold hover:bg-primary-700 transition">
              حفظ التغييرات
            </button>
            <button onClick={onClose} className="px-4 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition">إلغاء</button>
          </div>
          {lead.source === 'تسجيل دخول' && (
            <button
              onClick={handleDeactivateUser}
              disabled={deactivating}
              className="w-full text-xs py-2 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 transition font-bold disabled:opacity-50">
              {deactivating ? 'جاري التعطيل...' : '🚫 تعطيل حساب المستخدم (منع الدخول)'}
            </button>
          )}
        </div>
    </Modal>
  );
}

// ── Lead Card ─────────────────────────────────────────────────────────────────
