import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, Calculator, Loader2, Save } from 'lucide-react';
import { mysqlAdmin, type BonusAdjustmentKind, type BonusPlan, type MonthlyBonuses } from '../../../../lib/mysqlapi';
import HrSalesSheetReconcile from './HrSalesSheetReconcile';
import HrCollectionSheetReconcile from './HrCollectionSheetReconcile';
import HrLateBookings from './HrLateBookings';
import HrPayrollCommissionCard from './HrPayrollCommissionCard';
import { forgetBonusPlan } from './BonusSchemeFields';
import { cairoDateTime, cairoMonthOnly } from '../../../../../shared/cairoDate';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;
type Item = { kind: 'course' | 'track'; id: string; title: string; priceEgp: number; weight: number };
/** A change to the month being written: what it is about, and the reason (required). */
type Draft = { kind: BonusAdjustmentKind; label: string; staffId?: string; paymentId?: string; round?: number; toStaffId: string; weight: string; amount: string; splitDay: string; reason: string };

const n = (value: number | null | undefined) => (value == null ? '—' : Number(value).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 2 }));
const input = 'w-24 rounded-lg border border-gray-200 px-2 py-1 text-sm';
const lastMonth = () => {
  const [year, month] = cairoMonthOnly().split('-').map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
};

/**
 * «نظام المكافآت» (api/lib/bonusPlan.js, api/lib/monthlyBonuses.js): the rules as the institute keeps them — how many bookings a course counts as by its price,
 * the booking ladder and the bookings past a tier — each course's booking count at its price, and a month's bonuses worked out from the payments. Saving the
 * month writes one bonus per employee awaiting approval («اعتمادات المرتبات»); nothing is paid before it is approved.
 */
