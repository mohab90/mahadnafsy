import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Modal } from '../../../../shared/ui/Modal';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { useCertificateCatalog } from '../../../lib/certificateCatalog';

// «في بعض الشهادات مكتوب سعرها غلط … محتاجة مراجعة دقيقة جدا» (15 Oct 2026). Lists every certificate whose
// price or paid amount disagrees with the payments still standing or with the price list (GET
// /admin/certificate-requests/audit), says why, and corrects the ones selected.
type Issue = {
  id: string; subscriberName: string; clientCode: string | null; type: string; customName: string | null; status: string; currency: string;
  price: number | null; systemPrice: number | null; paid: number; linkedPaid: number; paymentRows: number;
  problemLabels: string[]; fix: { paid?: number; price?: number };
};
type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

const money = (value: number | null, currency: string) => (value == null ? '—' : `${value.toLocaleString('ar-EG-u-nu-latn')} ${currency === 'SAR' ? 'ر.س' : currency === 'USD' ? '$' : 'ج'}`);

export function CertificatePriceAudit({ notify, onClose, onFixed }: { notify: NotifyFn; onClose: () => void; onFixed: () => void }) {
  const certCatalog = useCertificateCatalog();
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState(0);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [fixing, setFixing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const answer = await mysqlAdmin.adminGet<{ checked: number; issues: Issue[] }>('/admin/certificate-requests/audit');
      setChecked(answer.checked); setIssues(answer.issues);
      setPicked(new Set(answer.issues.filter(issue => issue.fix.paid !== undefined || issue.fix.price).map(issue => issue.id)));
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذّرت المراجعة');
    } finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const fix = async () => {
    setFixing(true);
    try {
      const result = await mysqlAdmin.adminPost<{ fixed: number }>('/admin/certificate-requests/audit/fix', { ids: [...picked] });
      notify('success', `اتصحح ${result.fixed} شهادة`);
      onFixed();
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذّر التصحيح');
    } finally { setFixing(false); }
  };
  const fixable = issues.filter(issue => issue.fix.paid !== undefined || issue.fix.price);

  return (
    <Modal open onClose={onClose} title="مراجعة أسعار الشهادات والمدفوع" size="full" icon={<ShieldCheck size={18} className="text-emerald-600" />}>
      <div className="space-y-3 p-5" dir="rtl">
        <p className="text-sm text-gray-600">
          بتقارن كل شهادة بالدفعات الموجودة فعلاً وبقايمة الأسعار. المدفوع بيتصحّح من الدفعات اللي لسه قايمة (اللي اتمسحت أو اتصحّحت مبتتحسبش)، والسعر من قايمة «تسعير الشهادات».
          الشهادات اللي استوردناها «مدفوعة» من غير دفعات بتفضل زي ما هي.
        </p>
        {loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> بنراجع…</div>
        ) : issues.length === 0 ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center text-sm font-bold text-emerald-800">✅ اتراجعت {checked} شهادة — كلها مظبوطة</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold text-gray-700">{issues.length} شهادة فيها مشكلة من {checked}</span>
              <button type="button" disabled={fixing || !picked.size} onClick={() => void fix()}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-emerald-700 disabled:opacity-50">
                {fixing ? 'جارى التصحيح…' : `صحّح المحدد (${picked.size})`}
              </button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-2 py-2"><input type="checkbox" aria-label="الكل" checked={fixable.length > 0 && fixable.every(issue => picked.has(issue.id))}
                      onChange={event => setPicked(event.target.checked ? new Set(fixable.map(issue => issue.id)) : new Set())} /></th>
                    {['العميل', 'الشهادة', 'السعر المسجّل', 'سعر القايمة', 'المدفوع المسجّل', 'مجموع الدفعات', 'المشكلة'].map(title => <th key={title} className="px-2 py-2 text-right font-bold">{title}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {issues.map(issue => {
                    const canFix = issue.fix.paid !== undefined || Boolean(issue.fix.price);
                    return (
                      <tr key={issue.id} className="border-t border-gray-100 align-top">
                        <td className="px-2 py-2"><input type="checkbox" disabled={!canFix} checked={picked.has(issue.id)}
                          onChange={event => setPicked(current => { const next = new Set(current); if (event.target.checked) next.add(issue.id); else next.delete(issue.id); return next; })} /></td>
                        <td className="px-2 py-2 font-bold text-gray-800">{issue.subscriberName || '—'}<div className="font-normal text-gray-400">{issue.clientCode}</div></td>
                        <td className="px-2 py-2">{issue.customName || certCatalog.label(issue.type)}</td>
                        <td className="px-2 py-2">{money(issue.price, issue.currency)}{issue.fix.price ? <div className="font-bold text-emerald-700">← {money(issue.fix.price, issue.currency)}</div> : null}</td>
                        <td className="px-2 py-2">{money(issue.systemPrice, issue.currency)}</td>
                        <td className="px-2 py-2 font-bold text-red-700">{money(issue.paid, issue.currency)}{issue.fix.paid !== undefined ? <div className="text-emerald-700">← {money(issue.fix.paid, issue.currency)}</div> : null}</td>
                        <td className="px-2 py-2">{issue.paymentRows ? money(issue.linkedPaid, issue.currency) : <span className="text-gray-400">من غير دفعات</span>}</td>
                        <td className="px-2 py-2 text-amber-800">{issue.problemLabels.map(label => <div key={label}>• {label}</div>)}{!canFix && <div className="mt-1 text-gray-500">محتاجة مراجعة يدوية</div>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
