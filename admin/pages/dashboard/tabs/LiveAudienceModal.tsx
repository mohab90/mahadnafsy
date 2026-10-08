import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../../../../shared/ui/Modal';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { cairoDateTime } from '../../../../shared/cairoDate';

// Who a live is for — the course's clients who paid 90% and did not attend a live
// of it before (api/lib/liveStreams.js) — who came, and «إعادة الإشعار».
type Audience = {
  invited: number; unpaid: number; attendedBefore: number; targeted: boolean; announcedAt: string | null;
  attendees: Array<{ subscriberId: string; name: string; phone: string; clientCode: string | null; joinedAt: string; via: string }>;
};
type Announced = { instructorTold: boolean; clients: number; noPhone: number; unpaid: number; attended: number; targeted: boolean };

export function LiveAudienceModal({ streamId, title, onClose, notify }: {
  streamId: string; title: string; onClose: () => void;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}) {
  const [audience, setAudience] = useState<Audience | null>(null);
  const [sending, setSending] = useState(false);
  const load = useCallback(() => {
    mysqlAdmin.adminGet<Audience>(`/admin/live-streams/${encodeURIComponent(streamId)}/audience`)
      .then(setAudience).catch(error => notify('error', error instanceof Error ? error.message : 'تعذر التحميل'));
  }, [streamId, notify]);
  useEffect(() => { load(); }, [load]);

  const announce = async () => {
    setSending(true);
    try {
      const result = await mysqlAdmin.adminPost<Announced>(`/admin/live-streams/${encodeURIComponent(streamId)}/announce`, {});
      notify('success', `${result.instructorTold ? 'اتبعت للمحاضر · ' : ''}اتبعت لـ ${result.clients} عميل على الواتساب${result.noPhone ? ` (${result.noPhone} من غير رقم)` : ''}`);
      load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر الإرسال');
    } finally { setSending(false); }
  };

  return (
    <Modal open onClose={onClose} title="الإشعار والحضور" subtitle={title} size="lg">
      {!audience ? <p className="py-8 text-center text-sm text-gray-400">جاري التحميل…</p> : (
        <div className="space-y-4" dir="rtl">
          {!audience.targeted && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              الإشعار للعملاء بيروح بس لما تختار «مشتركين كورسات محددة» وتحدد الكورس — المحاضر بيتبلّغ في كل الأحوال.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['هيتبعتلهم', audience.invited, 'border-emerald-200 bg-emerald-50 text-emerald-800'],
              ['حضروا اللايف ده', audience.attendees.length, 'border-blue-200 bg-blue-50 text-blue-800'],
              ['لسه مدفعوش 90%', audience.unpaid, 'border-amber-200 bg-amber-50 text-amber-800'],
              ['حضروا لايف قبل كده', audience.attendedBefore, 'border-gray-200 bg-gray-50 text-gray-700'],
            ].map(([label, value, cls]) => (
              <div key={String(label)} className={`rounded-xl border px-3 py-2 ${cls}`}>
                <p className="text-[11px] font-bold">{label}</p>
                <p className="text-xl font-black">{value}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-gray-500">{audience.announcedAt ? `آخر إشعار: ${cairoDateTime(audience.announcedAt)}` : 'لسه مفيش إشعار اتبعت'}</p>
            <button disabled={sending} onClick={() => void announce()} className="rounded-xl bg-primary-600 px-4 py-2 text-xs font-bold text-white hover:bg-primary-700 disabled:opacity-50">
              {sending ? '⏳…' : audience.announcedAt ? 'إعادة الإشعار (للي ما اتبعتلوش)' : 'ابعت الإشعار'}
            </button>
          </div>
          {audience.attendees.length > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-xl border border-gray-200">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500"><tr><th className="px-3 py-2 text-right">العميل</th><th className="px-3 py-2 text-right">دخل</th><th className="px-3 py-2 text-right">من</th></tr></thead>
                <tbody>
                  {audience.attendees.map(row => (
                    <tr key={row.subscriberId} className="border-t border-gray-100">
                      <td className="px-3 py-1.5"><div className="font-bold">{row.name}</div><div className="text-[10px] text-gray-400" dir="ltr">{row.phone}</div></td>
                      <td className="px-3 py-1.5 text-gray-500">{cairoDateTime(row.joinedAt)}</td>
                      <td className="px-3 py-1.5 text-gray-500">{row.via === 'site' ? 'الموقع' : 'لينك الواتساب'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
