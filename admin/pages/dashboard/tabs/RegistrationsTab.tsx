import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { UserPlus, RefreshCw, UserCheck, UserX, Trash2, ExternalLink, Lock } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import type { RegistrationItem } from '../../../lib/mysqlapi';
import { BRANCH_ENUM_LABELS } from './leadUtils';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }

type BookingDraft = {
  branch: string;
  itemId: string; // courseId, or 'bundle:<id>'
  amount: string;
  currency: 'EGP' | 'SAR' | 'USD';
  paymentMethod: string;
  note: string;
};

const blankBooking = (branch: string): BookingDraft => ({
  branch,
  itemId: '',
  amount: '',
  currency: branch === 'ONLINE_SAUDI' ? 'SAR' : 'EGP',
  paymentMethod: '',
  note: '',
});

// Self-registered accounts (/api/user/signup) that staff haven't triaged yet
// — neither a CRM lead nor an online client. Two explicit outcomes per row:
// promote to a paying-track online client, or send to the CRM as a lead.
// Table styling matches LeadTable.tsx (bordered cells, sticky actions col)
// so this reads as the same family of screen, not a bolted-on one-off.
const RegistrationsTab: React.FC<Props> = ({ notify }) => {
  const { courses, bundles } = useSiteData();
  const [rows, setRows] = useState<RegistrationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bookingRow, setBookingRow] = useState<RegistrationItem | null>(null);
  const [draft, setDraft] = useState<BookingDraft>(blankBooking('ONLINE_EGYPT'));
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
    setDraft(blankBooking(branch));
    setBookingRow(row);
  };

  const itemPrice = useMemo(() => {
    if (!draft.itemId) return 0;
    if (draft.itemId.startsWith('bundle:')) {
      const b = bundles.find(x => x.id === draft.itemId.replace('bundle:', ''));
      return (b?.price as unknown as Record<string, number>)?.[draft.currency] || 0;
    }
    const c = courses.find(x => x.id === draft.itemId);
    return (c?.price as unknown as Record<string, number>)?.[draft.currency] || 0;
  }, [draft.itemId, draft.currency, courses, bundles]);

  const submitBooking = async () => {
    if (!bookingRow) return;
    const amount = Number(draft.amount);
    if (!draft.itemId) { notify('error', 'اختر الكورس أو المسار الأول'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { notify('error', 'أدخل مبلغ صحيح'); return; }
    if (!draft.paymentMethod) { notify('error', 'اختر وسيلة الدفع'); return; }
    setSubmitting(true);
    try {
      const { subscriberId } = await mysqlAdmin.convertRegistrationToOnline(bookingRow.id, draft.branch);
      const isBundle = draft.itemId.startsWith('bundle:');
      await mysqlAdmin.saveSubscriberPayment(subscriberId, {
        amount: draft.amount,
        currency: draft.currency,
        paymentType: 'course',
        courseId: isBundle ? undefined : draft.itemId,
        bundleId: isBundle ? draft.itemId.replace('bundle:', '') : undefined,
        paymentMethod: draft.paymentMethod,
        note: draft.note || undefined,
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

      {/* ── Booking confirmation modal — required before converting to an online client ── */}
      {bookingRow && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => !submitting && setBookingRow(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" dir="rtl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-1 flex items-center gap-2">
              <ExternalLink size={18} className="text-emerald-600" />
              تأكيد الحجز — {bookingRow.name || bookingRow.phone}
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              محتاجين نتأكد الكورس والمبلغ قبل ما نحوّله لعميل أونلاين — ده بيسجّل حجز ودفعة حقيقية.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-gray-700 mb-1 block">الفرع</label>
                <select value={draft.branch} onChange={e => setDraft(d => ({ ...d, branch: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  {Object.entries(BRANCH_ENUM_LABELS).map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-700 mb-1 block">الكورس / المسار *</label>
                <select value={draft.itemId} onChange={e => setDraft(d => ({ ...d, itemId: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="">— اختر —</option>
                  {bundles.length > 0 && (
                    <optgroup label="📌 المسارات">
                      {bundles.map(b => <option key={b.id} value={`bundle:${b.id}`}>{b.title}</option>)}
                    </optgroup>
                  )}
                  <optgroup label="🎓 الكورسات">
                    {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </optgroup>
                </select>
                {itemPrice > 0 && <p className="text-[11px] text-gray-400 mt-1">السعر المعتمد: {itemPrice.toLocaleString()} {draft.currency}</p>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-bold text-gray-700 mb-1 block">المبلغ المدفوع *</label>
                  <input type="number" min="0" value={draft.amount} onChange={e => setDraft(d => ({ ...d, amount: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="0" />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-700 mb-1 block">العملة</label>
                  <select value={draft.currency} onChange={e => setDraft(d => ({ ...d, currency: e.target.value as BookingDraft['currency'] }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    <option value="EGP">جنيه مصري</option>
                    <option value="SAR">ريال سعودي</option>
                    <option value="USD">دولار</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-700 mb-1 block">وسيلة الدفع *</label>
                <select value={draft.paymentMethod} onChange={e => setDraft(d => ({ ...d, paymentMethod: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="">— اختر —</option>
                  <option value="فودافون كاش">فودافون كاش</option>
                  <option value="تحويل بنكي">تحويل بنكي</option>
                  <option value="فيزا">فيزا / بطاقة</option>
                  <option value="كاش">كاش</option>
                  <option value="أخرى">أخرى</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-700 mb-1 block">ملاحظة</label>
                <textarea rows={2} value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={submitBooking} disabled={submitting}
                  className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 disabled:opacity-50">
                  {submitting ? 'جارٍ الحفظ...' : 'تأكيد وتحويل لعميل أونلاين'}
                </button>
                <button onClick={() => setBookingRow(null)} disabled={submitting}
                  className="flex-1 py-2.5 bg-gray-200 text-gray-700 rounded-xl text-sm hover:bg-gray-300 disabled:opacity-50">إلغاء</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RegistrationsTab;
