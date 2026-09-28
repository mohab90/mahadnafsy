import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, CheckCircle2, Clock, CreditCard, Hourglass, ReceiptText, RotateCcw, Search, UserPlus, Wallet, XCircle,
} from 'lucide-react';
import { cairoDateOnly, cairoDay, cairoMonthOnly, cairoWeekStart } from '../../../../../shared/cairoDate';
import { paymentMethodLabel } from '../../../../../shared/paymentMethods';
import { useStaticData } from '../../../../context/siteDataSlices';
import { itemKeyOf } from '../../../../lib/agreedPrice';
import { toEgp } from '../../../../lib/money';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { PaymentHistoryEntry, StaffMember, SubscriberItem } from '../../../../types';
import { CollectionBookingsReview } from '../orders/CollectionBookingsReview';
import { StaffRefundsSection } from './StaffRefundsSection';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;
type Section = 'payments' | 'review' | 'refunds';
type Period = 'today' | 'week' | 'month' | 'all';
type Row = PaymentHistoryEntry & { clientId: string; clientName: string; clientCode: string };
type MyRequest = {
  id: string; status: string; name: string; phone: string | null; amount: number; currency: string;
  reviewNote: string | null; reviewedByName: string | null; createdAt: string;
  payment: { courseId: string | null; bundleId: string | null; paymentMethod: string | null };
};

const STATUS = {
  paid: { label: 'مؤكدة', tone: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  pending: { label: 'بانتظار المسئول', tone: 'bg-amber-100 text-amber-700', icon: Clock },
  failed: { label: 'مرفوضة', tone: 'bg-red-100 text-red-700', icon: XCircle },
  refunded: { label: 'اتردت', tone: 'bg-gray-100 text-gray-600', icon: RotateCcw },
} as const;
const statusOf = (payment: PaymentHistoryEntry) => (payment.status && payment.status in STATUS ? payment.status : 'paid') as keyof typeof STATUS;
const REQUEST_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: 'مستني المسئول', tone: 'bg-amber-100 text-amber-700' },
  approved: { label: 'اتعتمد واتضاف', tone: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'اترفض', tone: 'bg-red-100 text-red-700' },
};
const egp = (value: number) => `${Math.round(value).toLocaleString('ar-EG-u-nu-latn')} ج.م`;
const inCurrency = (value: number, currency?: string) => `${Number(value || 0).toLocaleString('ar-EG-u-nu-latn')} ${!currency || currency === 'EGP' ? 'ج.م' : currency}`;
const PAYMENT_KIND: Record<string, string> = {
  course: 'كورس', certificate: 'شهادة', consultation: 'استشارة', book: 'كتاب', carneh: 'كارنيه', other: 'أخرى',
};

/**
 * مدفوعاتي — for the people who take the money: sales, collection and the
 * Daqqi desk. «غير شكل صفحه المدفوعات تكون متوافقه مع شغلهم بتصميم مختلف عن
 * المدفوعات بتاعت الحسابات».
 *
 * They were shown the accounts screen: transfers to add, orders to link,
 * approval buttons nobody at the desk may press, and every row titled with a
 * payment type — a track's payment read «course». Here it is their own day:
 * what came in from their clients, what is waiting for the manager (their new
 * customers included, which do not exist until approved), and their clients'
 * refunds, in the same cards. The administration, the accountant and the
 * online manager keep the accounts screen (OrdersTab).
 */
