import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Loader2, Lock, Trash2, Upload } from 'lucide-react';
import { mysqlAdmin, type CourseDocument, type CourseDocumentTier } from '../../../lib/mysqlapi';
import { cairoDateLabel } from '../../../../shared/cairoDate';
import { confirmDialog } from '../../../../shared/ui/confirmDialog';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

const MAX_MB = 50;

// The three PDFs of a diploma and what opens each (api/lib/courseDocuments.js). The server decides who may download; here is only where they are put.
const TIERS: Array<{ tier: CourseDocumentTier; name: string; rule: string; tone: string }> = [
  { tier: 'FREE', name: 'ملف مجاني مع الكورس', rule: 'بيظهر ويتحمّل لأي زائر على صفحة الكورس، حتى من غير حساب.', tone: 'border-emerald-200 bg-emerald-50/40' },
  { tier: 'FIRST_PAYMENT', name: 'ملف بعد الحجز ودفع أول قسط', rule: 'بيتفتح للعميل اللي حجز الكورس ودفع أي مبلغ فعلي عليه (الدفعة المعلّقة مش بتتحسب).', tone: 'border-amber-200 bg-amber-50/40' },
  { tier: 'EIGHTY_PERCENT', name: 'الملف الكامل بعد دفع 80% أو أكتر', rule: 'بيتفتح لما المدفوع (بما فيه «مدفوع قبل السيستم») يوصل 80% من سعر الكورس أو أكتر.', tone: 'border-rose-200 bg-rose-50/40' },
];

const sizeLabel = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} ميجا` : `${Math.max(1, Math.round(bytes / 1024))} ك.ب`);

export function CourseDocumentsSection({ courseId, notify }: { courseId: string; notify: NotifyFn }) {
  const [documents, setDocuments] = useState<CourseDocument[] | null>(null);
  const [titles, setTitles] = useState<Partial<Record<CourseDocumentTier, string>>>({});
  const [busy, setBusy] = useState<CourseDocumentTier | null>(null);

  const load = useCallback(async () => {
    if (!courseId) { setDocuments(null); return; }
    try {
      const { documents: list } = await mysqlAdmin.listCourseDocuments(courseId);
      setDocuments(list);
      setTitles(Object.fromEntries(list.map(item => [item.tier, item.title])));
    } catch { setDocuments([]); }
  }, [courseId]);
  useEffect(() => { void load(); }, [load]);

  if (!courseId) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
        <Lock size={14} className="ml-1 inline" />احفظ الكورس الأول، وبعدها تقدر ترفع ملفات الـPDF بتاعته (ملف مجاني، وملف بعد أول قسط، وملف كامل بعد 80%).
      </div>
    );
  }

  const upload = async (tier: CourseDocumentTier, file: File | undefined) => {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { notify('error', 'الملف لازم يكون PDF.'); return; }
    if (file.size > MAX_MB * 1024 * 1024) { notify('error', `الملف أكبر من ${MAX_MB} ميجا.`); return; }
    setBusy(tier);
    try {
      await mysqlAdmin.uploadCourseDocument(courseId, tier, file, titles[tier] || file.name.replace(/\.pdf$/i, ''));
      notify('success', 'اتحفظ الملف.');
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذّر رفع الملف.');
    } finally { setBusy(null); }
  };

  const remove = async (tier: CourseDocumentTier) => {
    if (!(await confirmDialog('تمسح الملف ده؟ العملاء مش هيقدروا يفتحوه تاني.'))) return;
    setBusy(tier);
    try { await mysqlAdmin.removeCourseDocument(courseId, tier); notify('success', 'اتمسح الملف.'); await load(); }
    catch (error) { notify('error', error instanceof Error ? error.message : 'تعذّر المسح.'); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-3" data-testid="course-documents">
      <div>
        <p className="text-xs font-bold text-gray-700">ملفات PDF الخاصة بالدبلومة</p>
        <p className="text-[11px] text-gray-400">الملفات بتتخزن على السيرفر في مكان خاص، ومفيش لينك مباشر ليها: السيرفر هو اللي يقرر مين يفتح كل ملف حسب اللي دفعه.</p>
      </div>
      {TIERS.map(({ tier, name, rule, tone }) => {
        const current = documents?.find(item => item.tier === tier);
        const working = busy === tier;
        return (
          <div key={tier} className={`rounded-xl border p-3 ${tone}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-gray-800">{name}</p>
              {current && <span className="text-[11px] text-gray-500">اتحدّث {cairoDateLabel(current.updatedAt)}</span>}
            </div>
            <p className="mb-2 text-[11px] text-gray-500">{rule}</p>
            {current && (
              <div className="mb-2 flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-xs text-gray-700">
                <FileText size={14} className="text-red-600" />
                <span className="min-w-0 flex-1 truncate" dir="ltr">{current.fileName}</span>
                <span className="text-gray-400">{sizeLabel(current.size)}</span>
                <a
                  href={`/api/courses/${encodeURIComponent(courseId)}/documents/${tier}/file`} target="_blank" rel="noopener noreferrer"
                  className="font-bold text-primary-700 hover:underline"
                >فتح</a>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="min-w-[200px] flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                placeholder="الاسم اللي يظهر للعميل (اختياري)"
                value={titles[tier] || ''}
                onChange={event => setTitles(previous => ({ ...previous, [tier]: event.target.value }))}
                maxLength={300}
              />
              <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-bold text-white hover:bg-primary-700 ${working ? 'pointer-events-none opacity-60' : ''}`}>
                {working ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {current ? 'استبدال الملف' : 'رفع ملف PDF'}
                <input
                  type="file" accept="application/pdf,.pdf" className="hidden" disabled={working}
                  onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void upload(tier, file); }}
                />
              </label>
              {current && (
                <button type="button" disabled={working} onClick={() => void remove(tier)} className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-50">
                  <Trash2 size={14} />مسح
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
