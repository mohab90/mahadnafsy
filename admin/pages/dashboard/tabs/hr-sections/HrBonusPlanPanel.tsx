import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, Calculator, Loader2, Save } from 'lucide-react';
import { mysqlAdmin, type BonusPlan, type MonthlyBonuses } from '../../../../lib/mysqlapi';
import { cairoMonthOnly } from '../../../../../shared/cairoDate';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;
type Item = { kind: 'course' | 'track'; id: string; title: string; priceEgp: number; weight: number };

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

  const weightRows = useMemo(() => plan?.bookingWeights ?? [], [plan]);
  if (!plan) return <div className="flex items-center justify-center gap-2 p-8 text-sm text-gray-400"><Loader2 size={16} className="animate-spin" /> جاري التحميل…</div>;
  const disabled = !canEditPlan;

  return (
    <div className="space-y-5" dir="rtl">
      {/* ── The month ── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-extrabold text-gray-900"><Calculator size={16} className="text-indigo-600" /> حساب مكافآت الشهر</h3>
        <div className="flex flex-wrap items-center gap-2">
          <input type="month" dir="ltr" value={month} onChange={e => setMonth(e.target.value)} className="rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          <button type="button" onClick={work} disabled={working} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{working ? 'بيحسب…' : 'احسب'}</button>
          {result && result.employees.some(item => item.total > 0) && (
            <button type="button" onClick={saveMonth} disabled={working} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
              سجّلها مكافآت مستنية الاعتماد
            </button>
          )}
        </div>
        {result && (
          <div className="mt-4 overflow-x-auto">
            {result.employees.length === 0 ? (
              <p className="text-sm text-gray-500">مفيش موظف متحدد له نظام مكافأة. حدده من ملف الموظف ← «الراتب والعمولة» ← «المكافأة الشهرية».</p>
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
                        <td className="p-2 text-xs text-gray-600">{item.schemeLabel}</td>
                        <td className="p-2 text-xs text-gray-700">{item.summary}</td>
                        <td className="p-2 font-extrabold text-emerald-700">{n(item.total)}</td>
                      </tr>
                      {open === item.staffId && item.bookings.length > 0 && (
                        <tr><td colSpan={4} className="bg-gray-50 p-2">
                          <table className="w-full text-xs">
                            <thead className="text-gray-500"><tr><th className="p-1 text-right">اليوم</th>{item.ladder?.rounds && item.ladder.rounds.length > 1 && <th className="p-1 text-right">الروند</th>}<th className="p-1 text-right">العميل</th><th className="p-1 text-right">الكورس / المسار</th><th className="p-1 text-right">السعر</th><th className="p-1 text-right">بالمصري</th><th className="p-1 text-right">{item.scheme === 'SALES_BOOKINGS' ? 'يتحسب حجز' : 'مكافأة الكورس'}</th></tr></thead>
                            <tbody>
                              {item.bookings.map(booking => (
                                <tr key={booking.paymentId} className="border-t border-gray-100">
                                  <td className="p-1" dir="ltr">{booking.day}</td>{item.ladder?.rounds && item.ladder.rounds.length > 1 && <td className="p-1">{booking.round}</td>}<td className="p-1">{booking.client} {booking.clientCode && <span className="text-gray-400">({booking.clientCode})</span>}</td>
                                  <td className="p-1">{booking.title}</td><td className="p-1">{n(booking.price)} {booking.currency}</td><td className="p-1">{n(booking.priceEgp)}</td>
                                  <td className="p-1 font-bold">{item.scheme === 'SALES_BOOKINGS' ? n(booking.weight) : n(booking.deskBonus)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td></tr>
                      )}
                    </React.Fragment>
                  ))}
                  <tr className="border-t-2 border-gray-200 font-extrabold"><td className="p-2" colSpan={3}>الإجمالي</td><td className="p-2 text-emerald-700">{n(result.total)}</td></tr>
                </tbody>
              </table>
            )}
            <p className="mt-2 text-[11px] text-gray-500">
              الحجز = أول دفعة مدفوعة للعميل في الكورس أو المسار في الشهر، بسعر العميل المتفق عليه محوّل للمصري بسعر الصرف وقت الدفعة. التحصيل = فلوس الكورسات والمسارات اللي سجّلها الموظف (مش الشهادات).
              «سجّلها» بتعمل مكافأة واحدة لكل موظف مستنية الاعتماد؛ لو اتحسبت تاني قبل الاعتماد بتتبدّل، والمعتمدة ما بتتغيرش.
            </p>
          </div>
        )}
      </section>

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
