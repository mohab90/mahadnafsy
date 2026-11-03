// «اعمل صلاحية لحساب الأدمن في حساب العميل … اعدل الشهادات المشترك فيها أو احذفها»: the client's certificates inside the client's own page, for the managers —
// change the course, the group, the price and the names on one, or delete it (a paid one only with the owner's confirmation; the payment stays in the books).
import React, { useCallback, useEffect, useState } from 'react';
import { Award, Loader2, Pencil, Save, Trash2 } from 'lucide-react';
import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';
import { confirmDialog } from '../../../../../shared/ui/confirmDialog';
import { Modal } from '../../../../../shared/ui/Modal';
import { useSiteData } from '../../../../context/SiteDataContext';
import { useCertificateCatalog } from '../../../../lib/certificateCatalog';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type Cert = {
  id: string; type: string; courseId: string | null; courseTitle: string | null; customName: string | null; nameAr: string | null; nameEn: string | null;
  nationality: string | null; idNumber: string | null; status: string; price: number | null; paid: number; currency: string;
};

const GROUPS: [string, string][] = [['egyptian', 'مصري'], ['non_egyptian_egypt', 'أجنبي مقيم في مصر'], ['saudi_resident', 'مقيم في السعودية'], ['international', 'دولي']];
const STATUS_AR: Record<string, string> = {
  pending: 'طلب جديد', awaiting_payment: 'مستني الدفع', paid: 'مدفوع', in_progress: 'قيد التجهيز', not_sent: 'لسه ما اتبعتش', issued: 'صدرت', shipped: 'اتشحنت',
  at_branch: 'في الفرع', delivered: 'اتسلمت', returned: 'مرتجعة', cancelled: 'ملغية',
};