export default function HrBonusPlanPanel({ notify, canEditPlan }: { notify: Notify; canEditPlan: boolean }) {
  const [plan, setPlan] = useState<BonusPlan | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [savingPlan, setSavingPlan] = useState(false);
  const [month, setMonth] = useState(lastMonth);
  const [result, setResult] = useState<MonthlyBonuses | null>(null);
  const [working, setWorking] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [taking, setTaking] = useState<{ id: string; reason: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const answer = await mysqlAdmin.getBonusPlan();
      setPlan(answer.plan);
      setItems(answer.items);
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذّر تحميل نظام المكافآت'); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const edit = <K extends keyof BonusPlan>(key: K, rows: BonusPlan[K]) => setPlan(p => (p ? { ...p, [key]: rows } : p));
  const savePlan = async () => {
    if (!plan) return;
    setSavingPlan(true);
    try {
      await mysqlAdmin.saveBonusPlan(plan);
      forgetBonusPlan();
      notify('success', 'اتحفظ نظام المكافآت');
      await load();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذّر الحفظ'); } finally { setSavingPlan(false); }
  };

  const work = async () => {
    setWorking(true);
    try { setResult(await mysqlAdmin.getMonthlyBonuses(month)); } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذّر الحساب'); } finally { setWorking(false); }
  };
  const saveMonth = async () => {
    setWorking(true);
    try {
      const saved = await mysqlAdmin.saveMonthlyBonuses(month);
      const kept = saved.kept.length ? ` — ${saved.kept.length} معتمدة قبل كده ما اتغيرتش (${saved.kept.map(k => `${k.name}: ${n(k.amount)}، المحسوب دلوقتي ${n(k.now)}`).join('، ')})` : '';
      notify('success', `اتسجلت ${saved.written.length} مكافأة مستنية الاعتماد في «اعتمادات المرتبات»${kept}`);
      await work();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذّر التسجيل'); } finally { setWorking(false); }
  };

  // The owner's changes to the month (manage_financial): written with a reason, the month worked out again with them, taken back the same way.
  const startDraft = (kind: BonusAdjustmentKind, label: string, ids: { staffId?: string; paymentId?: string; round?: number }, preset: Partial<Draft> = {}) =>
    setDraft({ kind, label, ...ids, toStaffId: '', weight: '', amount: '', splitDay: '', reason: '', ...preset });
  const submitDraft = async () => {
    if (!draft) return;
    if (draft.reason.trim().length < 3) { notify('error', 'اكتب سبب التعديل'); return; }
    setWorking(true);
    try {
      await mysqlAdmin.addBonusAdjustment({
        month, kind: draft.kind, reason: draft.reason.trim(), staffId: draft.staffId, paymentId: draft.paymentId, round: draft.kind === 'ROUND_OVERRIDE' ? draft.round : undefined,
        toStaffId: draft.kind === 'REASSIGN_BOOKING' ? draft.toStaffId : undefined,
        splitDay: draft.kind === 'ROUND_SPLIT' ? Number(draft.splitDay) : undefined,
        weight: draft.kind === 'WEIGHT_BOOKING' ? Number(draft.weight) : undefined, amount: draft.kind === 'TOTAL_OVERRIDE' || draft.kind === 'ROUND_OVERRIDE' ? Number(draft.amount) : undefined,
      });
      setDraft(null);
      notify('success', 'اتسجّل التعديل واتحسب الشهر من جديد');
      setResult(await mysqlAdmin.getMonthlyBonuses(month));
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذّر التعديل'); } finally { setWorking(false); }
  };
  const takeBack = async (id: string, reason: string) => {
    setWorking(true);
    try {
      await mysqlAdmin.revokeBonusAdjustment(id, reason);
      setTaking(null);
      notify('success', 'اتلغى التعديل');
      setResult(await mysqlAdmin.getMonthlyBonuses(month));
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذّر الإلغاء'); } finally { setWorking(false); }
  };

  const weightRows = useMemo(() => plan?.bookingWeights ?? [], [plan]);
  if (!plan) return <div className="flex items-center justify-center gap-2 p-8 text-sm text-gray-400"><Loader2 size={16} className="animate-spin" /> جاري التحميل…</div>;
  const disabled = !canEditPlan;

  return (
    <div className="space-y-5" dir="rtl">
      <HrPayrollCommissionCard notify={notify} canEdit={canEditPlan} />

      {/* ── The month ── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-extrabold text-gray-900"><Calculator size={16} className="text-indigo-600" /> حساب مكافآت الشهر</h3>
        <div className="flex flex-wrap items-center gap-2">
          <input type="month" dir="ltr" value={month} onChange={e => setMonth(e.target.value)} className="rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          <button type="button" onClick={work} disabled={working} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{working ? 'بيحسب…' : 'احسب'}</button>
          {result && result.plan.salesPeriod === 'HALF_MONTH' && (
            <span className="flex items-center gap-1.5 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-700">
              الروند التاني للكل بيبدأ يوم <b>{result.splitDay}</b>{result.splitDay === 16 && ' (الأساسي)'}
              {canEditPlan && <button type="button" className="font-bold text-indigo-600" onClick={() => startDraft('ROUND_SPLIT', 'يوم بداية الروند التاني لكل السيلز في الشهر ده', {}, { splitDay: String(result.splitDay) })}>غيّر</button>}
            </span>
          )}
          {result && result.employees.some(item => item.total > 0) && (
            <button type="button" onClick={saveMonth} disabled={working} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
              سجّلها مكافآت مستنية الاعتماد
            </button>
          )}
        </div>
        {result && (
          <div className="mt-4 overflow-x-auto">
            {result.employees.length === 0 ? (
              <p className="text-sm text-gray-500">مفيش موظف متحدد له نظام مكافأة. حدده من «بيانات الموظفين» (نظام المكافأة وأول خطوة) أو من ملف الموظف.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr><th className="p-2 text-right">الموظف</th><th className="p-2 text-right">النظام</th><th className="p-2 text-right">الحساب</th><th className="p-2 text-right">المكافأة</th></tr>
                </thead>
                <tbody>
                  {result.employees.map(item => (
                    <React.Fragment key={item.staffId}>
                      <tr className="border-t border-gray-100">
                        <td className="p-2 font-bold">
                          <button type="button" onClick={() => setOpen(open === item.staffId ? null : item.staffId)} className="text-right hover:underline">{item.name}</button>
                        </td>
                        <td className="p-2 text-xs text-gray-600">
                          {item.schemeLabel}
                          {item.splitDay != null && (
                            <div className="text-[11px] text-gray-500">
                              الروند التاني من يوم {item.splitDay}{item.splitSource === 'rep' && ' (استثناء ليه)'}
                              {canEditPlan && <button type="button" className="mr-1 font-bold text-indigo-600" onClick={() => startDraft('ROUND_SPLIT', `استثناء: يوم بداية الروند التاني لـ${item.name} (بدل تقسيم الشهر)`, { staffId: item.staffId }, { splitDay: String(item.splitDay) })}>غيّر</button>}
                            </div>
                          )}
                        </td>
                        <td className="p-2 text-xs text-gray-700">{item.summary}</td>
                        <td className="p-2 font-extrabold text-emerald-700">
                          {n(item.total)}
                          {item.override && <span className="mr-1 text-[11px] font-normal text-gray-400 line-through" title="المحسوب من السيستم">{n(item.computedTotal)}</span>}
                          {item.override && <span className="mr-1 rounded bg-amber-50 px-1 text-[10px] font-bold text-amber-700" title={item.override.reason}>معدّل</span>}
                          {canEditPlan && (
                            <button type="button" className="mr-2 text-[11px] font-bold text-indigo-600"
                              onClick={() => startDraft('TOTAL_OVERRIDE', `إجمالي مكافأة ${item.name} (المحسوب ${n(item.computedTotal)})`, { staffId: item.staffId }, { amount: String(item.total) })}>عدّل الإجمالي</button>
                          )}
                        </td>
                      </tr>
                      {open === item.staffId && item.bookings.length > 0 && (
                        <tr><td colSpan={4} className="bg-gray-50 p-2">
                          {canEditPlan && item.ladder?.rounds && item.ladder.rounds.length > 1 && (
                            <p className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                              {item.ladder.rounds.map(round => (
                                <span key={round.round} className="rounded-lg bg-white px-2 py-1 ring-1 ring-gray-200">
                                  الروند {round.label}: {n(round.bookings)} حجز ← <b>{n(round.amount)}</b>
                                  {round.override && <span className="mr-1 text-gray-400 line-through" title="المحسوب من السيستم">{n(round.computedAmount)}</span>}
                                  <button type="button" className="mr-2 font-bold text-indigo-600" onClick={() => startDraft('ROUND_OVERRIDE', `مكافأة ${item.name} في الروند ${round.label} (المحسوب ${n(round.computedAmount)})`, { staffId: item.staffId, round: round.round }, { amount: String(round.amount) })}>عدّل</button>
                                </span>
                              ))}
                            </p>
                          )}
                          <table className="w-full text-xs">
                            <thead className="text-gray-500"><tr><th className="p-1 text-right">اليوم</th>{item.ladder?.rounds && item.ladder.rounds.length > 1 && <th className="p-1 text-right">الروند</th>}<th className="p-1 text-right">العميل</th><th className="p-1 text-right">الكورس / المسار</th><th className="p-1 text-right">السعر</th><th className="p-1 text-right">بالمصري</th><th className="p-1 text-right">{item.scheme === 'SALES_BOOKINGS' ? 'يتحسب حجز' : 'مكافأة الكورس'}</th>{canEditPlan && <th className="p-1 text-right">تعديل</th>}</tr></thead>
                            <tbody>
                              {item.bookings.map(booking => (
                                <tr key={booking.paymentId} className="border-t border-gray-100">
                                  <td className="p-1" dir="ltr">{booking.day}{booking.movedIn && <span className="mr-1 rounded bg-sky-50 px-1 text-[10px] font-bold text-sky-700" title="الدفعة نفسها ما اتغيرتش">اتدفع {booking.movedIn.paidDay}</span>}</td>{item.ladder?.rounds && item.ladder.rounds.length > 1 && <td className="p-1">{booking.round}</td>}<td className="p-1">{booking.client} {booking.clientCode && <span className="text-gray-400">({booking.clientCode})</span>}</td>
                                  <td className="p-1">{booking.title}</td><td className="p-1">{n(booking.price)} {booking.currency}</td><td className="p-1">{n(booking.priceEgp)}</td>
                                  <td className="p-1 font-bold">
                                    {item.scheme === 'SALES_BOOKINGS' ? n(booking.weight) : n(booking.deskBonus)}
                                    {booking.computedWeight != null && <span className="mr-1 font-normal text-gray-400 line-through" title="المحسوب من السعر">{n(booking.computedWeight)}</span>}
                                  </td>
                                  {canEditPlan && (
                                    <td className="p-1 whitespace-nowrap">
                                      <button type="button" className="ml-2 font-bold text-rose-600" onClick={() => startDraft('EXCLUDE_BOOKING', `استبعاد حجز ${booking.client} من ${item.name}`, { staffId: item.staffId, paymentId: booking.paymentId })}>استبعد</button>
                                      {item.scheme === 'SALES_BOOKINGS' && <button type="button" className="ml-2 font-bold text-indigo-600" onClick={() => startDraft('REASSIGN_BOOKING', `نقل حجز ${booking.client} من ${item.name}`, { paymentId: booking.paymentId })}>انقل</button>}
                                      {item.scheme === 'SALES_BOOKINGS' && <button type="button" className="font-bold text-amber-700" onClick={() => startDraft('WEIGHT_BOOKING', `عدد الحجوزات اللي حجز ${booking.client} بيتحسب بيها`, { paymentId: booking.paymentId }, { weight: String(booking.weight ?? '') })}>العدد</button>}
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {item.excludedBookings.length > 0 && (
                            <p className="mt-1 text-[11px] text-rose-700">مستبعد من حسابه: {item.excludedBookings.map(b => `${b.client} (${b.title})`).join('، ')}</p>
                          )}
                        </td></tr>
                      )}
                    </React.Fragment>
                  ))}
                  <tr className="border-t-2 border-gray-200 font-extrabold"><td className="p-2" colSpan={3}>الإجمالي</td><td className="p-2 text-emerald-700">{n(result.total)}</td></tr>
                </tbody>
              </table>
            )}
            {result.movedOut && result.movedOut.length > 0 && (
              <p className="mt-2 text-[11px] text-sky-800">اتدفعت في الشهر ده واتحسبت في شهر تاني للسيلز: {result.movedOut.map(b => `${b.client} (${b.title}) ← ${b.staffName || '—'} في ${b.countedElsewhere?.month}`).join('، ')}</p>
            )}
            <p className="mt-2 text-[11px] text-gray-500">
              الحجز = أول دفعة مدفوعة للعميل في الكورس أو المسار في الشهر، بسعر العميل المتفق عليه محوّل للمصري بسعر الصرف وقت الدفعة. التحصيل = فلوس الكورسات والمسارات اللي سجّلها الموظف (مش الشهادات).
              «سجّلها» بتعمل مكافأة واحدة لكل موظف مستنية الاعتماد؛ لو اتحسبت تاني قبل الاعتماد بتتبدّل، والمعتمدة ما بتتغيرش.
            </p>
            {draft && (
              <div className="mt-3 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs">
                <div className="font-extrabold text-amber-900">{draft.label}</div>
                <div className="flex flex-wrap items-center gap-2">
                  {draft.kind === 'REASSIGN_BOOKING' && (
                    <select value={draft.toStaffId} onChange={e => setDraft({ ...draft, toStaffId: e.target.value })} className="rounded-lg border border-gray-200 bg-white px-2 py-1">
                      <option value="">اختار السيلز اللي الحجز يتحسب له</option>
                      {result.employees.filter(e => e.scheme === 'SALES_BOOKINGS').map(e => <option key={e.staffId} value={e.staffId}>{e.name}</option>)}
                    </select>
                  )}
                  {draft.kind === 'WEIGHT_BOOKING' && <label>يتحسب <input type="number" min="0" max="20" step="0.5" dir="ltr" value={draft.weight} onChange={e => setDraft({ ...draft, weight: e.target.value })} className="w-20 rounded-lg border border-gray-200 px-2 py-1" /> حجز</label>}
                  {draft.kind === 'ROUND_SPLIT' && <label>الروند التاني يبدأ يوم <input type="number" min="2" max="28" step="1" dir="ltr" value={draft.splitDay} onChange={e => setDraft({ ...draft, splitDay: e.target.value })} className="w-16 rounded-lg border border-gray-200 px-2 py-1" /></label>}
                  {draft.kind === 'ROUND_OVERRIDE' && <label>مكافأة الروند <input type="number" min="0" dir="ltr" value={draft.amount} onChange={e => setDraft({ ...draft, amount: e.target.value })} className="w-28 rounded-lg border border-gray-200 px-2 py-1" /> ج.م</label>}
                  {draft.kind === 'TOTAL_OVERRIDE' && <label>الإجمالي <input type="number" min="0" dir="ltr" value={draft.amount} onChange={e => setDraft({ ...draft, amount: e.target.value })} className="w-28 rounded-lg border border-gray-200 px-2 py-1" /> ج.م</label>}
                  <input value={draft.reason} onChange={e => setDraft({ ...draft, reason: e.target.value })} placeholder="السبب (مطلوب)" maxLength={500} className="min-w-[14rem] flex-1 rounded-lg border border-gray-200 px-2 py-1" />
                  <button type="button" onClick={submitDraft} disabled={working || draft.reason.trim().length < 3} className="rounded-lg bg-amber-600 px-3 py-1 font-bold text-white disabled:opacity-40">نفّذ</button>
                  <button type="button" onClick={() => setDraft(null)} className="rounded-lg border border-gray-200 bg-white px-3 py-1 font-bold">إلغاء</button>
                </div>
              </div>
            )}
            {canEditPlan && <HrLateBookings month={month} notify={notify} onChanged={() => void work()} />}
            {result.adjustments.length > 0 && (
              <div className="mt-4">
                <h4 className="mb-1 text-xs font-extrabold text-gray-800">تعديلات الشهر (المحسوب من السيستم {n(result.computedTotal)} ← بعد التعديل {n(result.total)})</h4>
                <ul className="space-y-1 text-xs">
                  {result.adjustments.map(adjustment => (
                    <li key={adjustment.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-2 py-1.5">
                      <span className="font-bold">{adjustment.kindLabel}</span>
                      <span>
                        {adjustment.kind === 'TOTAL_OVERRIDE' && `${adjustment.staffName}: ${n(adjustment.amount)} ج.م`}
                        {adjustment.kind === 'EXCLUDE_BOOKING' && `${adjustment.client} (${adjustment.item}) من ${adjustment.staffName}`}
                        {adjustment.kind === 'REASSIGN_BOOKING' && `${adjustment.client} (${adjustment.item}): من ${adjustment.staffName || '—'} إلى ${adjustment.toStaffName}`}
                        {adjustment.kind === 'ROUND_SPLIT' && (adjustment.staffName ? `استثناء ${adjustment.staffName}: الروند التاني من يوم ${adjustment.splitDay}` : `كل السيلز: الروند التاني من يوم ${adjustment.splitDay}`)}
                        {adjustment.kind === 'ROUND_OVERRIDE' && `${adjustment.staffName}: مكافأة الروند ${adjustment.round === 1 ? 'الأول' : 'التاني'} ${n(adjustment.amount)} ج.م`}
                        {adjustment.kind === 'COUNT_IN_MONTH' && `${adjustment.client} (${adjustment.item}) اتحسب في الشهر ده لـ${adjustment.staffName}`}
                        {adjustment.kind === 'WEIGHT_BOOKING' && `${adjustment.client} (${adjustment.item}): ${n(adjustment.weight)} حجز`}
                      </span>
                      <span className="text-gray-600">— {adjustment.reason}</span>
                      <span className="text-gray-400">({adjustment.by || '—'} · {cairoDateTime(adjustment.at)})</span>
                      {canEditPlan && taking?.id !== adjustment.id && <button type="button" className="mr-auto font-bold text-rose-600" onClick={() => setTaking({ id: adjustment.id, reason: '' })}>إلغاء التعديل</button>}
                      {taking?.id === adjustment.id && (
                        <span className="mr-auto flex items-center gap-1">
                          <input value={taking.reason} onChange={e => setTaking({ id: adjustment.id, reason: e.target.value })} placeholder="سبب الإلغاء (اختياري)" maxLength={500} className="rounded-lg border border-gray-200 px-2 py-1" />
                          <button type="button" disabled={working} onClick={() => takeBack(adjustment.id, taking.reason)} className="rounded-lg bg-rose-600 px-2 py-1 font-bold text-white disabled:opacity-40">تأكيد</button>
                          <button type="button" onClick={() => setTaking(null)} className="rounded-lg border border-gray-200 bg-white px-2 py-1 font-bold">رجوع</button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {canEditPlan && <HrSalesSheetReconcile notify={notify} defaultMonth={month} />}
      {canEditPlan && <HrCollectionSheetReconcile notify={notify} defaultMonth={month} />}

      {/* ── The plan ── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-extrabold text-gray-900"><Award size={16} className="text-amber-600" /> قواعد المكافآت</h3>
        <p className="mb-4 text-xs text-gray-500">الأرقام هنا بيانات بتتعدّل من الشاشة دي، مش في الكود.{disabled && ' (التعديل لصلاحية إدارة المالية)'}</p>

        <div className="grid gap-5 lg:grid-cols-3">
          <div>
            <h4 className="mb-2 text-xs font-bold text-gray-700">الكورس يتحسب كام حجز (بسعره بالمصري)</h4>
            {weightRows.map((band, index) => (
              <div key={index} className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                <select disabled={disabled} value={band.minIncluded ? 'from' : 'over'}
                  onChange={e => edit('bookingWeights', weightRows.map((row, i) => (i === index ? { ...row, minIncluded: e.target.value === 'from' } : row)))}
                  className="rounded-lg border border-gray-200 bg-white px-1 py-1 text-xs">
                  <option value="from">من</option><option value="over">أكتر من</option>
                </select>
                <input disabled={disabled} type="number" min="0" dir="ltr" className={input} value={band.min}
                  onChange={e => edit('bookingWeights', weightRows.map((row, i) => (i === index ? { ...row, min: Number(e.target.value) } : row)))} />
                <span>←</span>
                <input disabled={disabled} type="number" min="0" step="0.5" dir="ltr" className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-sm" value={band.weight}
                  onChange={e => edit('bookingWeights', weightRows.map((row, i) => (i === index ? { ...row, weight: Number(e.target.value) } : row)))} />
                <span>حجز</span>
                {!disabled && <button type="button" className="text-rose-600" onClick={() => edit('bookingWeights', weightRows.filter((_, i) => i !== index))}>✕</button>}
              </div>
            ))}
            {!disabled && <button type="button" className="text-xs font-bold text-amber-700" onClick={() => edit('bookingWeights', [...weightRows, { min: 0, minIncluded: false, weight: 1 }])}>+ شريحة</button>}
          </div>

          <div>
            <h4 className="mb-2 text-xs font-bold text-gray-700">سلّم التارجيت (عدد حجوزات ← مكافأة)</h4>
            {plan.bookingLadder.map((tier, index) => (
              <div key={index} className="mb-1.5 flex items-center gap-1.5 text-xs">
                <input disabled={disabled} type="number" min="1" dir="ltr" className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-sm" value={tier.bookings}
                  onChange={e => edit('bookingLadder', plan.bookingLadder.map((row, i) => (i === index ? { ...row, bookings: Number(e.target.value) } : row)))} />
                <span>حجز ←</span>
                <input disabled={disabled} type="number" min="0" dir="ltr" className={input} value={tier.amount}
                  onChange={e => edit('bookingLadder', plan.bookingLadder.map((row, i) => (i === index ? { ...row, amount: Number(e.target.value) } : row)))} />
                <span>ج.م</span>
                {!disabled && <button type="button" className="text-rose-600" onClick={() => edit('bookingLadder', plan.bookingLadder.filter((_, i) => i !== index))}>✕</button>}
              </div>
            ))}
            {!disabled && <button type="button" className="text-xs font-bold text-amber-700" onClick={() => edit('bookingLadder', [...plan.bookingLadder, { bookings: 0, amount: 0 }])}>+ تارجيت</button>}
          </div>

          <div>
            <h4 className="mb-2 text-xs font-bold text-gray-700">الحجز الإضافي فوق التارجيت</h4>
            {plan.extraPerBooking.map((band, index) => (
              <div key={index} className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                <span>من</span>
                <input disabled={disabled} type="number" min="0" dir="ltr" className="w-14 rounded-lg border border-gray-200 px-2 py-1 text-sm" value={band.from}
                  onChange={e => edit('extraPerBooking', plan.extraPerBooking.map((row, i) => (i === index ? { ...row, from: Number(e.target.value) } : row)))} />
                <span>لحد</span>
                <input disabled={disabled} type="number" min="0" dir="ltr" placeholder="مفتوح" className="w-14 rounded-lg border border-gray-200 px-2 py-1 text-sm" value={band.to ?? ''}
                  onChange={e => edit('extraPerBooking', plan.extraPerBooking.map((row, i) => (i === index ? { ...row, to: e.target.value === '' ? null : Number(e.target.value) } : row)))} />
                <span>حجز ←</span>
                <input disabled={disabled} type="number" min="0" dir="ltr" className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-sm" value={band.amount}
                  onChange={e => edit('extraPerBooking', plan.extraPerBooking.map((row, i) => (i === index ? { ...row, amount: Number(e.target.value) } : row)))} />
                <span>للحجز</span>
                {!disabled && <button type="button" className="text-rose-600" onClick={() => edit('extraPerBooking', plan.extraPerBooking.filter((_, i) => i !== index))}>✕</button>}
              </div>
            ))}
            {!disabled && <button type="button" className="text-xs font-bold text-amber-700" onClick={() => edit('extraPerBooking', [...plan.extraPerBooking, { from: 0, to: null, amount: 0 }])}>+ شريحة</button>}
            <label className="mt-4 block text-xs">
              <span className="mb-1 block font-bold text-gray-700">تارجيت السيلز</span>
              <select disabled={disabled} value={plan.salesPeriod || 'MONTH'} onChange={e => edit('salesPeriod', e.target.value as BonusPlan['salesPeriod'])} className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs">
                <option value="HALF_MONTH">كل 15 يوم (روندين في الشهر: 1–15 و16–آخر الشهر)</option>
                <option value="MONTH">شهري</option>
              </select>
              <span className="mt-1 block text-[11px] text-gray-500">السلّم كله بيتطبق على كل روند لوحده. التحصيل والريسبشن شهري دايمًا.</span>
            </label>
            <label className="mt-4 flex items-center gap-2 text-xs">
              <input disabled={disabled} type="checkbox" checked={plan.courseSalesBonusEnabled} onChange={e => edit('courseSalesBonusEnabled', e.target.checked)} />
              تشغيل «مكافأة السيلز» المسجّلة في صفحة كل كورس (مقفولة دلوقتي)
            </label>
          </div>
        </div>
        {!disabled && (
          <button type="button" onClick={savePlan} disabled={savingPlan} className="mt-4 flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
            <Save size={14} /> {savingPlan ? 'جارٍ الحفظ…' : 'حفظ القواعد'}
          </button>
        )}
      </section>

      {/* ── Each course ── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-extrabold text-gray-900">كل كورس ومسار يتحسب كام حجز للسيلز (بسعره في الكتالوج)</h3>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500"><tr><th className="p-2 text-right">الكورس / المسار</th><th className="p-2 text-right">السعر (ج.م)</th><th className="p-2 text-right">يتحسب حجز</th></tr></thead>
            <tbody>
              {items.map(item => (
                <tr key={`${item.kind}-${item.id}`} className="border-t border-gray-100">
                  <td className="p-2">{item.title} {item.kind === 'track' && <span className="rounded bg-indigo-50 px-1 text-[10px] text-indigo-700">مسار</span>}</td>
                  <td className="p-2" dir="ltr">{n(item.priceEgp)}</td>
                  <td className="p-2 font-extrabold">{n(item.weight)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-gray-500">ده بسعر الكتالوج. الحجز الفعلي بيتحسب بسعر العميل نفسه المتفق عليه (ولو العميل بيدفع بعملة تانية، بيتحوّل للمصري بسعر الصرف وقت الدفعة).</p>
      </section>
    </div>
  );
}
