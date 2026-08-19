import React, { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Banknote, FileText, Loader2 } from 'lucide-react';
import { mysqlAdmin } from '../../lib/mysqlapi';
import PromptModal from '../../components/shared/PromptModal';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface StaffDocument {
  docType: string;
  label: string;
  received: boolean;
  note: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
  recorded: boolean;
}

interface PayDraft {
  baseSalary: string;
  commissionType: string;
  commissionRate: string;
  monthlyTarget: string;
}

const COMMISSION_LABELS: Record<string, string> = {
  NONE: 'بدون عمولة',
  PERCENT: 'نسبة من المبيعات',
  TARGET: 'تارجيت شهري محدد',
};

/**
 * The two things a staff file has to answer that nothing recorded before: which
 * papers HR physically holds, and what this person is actually paid.
 *
 * The checklist deliberately lists all seven documents whether or not anything
 * was recorded for them — a list built from stored rows only can show what was
 * handed in but never what is still missing, which is the question being asked.
 */
const StaffEmployeeFilePanel: React.FC<{ staffId: string; staffName: string; notify: NotifyFn }> =
  ({ staffId, staffName, notify }) => {
    const [docs, setDocs] = useState<StaffDocument[]>([]);
    const [pay, setPay] = useState<PayDraft | null>(null);
    const [loading, setLoading] = useState(true);
    const [savingDoc, setSavingDoc] = useState<string | null>(null);
    const [savingPay, setSavingPay] = useState(false);
    const [noteFor, setNoteFor] = useState<StaffDocument | null>(null);

    const load = useCallback(async () => {
      setLoading(true);
      try {
        const [documents, payRow] = await Promise.all([
          mysqlAdmin.listStaffDocuments(staffId),
          mysqlAdmin.getStaffPay(staffId),
        ]);
        setDocs(documents);
        setPay({
          baseSalary: payRow.baseSalary == null ? '' : String(payRow.baseSalary),
          commissionType: payRow.commissionType || 'NONE',
          commissionRate: payRow.commissionRate == null ? '' : String(payRow.commissionRate),
          monthlyTarget: payRow.monthlyTarget == null ? '' : String(payRow.monthlyTarget),
        });
      } catch {
        notify('error', 'تعذّر تحميل ملف الموظف');
      } finally {
        setLoading(false);
      }
    }, [staffId, notify]);

    useEffect(() => { void load(); }, [load]);

    const toggleDoc = async (doc: StaffDocument) => {
      setSavingDoc(doc.docType);
      try {
        await mysqlAdmin.setStaffDocument(staffId, doc.docType, {
          received: !doc.received,
          note: doc.note || undefined,
        });
        await load();
      } catch (error) {
        notify('error', error instanceof Error ? error.message : 'تعذّر حفظ حالة المستند');
      } finally {
        setSavingDoc(null);
      }
    };

    const saveDocNote = async (doc: StaffDocument, note: string) => {
      setSavingDoc(doc.docType);
      try {
        await mysqlAdmin.setStaffDocument(staffId, doc.docType, {
          received: doc.received,
          note: note || undefined,
        });
        setNoteFor(null);
        await load();
      } catch (error) {
        notify('error', error instanceof Error ? error.message : 'تعذّر حفظ الملاحظة');
      } finally {
        setSavingDoc(null);
      }
    };

    const savePay = async () => {
      if (!pay) return;
      setSavingPay(true);
      try {
        // Empty means "not set", which is different from zero — a blank salary
        // is unknown, a zero salary is a claim. Only real numbers are sent.
        const num = (value: string) => (value.trim() === '' ? null : Number(value));
        await mysqlAdmin.setStaffPay(staffId, {
          baseSalary: num(pay.baseSalary),
          commissionType: pay.commissionType,
          commissionRate: num(pay.commissionRate),
          monthlyTarget: num(pay.monthlyTarget),
        });
        notify('success', `تم حفظ بيانات راتب ${staffName}`);
        await load();
      } catch (error) {
        notify('error', error instanceof Error ? error.message : 'تعذّر حفظ بيانات الراتب');
      } finally {
        setSavingPay(false);
      }
    };

    if (loading) {
      return (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-gray-100 bg-white p-8 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin" /> جاري تحميل ملف الموظف…
        </div>
      );
    }

    const missing = docs.filter(d => !d.received).length;

    return (
      <div className="space-y-4" dir="rtl">
        {noteFor && (
          <PromptModal
            title={`ملاحظة — ${noteFor.label}`}
            label="الملاحظة"
            hint="مثال: الصورة غير واضحة، أو الأصل مطلوب."
            initialValue={noteFor.note || ''}
            confirmLabel="حفظ الملاحظة"
            multiline
            busy={savingDoc === noteFor.docType}
            onSubmit={note => saveDocNote(noteFor, note)}
            onCancel={() => setNoteFor(null)}
          />
        )}
        {/* ── Documents ── */}
        <section className="rounded-2xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold text-gray-900">
              <FileText size={16} className="text-indigo-600" /> أوراق الموظف
            </h3>
            <span className={`rounded-lg px-2 py-1 text-xs font-bold ${
              missing === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              {missing === 0 ? 'الملف مكتمل' : `ناقص ${missing} من ${docs.length}`}
            </span>
          </div>

          <div className="space-y-1.5">
            {docs.map(doc => (
              <div key={doc.docType}
                className={`flex flex-wrap items-center gap-2 rounded-xl border p-2.5 ${
                  doc.received ? 'border-emerald-200 bg-emerald-50/50' : 'border-gray-200 bg-gray-50/50'}`}>
                <button
                  disabled={savingDoc === doc.docType}
                  onClick={() => toggleDoc(doc)}
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition disabled:opacity-40 ${
                    doc.received ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-gray-300 bg-white'}`}
                  title={doc.received ? 'تم الاستلام — اضغط للتراجع' : 'اضغط لتسجيل الاستلام'}>
                  {doc.received && <BadgeCheck size={14} />}
                </button>

                <span className="min-w-0 flex-1 text-sm font-bold text-gray-800">{doc.label}</span>

                {doc.note && <span className="text-xs text-gray-500">— {doc.note}</span>}

                {/* "never recorded" is not the same as "asked for and not
                    delivered", and HR needs to tell them apart. */}
                {!doc.recorded && (
                  <span className="rounded-md bg-gray-200 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">
                    لم يُسجَّل بعد
                  </span>
                )}
                {doc.updatedByName && (
                  <span className="text-[10px] text-gray-400">
                    {doc.updatedByName}{doc.updatedAt ? ` · ${String(doc.updatedAt).slice(0, 10)}` : ''}
                  </span>
                )}
                <button disabled={savingDoc === doc.docType} onClick={() => setNoteFor(doc)}
                  className="rounded-lg bg-white px-2 py-1 text-[11px] font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-40">
                  ملاحظة
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* ── Pay ── */}
        {pay && (
          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-900">
              <Banknote size={16} className="text-emerald-600" /> الراتب والعمولة
            </h3>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-gray-600">الراتب الأساسي (ج.م)</span>
                <input type="number" min="0" dir="ltr" value={pay.baseSalary}
                  onChange={e => setPay(p => (p ? { ...p, baseSalary: e.target.value } : p))}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" placeholder="غير محدد" />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-bold text-gray-600">نظام العمولة</span>
                <select value={pay.commissionType}
                  onChange={e => setPay(p => (p ? { ...p, commissionType: e.target.value } : p))}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
                  {Object.entries(COMMISSION_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>

              {/* Only the field the chosen system actually uses is shown; the
                  other one is not a setting that applies. */}
              {pay.commissionType === 'PERCENT' && (
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-gray-600">النسبة (%)</span>
                  <input type="number" min="0" max="100" step="0.5" dir="ltr" value={pay.commissionRate}
                    onChange={e => setPay(p => (p ? { ...p, commissionRate: e.target.value } : p))}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" placeholder="مثال: 5" />
                </label>
              )}
              {pay.commissionType === 'TARGET' && (
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-gray-600">التارجيت الشهري (ج.م)</span>
                  <input type="number" min="0" dir="ltr" value={pay.monthlyTarget}
                    onChange={e => setPay(p => (p ? { ...p, monthlyTarget: e.target.value } : p))}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" placeholder="مثال: 50000" />
                </label>
              )}
            </div>

            <button onClick={savePay} disabled={savingPay}
              className="mt-4 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40">
              {savingPay ? 'جارٍ الحفظ…' : 'حفظ بيانات الراتب'}
            </button>
          </section>
        )}
      </div>
    );
  };

export default StaffEmployeeFilePanel;
