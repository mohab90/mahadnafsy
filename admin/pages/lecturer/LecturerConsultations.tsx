import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Link2, Pencil } from 'lucide-react';
import { ConsultationTimingBadge } from '../../components/ConsultationTimingBadge';
import { promptDialog } from '../../../shared/ui/promptDialog';
import { errorText, lecturerApi, type LecturerConsultation, type Notify } from './lecturerApi';
import { Card, Empty, Loading } from './ui';

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'مستنية رد', cls: 'bg-amber-100 text-amber-800' }, confirmed: { label: 'مؤكدة', cls: 'bg-blue-100 text-blue-800' },
  completed: { label: 'تمت', cls: 'bg-emerald-100 text-emerald-800' }, cancelled: { label: 'ملغاة', cls: 'bg-red-100 text-red-700' },
};
const KIND: Record<string, string> = { individual: 'فردية', couple: 'زوجية', family: 'أسرية' };

/** The lecturer's consultations — each says whether it is urgent within 60 minutes or has a day and an hour. */
export function LecturerConsultations({ notify }: { notify: Notify }) {
  const [rows, setRows] = useState<LecturerConsultation[] | null>(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => {
    lecturerApi.consultations().then(setRows).catch(error => { notify('error', errorText(error, 'تعذر تحميل الاستشارات')); setRows([]); });
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  const update = async (item: LecturerConsultation, body: Record<string, unknown>, done: string) => {
    setBusy(item.id);
    try { await lecturerApi.updateConsultation(item.id, body); notify('success', done); load(); }
    catch (error) { notify('error', errorText(error)); } finally { setBusy(''); }
  };
  const note = async (item: LecturerConsultation) => {
    const text = await promptDialog({ title: 'ملاحظات الجلسة', message: item.clientName, defaultValue: item.notes, confirmLabel: 'حفظ' });
    if (text !== null) await update(item, { notes: text }, 'اتحفظت الملاحظة');
  };
  const link = async (item: LecturerConsultation) => {
    const text = await promptDialog({ title: 'رابط الجلسة', message: 'رابط Zoom أو Meet اللي هتقابل عليه العميل', defaultValue: item.meetingLink, placeholder: 'https://…', confirmLabel: 'حفظ' });
    if (text !== null) await update(item, { meetingLink: text.trim() }, 'اتحفظ الرابط');
  };

  if (!rows) return <Loading />;
  return (
    <Card title="استشاراتي">
      {rows.length === 0 ? <Empty>مفيش استشارات لسه. أي حجز جديد هيوصلك إشعار على السيستم والواتساب.</Empty> : (
        <div className="space-y-3">
          {rows.map(item => {
            const status = STATUS[item.status] || { label: item.status, cls: 'bg-gray-100 text-gray-700' };
            const open = item.status === 'pending' || item.status === 'confirmed';
            return (
              <div key={item.id} className="rounded-2xl border border-gray-200 bg-gray-50/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    <p className="font-bold text-gray-900">{item.clientName} <span className="text-xs font-normal text-gray-500">· {KIND[item.sessionType] || item.sessionType}</span></p>
                    <ConsultationTimingBadge item={{ source: item.source || undefined, sessionDate: item.sessionDate, createdAt: item.createdAt }} />
                    <p className="text-xs text-gray-500">
                      {item.clientPhone && <span dir="ltr" className="ml-2">{item.clientPhone}</span>}
                      {item.clientPhone && item.amount ? ' · ' : ''}
                      {item.amount ? `${item.amount} ${item.currency || 'EGP'}` : ''}{item.paid ? ' · مدفوعة' : item.amount ? ' · لسه ما اتدفعتش' : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${status.cls}`}>{status.label}</span>
                    {item.status === 'pending' && <button type="button" disabled={busy === item.id} onClick={() => void update(item, { status: 'CONFIRMED' }, 'اتأكدت')} className="rounded-xl bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 disabled:opacity-50">تأكيد</button>}
                    {open && <button type="button" disabled={busy === item.id} onClick={() => void update(item, { status: 'COMPLETED' }, 'اتسجلت إنها تمت')} className="rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 disabled:opacity-50">تمت</button>}
                    {open && <button type="button" disabled={busy === item.id} onClick={() => void update(item, { status: 'CANCELLED' }, 'اتلغت')} className="rounded-xl bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 disabled:opacity-50">إلغاء</button>}
                    <button type="button" aria-label="رابط الجلسة" title="رابط الجلسة" onClick={() => void link(item)} className="rounded-xl border border-gray-200 bg-white p-2 text-gray-600"><Link2 size={14} /></button>
                    <button type="button" aria-label="ملاحظات" title="ملاحظات" onClick={() => void note(item)} className="rounded-xl border border-gray-200 bg-white p-2 text-gray-600"><Pencil size={14} /></button>
                    {item.meetingLink && <a href={item.meetingLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-xl bg-primary-600 px-3 py-1.5 text-xs font-bold text-white"><ExternalLink size={12} /> فتح الجلسة</a>}
                  </div>
                </div>
                {item.notes && <p className="mt-3 rounded-xl border border-gray-100 bg-white p-3 text-sm text-gray-600">{item.notes}</p>}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