const call = async (url: string, method: string, body?: unknown) => {
  const response = await fetch(url, {
    method, credentials: 'include', headers: { ...adminAuthHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { code: data.code as string | undefined });
  return data;
};

export const ClientCertificatesPanel: React.FC<{ subscriberId: string; notify: NotifyFn; onChanged?: () => void }> = ({ subscriberId, notify, onChanged }) => {
  const { courses } = useSiteData();
  const { types } = useCertificateCatalog();
  const [rows, setRows] = useState<Cert[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Cert | null>(null);
  const [draft, setDraft] = useState({ courseId: '', type: '', nationality: '', price: '', nameAr: '', nameEn: '', idNumber: '' });
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await call(`/api/admin/certificate-requests?subscriber_id=${encodeURIComponent(subscriberId)}&limit=200`, 'GET')); }
    catch { setRows([]); }
    finally { setLoading(false); }
  }, [subscriberId]);
  useEffect(() => { void load(); }, [load]);

  const open = (cert: Cert) => {
    setEditing(cert);
    setDraft({
      courseId: cert.courseId || '', type: cert.type, nationality: cert.nationality || '', price: cert.price == null ? '' : String(cert.price),
      nameAr: cert.nameAr || '', nameEn: cert.nameEn || '', idNumber: cert.idNumber || '',
    });
  };
  const save = async () => {
    if (!editing) return;
    setBusy(editing.id);
    try {
      await call(`/api/admin/certificate-requests/${encodeURIComponent(editing.id)}/details`, 'PUT', {
        courseId: draft.courseId, type: draft.type, nationality: draft.nationality, price: draft.price, nameAr: draft.nameAr, nameEn: draft.nameEn, idNumber: draft.idNumber,
      });
      notify('success', 'اتعدلت الشهادة');
      setEditing(null);
      await load(); onChanged?.();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر التعديل'); }
    finally { setBusy(''); }
  };
  const remove = async (cert: Cert) => {
    if (!(await confirmDialog({ message: `تمسح شهادة «${cert.courseTitle || cert.customName || cert.type}»؟`, confirmLabel: 'مسح' }))) return;
    setBusy(cert.id);
    try {
      try {
        await call(`/api/admin/certificate-requests/${encodeURIComponent(cert.id)}`, 'DELETE');
      } catch (error) {
        if ((error as { code?: string }).code !== 'CERT_PAID_FORCE_REQUIRED') throw error;
        if (!(await confirmDialog({ message: 'الشهادة دي مدفوعة. المسح هيشيلها من الحساب والدفعة هتفضل في الحسابات من غير ربط بشهادة. تكمّل؟', confirmLabel: 'امسحها برضه' }))) return;
        await call(`/api/admin/certificate-requests/${encodeURIComponent(cert.id)}?force=1`, 'DELETE');
      }
      notify('success', 'اتمسحت الشهادة');
      await load(); onChanged?.();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر المسح'); }
    finally { setBusy(''); }
  };

  const field = 'mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm';
  return (
    <div className="space-y-2 rounded-2xl border border-gray-200 bg-gray-50/60 p-3">
      <div className="flex items-center gap-2 text-sm font-extrabold text-gray-900"><Award size={15} className="text-amber-600" /> شهادات العميل</div>
      {loading ? <Loader2 size={16} className="animate-spin text-gray-400" />
        : rows.length === 0 ? <p className="text-xs text-gray-500">مفيش شهادات لعميل ده.</p>
          : rows.map(cert => (
            <div key={cert.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-sm">
              <div>
                <div className="font-bold text-gray-800">{types.find(t => t.key === cert.type)?.label || cert.customName || cert.type}{cert.courseTitle ? ` — ${cert.courseTitle}` : ''}</div>
                <div className="text-[11px] text-gray-500">
                  {STATUS_AR[cert.status] || cert.status} · {cert.price != null ? `${cert.price.toLocaleString('ar-EG-u-nu-latn')} ${cert.currency}` : 'بدون سعر'} · مدفوع {cert.paid.toLocaleString('ar-EG-u-nu-latn')}
                </div>
              </div>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => open(cert)} className="flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs font-bold text-gray-700 hover:bg-indigo-50 hover:text-indigo-700"><Pencil size={12} /> تعديل</button>
                <button type="button" disabled={busy === cert.id} onClick={() => void remove(cert)} className="flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"><Trash2 size={12} /> مسح</button>
              </div>
            </div>
          ))}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title="تعديل الشهادة" size="md">
          <div className="space-y-3" dir="rtl">
            <label className="block text-xs font-bold text-gray-600">نوع الشهادة
              <select className={field} value={draft.type} onChange={e => setDraft(v => ({ ...v, type: e.target.value }))}>{types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
            <label className="block text-xs font-bold text-gray-600">الكورس
              <select className={field} value={draft.courseId} onChange={e => setDraft(v => ({ ...v, courseId: e.target.value }))}>
                <option value="">— بدون كورس —</option>{courses.map(course => <option key={course.id} value={course.id}>{course.titleAr || course.title}</option>)}</select></label>
            <label className="block text-xs font-bold text-gray-600">المجموعة (بتحدد قائمة الأسعار)
              <select className={field} value={draft.nationality} onChange={e => setDraft(v => ({ ...v, nationality: e.target.value }))}>
                <option value="">—</option>{GROUPS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="block text-xs font-bold text-gray-600">السعر ({editing.currency})
              <input type="number" min={0} className={field} value={draft.price} onChange={e => setDraft(v => ({ ...v, price: e.target.value }))} /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs font-bold text-gray-600">الاسم بالعربي
                <input className={field} value={draft.nameAr} onChange={e => setDraft(v => ({ ...v, nameAr: e.target.value }))} /></label>
              <label className="block text-xs font-bold text-gray-600">الاسم بالإنجليزي (اسم العميل في كل شهاداته)
                <input dir="ltr" className={field} value={draft.nameEn} onChange={e => setDraft(v => ({ ...v, nameEn: e.target.value }))} /></label>
            </div>
            <label className="block text-xs font-bold text-gray-600">رقم البطاقة
              <input dir="ltr" className={field} value={draft.idNumber} onChange={e => setDraft(v => ({ ...v, idNumber: e.target.value }))} /></label>
            <button type="button" disabled={busy === editing.id} onClick={() => void save()} className="flex items-center gap-1 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Save size={14} /> حفظ</button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default ClientCertificatesPanel;
