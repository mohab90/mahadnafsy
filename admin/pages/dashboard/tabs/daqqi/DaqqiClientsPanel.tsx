import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight, CreditCard, Eye, MessageCircle, Phone, Search, UserPlus, Users, X } from 'lucide-react';
import { useSiteData } from '../../../../context/SiteDataContext';
import type { DaqqiRound, SubscriberItem } from '../../../../types';
import { toDialable } from '../../../../lib/whatsappLink';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type ClientTab = 'all' | 'assigned' | 'unassigned';

interface Props {
  subscribers: SubscriberItem[];
  rounds: DaqqiRound[];
  canDeleteSubscriber: boolean;
  notify: NotifyFn;
  onAddClient: () => void;
  onCommunicate: (subscriber: SubscriberItem) => void;
  onPay: (subscriber: SubscriberItem) => void;
  onAssign: (subscriberId: string) => void;
}

const paymentAmount = (subscriber: SubscriberItem, courseId: string) =>
  (subscriber.paymentHistory || [])
    .filter(payment => payment.status !== 'pending' && payment.status !== 'failed' && payment.courseId === courseId)
    .reduce((sum, payment) => payment.currency === 'EGP' ? sum + Number(payment.amount) : sum, 0);

export function DaqqiClientsPanel({
  subscribers,
  rounds,
  canDeleteSubscriber,
  notify,
  onAddClient,
  onCommunicate,
  onPay,
  onAssign,
}: Props) {
  const navigate = useNavigate();
  const { courses, bundles, staffMembers, deleteSubscriber } = useSiteData();
  const [tab, setTab] = useState<ClientTab>('unassigned');
  const [search, setSearch] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [receptionFilter, setReceptionFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const receptionOptions = staffMembers.filter(member => member.role === 'reception_daqqi' && member.status === 'active');

  const coursePrice = useCallback((courseId: string) => {
    if (courseId.startsWith('bundle:')) return bundles.find(bundle => bundle.id === courseId.slice(7))?.price.EGP || 0;
    return courses.find(course => course.id === courseId)?.price?.EGP || 0;
  }, [bundles, courses]);
  const courseLabel = (courseId: string) => {
    if (courseId.startsWith('bundle:')) return bundles.find(bundle => bundle.id === courseId.slice(7))?.title || courseId;
    const course = courses.find(item => item.id === courseId);
    return course?.titleAr || course?.title || courseId;
  };
  const subscriberRounds = useCallback((subscriberId: string) => rounds.filter(round =>
    round.attendees.some(attendee => attendee.subscriberId === subscriberId)), [rounds]);
  const assignedIds = useMemo(() => new Set(rounds.flatMap(round =>
    round.attendees.map(attendee => attendee.subscriberId))), [rounds]);

  const filtered = useMemo(() => subscribers.filter(subscriber => {
    const subscriberAssigned = assignedIds.has(subscriber.id);
    if (tab === 'assigned' && !subscriberAssigned) return false;
    if (tab === 'unassigned' && subscriberAssigned) return false;
    const normalizedSearch = search.trim().toLowerCase();
    if (normalizedSearch && !subscriber.name.toLowerCase().includes(normalizedSearch)
      && !subscriber.phone.replace(/\D/g, '').includes(normalizedSearch.replace(/\D/g, ''))) return false;
    if (courseFilter && !subscriber.enrolledCourseIds.includes(courseFilter)) return false;
    const ownRounds = subscriberRounds(subscriber.id);
    if (receptionFilter && !ownRounds.some(round => round.receptionId === receptionFilter)) return false;
    const expected = subscriber.enrolledCourseIds.reduce((sum, id) => sum + coursePrice(id), 0);
    const paid = subscriber.enrolledCourseIds.reduce((sum, id) => sum + paymentAmount(subscriber, id), 0);
    if (paymentFilter === 'outstanding' && !(expected > 0 && paid < expected)) return false;
    if (paymentFilter === 'paid' && !(expected === 0 || paid >= expected)) return false;
    return true;
  }), [assignedIds, coursePrice, courseFilter, paymentFilter, receptionFilter, subscriberRounds, search, subscribers, tab]);

  const clearFilters = () => {
    setSearch('');
    setCourseFilter('');
    setReceptionFilter('');
    setPaymentFilter('');
  };
  const removeSubscriber = async (subscriber: SubscriberItem) => {
    if (!window.confirm(`أرشفة "${subscriber.name}" وتعطيل حسابه؟`)) return;
    const removed = await deleteSubscriber(subscriber.id);
    notify(removed ? 'success' : 'error', removed ? 'تمت أرشفة العميل وتعطيل حسابه' : 'تعذر أرشفة العميل');
  };

  return (
    <div className="border border-blue-200 rounded-2xl bg-white overflow-hidden order-last">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-blue-100 bg-blue-50/40">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-blue-600" />
          <h4 className="font-bold text-gray-800 text-sm">عملاء فرع الدقي <span className="text-gray-400 font-normal">({filtered.length} / {subscribers.length})</span></h4>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-xl border border-gray-200 overflow-hidden text-xs">
            {(['all', 'assigned', 'unassigned'] as const).map(value => (
              <button key={value} onClick={() => setTab(value)}
                className={`px-3 py-1.5 font-bold transition ${tab === value ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {{ all: 'الكل', assigned: 'المسكّنون', unassigned: 'الغير مسكّنين' }[value]}
              </button>
            ))}
          </div>
          <button onClick={onAddClient} className="flex items-center gap-1.5 bg-green-600 text-white px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-green-700 transition">
            <UserPlus size={13} /> إضافة عميل
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 px-4 py-2.5 bg-gray-50/70 border-b border-gray-100">
        <div className="relative">
          <Search size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="بحث بالاسم أو الهاتف..."
            className="pr-7 pl-3 py-1.5 border border-gray-200 rounded-lg text-xs min-w-[160px] focus:outline-none focus:border-blue-400 bg-white" />
        </div>
        <select value={courseFilter} onChange={event => setCourseFilter(event.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs min-w-[130px] bg-white">
          <option value="">كل الكورسات</option>
          {courses.map(course => <option key={course.id} value={course.id}>{course.titleAr || course.title}</option>)}
          {bundles.map(bundle => <option key={bundle.id} value={`bundle:${bundle.id}`}>📦 {bundle.title}</option>)}
        </select>
        <select value={receptionFilter} onChange={event => setReceptionFilter(event.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs min-w-[130px] bg-white">
          <option value="">كل الريسبشن</option>
          {receptionOptions.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
        </select>
        <select value={paymentFilter} onChange={event => setPaymentFilter(event.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs min-w-[120px] bg-white">
          <option value="">كل الحالات المالية</option>
          <option value="outstanding">متبقي دفع</option>
          <option value="paid">مكتمل الدفع</option>
        </select>
        {(search || courseFilter || receptionFilter || paymentFilter) && (
          <button onClick={clearFilters} className="px-2 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 text-xs font-bold flex items-center gap-1">
            <X size={11} /> مسح
          </button>
        )}
      </div>

      {filtered.length === 0 ? <div className="py-10 text-center text-gray-400 text-sm">لا يوجد عملاء مطابقون للفلاتر.</div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[1150px] border-collapse">
            <thead className="bg-gray-50 text-gray-600">
              <tr>{['العميل', 'تاريخ التسجيل', 'الكورسات', 'السعر', 'المدفوع', 'المتبقي', 'الشهادات', 'الريسبشن', 'التسكين', 'آخر تواصل', 'إجراءات'].map(label =>
                <th key={label} className="text-right px-2 py-2 border border-gray-200 font-semibold">{label}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map(subscriber => {
                const ownRounds = subscriberRounds(subscriber.id);
                const reception = ownRounds.find(round => round.status === 'active') || ownRounds.find(round => (round.status || 'new') === 'new') || ownRounds[0];
                const ids = [...new Set(subscriber.enrolledCourseIds)];
                const rows = ids.map(id => ({ id, label: courseLabel(id), price: coursePrice(id), paid: paymentAmount(subscriber, id) }));
                const lastCommunication = [...(subscriber.communications || [])].sort((a, b) => b.date.localeCompare(a.date))[0];
                const line = (values: React.ReactNode[]) => <div className="flex flex-col gap-1">{values.map((value, index) => <div key={ids[index] || index} className="min-h-5">{value}</div>)}</div>;
                return (
                  <tr key={subscriber.id} className="hover:bg-gray-50/80 align-top">
                    <td className="px-2 py-2 border border-gray-200">
                      <button onClick={() => navigate(`/client/${subscriber.clientCode || subscriber.id}`)} className="font-bold text-gray-800 hover:text-primary-700 block max-w-[120px] truncate">{subscriber.name}</button>
                      <a href={`tel:${subscriber.phone}`} className="font-semibold text-blue-600">{subscriber.phone}</a>
                    </td>
                    <td className="px-2 py-2 border border-gray-200 whitespace-nowrap">{(subscriber.createdAt || '').slice(0, 10) || '—'}</td>
                    <td className="px-2 py-2 border border-gray-200">{line(rows.length ? rows.map(row => row.label) : ['لا يوجد'])}</td>
                    <td className="px-2 py-2 border border-gray-200">{line(rows.map(row => row.price ? `${row.price.toLocaleString()} ج.م` : '—'))}</td>
                    <td className="px-2 py-2 border border-gray-200 text-emerald-700 font-bold">{line(rows.map(row => row.paid ? `${row.paid.toLocaleString()} ج.م` : '—'))}</td>
                    <td className="px-2 py-2 border border-gray-200 font-bold">{line(rows.map(row => row.price > row.paid ? <span className="text-red-600">{(row.price - row.paid).toLocaleString()} ج.م</span> : <span className="text-emerald-600">✅ مكتمل</span>))}</td>
                    <td className="px-2 py-2 border border-gray-200 text-center">{(subscriber.certificates || []).length || '—'}</td>
                    <td className="px-2 py-2 border border-gray-200 text-indigo-700">{reception?.receptionName || '— غير مسند —'}</td>
                    <td className="px-2 py-2 border border-indigo-100 text-center">{ownRounds.length ? ownRounds.slice(0, 2).map(round => <div key={round.id} className="font-bold">{round.code}</div>) : 'غير مسكن'}</td>
                    <td className="px-2 py-2 border border-gray-200 max-w-[150px]">
                      <div className="truncate">{lastCommunication?.notes || lastCommunication?.outcome || '—'}</div>
                      <div className="text-gray-400 text-[9px]">{lastCommunication?.date?.slice(0, 10)}</div>
                    </td>
                    <td className="px-1 py-1.5 border border-gray-200 w-[100px]">
                      <div className="grid grid-cols-4 gap-0.5">
                        <button onClick={() => onCommunicate(subscriber)} className="h-7 rounded bg-gray-50 hover:bg-purple-50 flex items-center justify-center" title="تسجيل تواصل"><Phone size={12} /></button>
                        <button onClick={() => onPay(subscriber)} className="h-7 rounded bg-gray-50 hover:bg-green-50 flex items-center justify-center" title="تسجيل دفعة"><CreditCard size={12} /></button>
                        <button onClick={() => window.open(`https://wa.me/${toDialable(subscriber.phone)}`, '_blank', 'noopener,noreferrer')} className="h-7 rounded bg-gray-50 hover:bg-teal-50 flex items-center justify-center" title="واتساب"><MessageCircle size={12} /></button>
                        <button onClick={() => navigate(`/client/${subscriber.clientCode || subscriber.id}`)} className="h-7 rounded bg-gray-50 hover:bg-blue-50 flex items-center justify-center" title="عرض الملف"><Eye size={12} /></button>
                        <button onClick={() => onAssign(subscriber.id)} className="h-7 rounded bg-indigo-50 hover:bg-indigo-100 flex items-center justify-center" title="تسكين">🏠</button>
                        <button onClick={() => navigate(`/client/${subscriber.clientCode || subscriber.id}`)} className="h-7 rounded bg-orange-50 hover:bg-orange-100 flex items-center justify-center" title="الملف الكامل"><ArrowLeftRight size={12} /></button>
                        {canDeleteSubscriber && <button onClick={() => void removeSubscriber(subscriber)} className="h-7 rounded bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center" title="أرشفة"><X size={12} /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