export default function StaffPaymentsTab({ staff, subscribers, notify, canReview, canSeeRefunds }: {
  staff: StaffMember | null | undefined;
  subscribers: SubscriberItem[];
  notify: Notify;
  /** Holds manage_financial (the Daqqi manager): the review queue sits on top. */
  canReview: boolean;
  canSeeRefunds: boolean;
}) {
  const { courses, bundles } = useStaticData();
  const [section, setSection] = useState<Section>('payments');
  const [period, setPeriod] = useState<Period>('month');
  const [status, setStatus] = useState<'all' | keyof typeof STATUS>('all');
  const [mineOnly, setMineOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [requests, setRequests] = useState<MyRequest[]>([]);

  const loadRequests = useCallback(() => {
    mysqlAdmin.adminGet<MyRequest[]>('/staff/subscriber-requests')
      .then(rows => setRequests(Array.isArray(rows) ? rows : []))
      .catch(() => setRequests([]));
  }, []);
  useEffect(loadRequests, [loadRequests]);

  // A payment's item by its own key — a track is the track, not «course».
  const titleOf = useCallback((payment: PaymentHistoryEntry) => {
    const key = itemKeyOf(payment);
    if (key.startsWith('bundle:')) return bundles.find(b => `bundle:${b.id}` === key)?.title || payment.itemTitle || 'مسار';
    if (key) return courses.find(c => c.id === key)?.title || payment.itemTitle || 'كورس';
    return payment.itemTitle || PAYMENT_KIND[String(payment.paymentType || 'other')] || 'دفعة';
  }, [courses, bundles]);

  const rows = useMemo<Row[]>(() => subscribers.flatMap(subscriber => (subscriber.paymentHistory || []).map(payment => ({
    ...payment, clientId: subscriber.id, clientName: subscriber.name, clientCode: subscriber.clientCode || '',
  }))).sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))), [subscribers]);

  const today = cairoDateOnly();
  const weekStart = cairoWeekStart();
  const month = cairoMonthOnly();
  const inPeriod = useCallback((payment: PaymentHistoryEntry) => {
    const day = cairoDay(payment.at);
    return period === 'all' || (period === 'today' && day === today) || (period === 'week' && day >= weekStart)
      || (period === 'month' && day.slice(0, 7) === month);
  }, [period, today, weekStart, month]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(row => inPeriod(row)
      && (status === 'all' || statusOf(row) === status)
      && (!mineOnly || row.staffId === staff?.id)
      && (!q || row.clientName.toLowerCase().includes(q) || row.clientCode.toLowerCase().includes(q)
        || String(row.transactionId || '').toLowerCase().includes(q)));
  }, [rows, inPeriod, status, mineOnly, staff?.id, search]);

  const totals = useMemo(() => {
    const sum = (list: Row[]) => list.reduce((total, row) => total + toEgp(row.amount, row.currency), 0);
    const paid = rows.filter(row => statusOf(row) === 'paid');
    return {
      today: sum(paid.filter(row => cairoDay(row.at) === today)),
      week: sum(paid.filter(row => cairoDay(row.at) >= weekStart)),
      month: sum(paid.filter(row => cairoDay(row.at).slice(0, 7) === month)),
      pendingCount: rows.filter(row => statusOf(row) === 'pending').length + requests.filter(r => r.status === 'pending').length,
      pendingSum: sum(rows.filter(row => statusOf(row) === 'pending'))
        + requests.filter(r => r.status === 'pending').reduce((total, r) => total + toEgp(r.amount, r.currency), 0),
    };
  }, [rows, requests, today, weekStart, month]);

  // By day, newest first: the desk reads its money a day at a time.
  const byDay = useMemo(() => {
    const groups = new Map<string, Row[]>();
    for (const row of shown) {
      const day = cairoDay(row.at) || '—';
      groups.set(day, [...(groups.get(day) || []), row]);
    }
    return [...groups.entries()];
  }, [shown]);

  const pendingRows = rows.filter(row => statusOf(row) === 'pending');
  const tabs: { key: Section; label: string; icon: typeof Wallet; badge?: number }[] = [
    { key: 'payments', label: 'الدفعات', icon: ReceiptText },
    { key: 'review', label: 'بانتظار المسئول', icon: Hourglass, badge: totals.pendingCount },
    ...(canSeeRefunds ? [{ key: 'refunds' as const, label: 'الاستردادات', icon: RotateCcw }] : []),
  ];

  return (
    <div className="space-y-4" dir="rtl">
      {canReview && <CollectionBookingsReview notify={notify} />}

      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-600 via-emerald-600 to-cyan-700 p-5 text-white shadow-lg">
        <div className="pointer-events-none absolute -left-10 -top-16 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-wrap items-center gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15"><Wallet size={22} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-black">مدفوعاتي</h2>
            <p className="text-xs text-emerald-50/80">فلوس عملائك — اللي اتأكدت، واللي مستنية المسئول، والاستردادات.</p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:grid-cols-4">
            {[
              ['النهارده', egp(totals.today)], ['الأسبوع', egp(totals.week)], ['الشهر', egp(totals.month)],
              ['مستني المسئول', `${totals.pendingCount} · ${egp(totals.pendingSum)}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-white/15 bg-white/10 px-3 py-2 backdrop-blur">
                <div className="text-sm font-black">{value}</div>
                <div className="text-[10px] text-emerald-50/80">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <nav className="flex flex-wrap gap-1 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-sm">
        {tabs.map(({ key, label, icon: Icon, badge }) => (
          <button key={key} type="button" onClick={() => setSection(key)}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-bold transition ${
              section === key ? 'bg-teal-600 text-white shadow-sm shadow-teal-200' : 'text-gray-600 hover:bg-gray-100'}`}>
            <Icon size={15} /> {label}
            {!!badge && <span className={`rounded-full px-1.5 text-[10px] leading-4 ${section === key ? 'bg-white text-teal-700' : 'bg-amber-500 text-white'}`}>{badge}</span>}
          </button>
        ))}
      </nav>

      {section === 'payments' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
            <div className="flex gap-1 rounded-xl bg-gray-100 p-1 text-xs font-bold">
              {([['today', 'النهارده'], ['week', 'الأسبوع'], ['month', 'الشهر'], ['all', 'الكل']] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setPeriod(key)}
                  className={`rounded-lg px-3 py-1.5 transition ${period === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{label}</button>
              ))}
            </div>
            <select value={status} onChange={e => setStatus(e.target.value as typeof status)} className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-bold">
              <option value="all">كل الحالات</option>
              {(Object.keys(STATUS) as (keyof typeof STATUS)[]).map(key => <option key={key} value={key}>{STATUS[key].label}</option>)}
            </select>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-bold text-gray-600">
              <input type="checkbox" checked={mineOnly} onChange={e => setMineOnly(e.target.checked)} className="accent-teal-600" /> اللي سجلتها أنا
            </label>
            <div className="relative mr-auto min-w-[180px] flex-1 sm:flex-none">
              <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="اسم / كود / رقم عملية"
                className="w-full rounded-xl border border-gray-200 py-1.5 pl-3 pr-8 text-xs" />
            </div>
          </div>

          {byDay.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 bg-white py-14 text-center text-sm text-gray-400">
              <CreditCard size={32} className="mx-auto mb-2 text-gray-300" /> مفيش دفعات في الفترة دي.
            </div>
          ) : byDay.map(([day, list]) => (
            <div key={day} className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2 text-xs">
                <span className="flex items-center gap-1.5 font-extrabold text-gray-700"><CalendarDays size={13} className="text-teal-600" /> {day}</span>
                <span className="font-bold text-teal-700">
                  {egp(list.filter(row => statusOf(row) === 'paid').reduce((total, row) => total + toEgp(row.amount, row.currency), 0))}
                </span>
              </div>
              <ul className="divide-y divide-gray-50">
                {list.map(row => {
                  const badge = STATUS[statusOf(row)];
                  const Icon = badge.icon;
                  return (
                    <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-gray-900">{row.clientName}</span>
                          {row.clientCode && <span className="text-[10px] text-gray-400">{row.clientCode}</span>}
                          {row.isInstallment && <span className="rounded-full bg-sky-50 px-1.5 text-[10px] font-bold text-sky-700">قسط</span>}
                        </div>
                        <div className="truncate text-[11px] text-gray-500">
                          {titleOf(row)} · {paymentMethodLabel(row.paymentMethod) || '—'}
                          {row.transactionId ? ` · #${row.transactionId}` : ''}{row.staffName ? ` · سجّلها ${row.staffName}` : ''}
                        </div>
                      </div>
                      <span className="text-sm font-black text-gray-900">{inCurrency(row.amount, row.currency)}</span>
                      <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.tone}`}><Icon size={11} /> {badge.label}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {section === 'review' && (
        <div className="space-y-3">
          <p className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            أي حجز من هنا مبيتحسبش ولا بيفتح كورس لحد ما المسئول يتأكد من التحويل ويربطه ويعتمده — والعميل الجديد مبيتضافش قبلها.
          </p>
          {requests.length === 0 && pendingRows.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 bg-white py-12 text-center text-sm text-gray-400">مفيش حاجة مستنية المسئول 👌</div>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {requests.map(request => {
                const badge = REQUEST_STATUS[request.status] || REQUEST_STATUS.pending;
                const item = request.payment.bundleId
                  ? bundles.find(b => b.id === request.payment.bundleId)?.title
                  : courses.find(c => c.id === request.payment.courseId)?.title;
                return (
                  <div key={request.id} className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
                    <div className="flex items-start gap-2">
                      <UserPlus size={16} className="mt-0.5 text-violet-600" />
                      <div className="min-w-0 flex-1">
                        <div className="font-extrabold text-gray-900">{request.name}</div>
                        <div className="text-[11px] text-gray-500">{item || '—'} · {request.payment.paymentMethod || '—'} · {cairoDay(request.createdAt)}</div>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.tone}`}>{badge.label}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700">عميل جديد</span>
                      <span className="text-base font-black text-gray-900">{inCurrency(request.amount, request.currency)}</span>
                    </div>
                    {request.status !== 'pending' && (request.reviewNote || request.reviewedByName) && (
                      <p className="mt-1 text-[11px] text-gray-500">الرد: {[request.reviewedByName, request.reviewNote].filter(Boolean).join(' — ')}</p>
                    )}
                  </div>
                );
              })}
              {pendingRows.map(row => (
                <div key={row.id} className="rounded-2xl border border-amber-100 bg-white p-4 shadow-sm">
                  <div className="flex items-start gap-2">
                    <Clock size={16} className="mt-0.5 text-amber-600" />
                    <div className="min-w-0 flex-1">
                      <div className="font-extrabold text-gray-900">{row.clientName}</div>
                      <div className="text-[11px] text-gray-500">{titleOf(row)} · {paymentMethodLabel(row.paymentMethod) || '—'} · {cairoDay(row.at)}</div>
                    </div>
                    <span className="text-base font-black text-gray-900">{inCurrency(row.amount, row.currency)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {section === 'refunds' && canSeeRefunds && <StaffRefundsSection clients={subscribers} notify={notify} />}
    </div>
  );
}
