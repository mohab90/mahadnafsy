import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { UserPlus, RefreshCw, UserCheck, UserX, Trash2, ExternalLink, Lock } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import type { RegistrationItem } from '../../../lib/mysqlapi';
import { useBranches } from '../../../hooks/useBranches';
import PaymentModal, { type PaymentDraft } from '../../../components/PaymentModal';
import { createClientPaymentDraft } from '../../../lib/clientActionDrafts';
import { currencyForBranch } from '../../../lib/branchCurrency';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }


// Self-registered accounts (/api/user/signup) that staff haven't triaged yet
// — neither a CRM lead nor an online client. Two explicit outcomes per row:
// promote to a paying-track online client, or send to the CRM as a lead.
// Table styling matches LeadTable.tsx (bordered cells, sticky actions col)
// so this reads as the same family of screen, not a bolted-on one-off.
const RegistrationsTab: React.FC<Props> = ({ notify }) => {
  const branchOptions = useBranches();
  const { courses, bundles } = useSiteData();
  const [rows, setRows] = useState<RegistrationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bookingRow, setBookingRow] = useState<RegistrationItem | null>(null);
  // The shared PaymentDraft, so this dialog is the same one used to record a
  // payment anywhere else in the dashboard — same fields, same validation.
  const [draft, setDraft] = useState<PaymentDraft>(() => createClientPaymentDraft({ branch: 'ONLINE_EGYPT' }));
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    mysqlAdmin.listRegistrations()
      .then(setRows)
      .catch(err => notify('error', err instanceof Error ? err.message : 'تعذر تحميل التسجيلات'))
      .finally(() => setLoading(false));
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const toLead = async (row: RegistrationItem) => {
    setBusyId(row.id);
    try {
      await mysqlAdmin.convertRegistrationToLead(row.id);
      notify('success', 'تم الإرجاع لعميل محتمل');
      setRows(prev => prev.filter(r => r.id !== row.id));
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذّر التحويل');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (row: RegistrationItem) => {
    if (!window.confirm(`حذف تسجيل "${row.name || row.phone || row.email}" نهائيًا؟`)) return;
    setBusyId(row.id);
    try {
      await mysqlAdmin.deleteRegistration(row.id);
      notify('success', 'تم الحذف');
      setRows(prev => prev.filter(r => r.id !== row.id));
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذّر الحذف');
    } finally {
      setBusyId(null);
    }
  };

  const openBooking = (row: RegistrationItem) => {
    const branch = row.origin === 'دولي' ? 'ONLINE_ABROAD' : 'ONLINE_EGYPT';
    setDraft(createClientPaymentDraft({
      branch, currency: currencyForBranch(branch), email: row.email || '',
    }));
    setBookingRow(row);
  };

  const submitBooking = async (paid: PaymentDraft) => {
    if (!bookingRow) return;
    setSubmitting(true);
    try {
      const branch = paid.branch || 'ONLINE_EGYPT';
      const { subscriberId } = await mysqlAdmin.convertRegistrationToOnline(bookingRow.id, branch);
      // courseId carries the shared modal's `bundle:<id>` convention.
      const isBundle = (paid.courseId || '').startsWith('bundle:');
      await mysqlAdmin.saveSubscriberPayment(subscriberId, {
        amount: paid.amount,
        currency: paid.currency,
        paymentType: paid.paymentType || 'course',
        courseId: isBundle ? undefined : (paid.courseId || undefined),
        bundleId: isBundle ? paid.courseId.replace('bundle:', '') : undefined,
        paymentMethod: paid.paymentMethod,
        note: paid.note || undefined,
        status: 'paid',
      });
      notify('success', 'تم التحويل لعميل أونلاين وتسجيل الحجز');
      setRows(prev => prev.filter(r => r.id !== bookingRow.id));
      setBookingRow(null);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذّر إتمام الحجز');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <UserPlus size={22} className="text-primary-600" />
            التسجيلات
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            حسابات سجّلت بنفسها ولسه معملتش أي حاجة — مش عميل محتمل ومش عميل أونلاين. حوّلها للاتجاه الصح.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          تحديث
        </button>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-gray-100 bg-white py-10 text-center text-sm font-bold text-gray-400">
          جاري التحميل...
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white py-10 text-center text-sm text-gray-400">
          لا توجد تسجيلات بانتظار التصنيف حاليًا.
        </div>
      ) : (
        <div className="overflow-auto rounded-xl" style={{ maxHeight: '70vh', direction: 'rtl' }}>
          <table className="w-full min-w-[900px] text-sm border-collapse table-fixed">
            <thead>
              <tr className="bg-gray-50 text-gray-700 text-xs">
                <th className="text-right px-3 py-2.5 border border-gray-200 font-semibold">الاسم</th>
                <th className="text-right px-3 py-2.5 border border-gray-200 font-semibold">البريد الإلكتروني</th>
                <th className="text-right px-3 py-2.5 border border-gray-200 font-semibold">رقم الهاتف</th>
                <th className="text-right px-3 py-2.5 border border-gray-200 font-semibold w-24">فاتح منين</th>
                <th className="text-right px-3 py-2.5 border border-gray-200 font-semibold w-32">تاريخ التسجيل</th>
                <th className="text-right px-3 py-2.5 border border-gray-200 font-semibold w-32">كلمة المرور</th>
                <th className="text-right px-3 py-2.5 border border-gray-200 font-semibold sticky left-0 bg-gray-50 z-10 w-[190px]">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={r.id} className={`hover:bg-primary-50/30 transition-colors ${idx % 2 === 1 ? 'bg-gray-50/70' : 'bg-white'}`}>
                  <td className="px-3 py-2 border border-gray-200 text-xs font-bold text-gray-800">{r.name || '—'}</td>
                  <td className="px-3 py-2 border border-gray-200 text-xs text-gray-600" dir="ltr">{r.email || '—'}</td>
                  <td className="px-3 py-2 border border-gray-200 text-xs text-gray-600" dir="ltr">{r.phone || '—'}</td>
                  <td className="px-3 py-2 border border-gray-200 text-xs">
                    {r.origin ? (
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${r.origin === 'محلي' ? 'bg-indigo-100 text-indigo-800' : 'bg-teal-100 text-teal-800'}`}>
                        {r.origin === 'محلي' ? '🇪🇬 محلي' : '🌍 دولي'}
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 border border-gray-200 text-[11px] text-gray-500 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString('ar-EG')}
                  </td>
                  <td className="px-3 py-2 border border-gray-200 text-[11px] text-gray-400">
                    <span className="inline-flex items-center gap-1" title="كلمات المرور مشفّرة (bcrypt) ولا يمكن عرضها لأي طرف — حتى الإدارة. لو العميل محتاج مساعدة، يستخدم نسيت كلمة المرور من صفحة الدخول.">
                      <Lock size={11} /> مشفّرة
                    </span>
                  </td>
                  <td className={`px-1 py-1 border border-gray-200 sticky left-0 z-10 ${idx % 2 === 1 ? 'bg-gray-50/70' : 'bg-white'}`}>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openBooking(r)}
                        disabled={busyId === r.id}
                        title="حجز كورس وتحويل لعميل أونلاين"
                        className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition disabled:opacity-40"
                      >
                        <UserCheck size={13} /> أونلاين
                      </button>
                      <button
                        onClick={() => toLead(r)}
                        disabled={busyId === r.id}
                        title="عميل محتمل"
                        className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-bold bg-amber-50 text-amber-700 hover:bg-amber-100 transition disabled:opacity-40"
                      >
                        <UserX size={13} /> محتمل
                      </button>
                      <button
                        onClick={() => remove(r)}
                        disabled={busyId === r.id}
                        title="حذف نهائي"
                        className="h-7 w-7 rounded-md text-gray-300 hover:text-red-500 flex items-center justify-center transition disabled:opacity-40"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Booking confirmation before converting to an online client — uses the
          SHARED PaymentModal, the same dialog as recording a payment anywhere
          else. It used to be a bespoke form with its own fields and its own
          look, which is what made this page feel like a different system. */}
      {bookingRow && (
        <PaymentModal
          mode="subscriber"
          subject={{
            id: bookingRow.id,
            name: bookingRow.name || bookingRow.phone || bookingRow.email || 'عميل',
            phone: bookingRow.phone || '',
            email: bookingRow.email || '',
            branch: draft.branch,
          }}
          draft={draft}
          setDraft={setDraft}
          onSubmit={(paid) => submitBooking(paid)}
          onClose={() => { if (!submitting) setBookingRow(null); }}
          // Was a hardcoded label map, so this screen offered a different set of
          // branches from every other screen opening the same dialog.
          branchOptions={branchOptions}
        />
      )}
    </div>
  );
};

export default RegistrationsTab;
