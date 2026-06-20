import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight, CreditCard, Eye, MessageCircle, Phone, Search,
  UserPlus, Users, X,
} from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { SubscriberItem, DaqqiRound, Course, Bundle, StaffMember } from '../../../../types';
import type { DaqqiPayDraft } from './DaqqiPayModal';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface Props {
  daqqiSubs: SubscriberItem[];
  daqqiRounds: DaqqiRound[];
  courses: Course[];
  bundles: Bundle[];
  assignedSubIds: Set<string>;
  receptionOptions: StaffMember[];
  notify: NotifyFn;
  onAddClient: () => void;
  onPayment: (subscriberId: string, subscriberName: string, firstCourseId: string) => void;
  onComm: (subscriberId: string, subscriberName: string, phone: string) => void;
  onHousing: (subId: string) => void;
}

export function DaqqiClientsSection({
  daqqiSubs, daqqiRounds, courses, bundles, assignedSubIds, receptionOptions,
  notify, onAddClient, onPayment, onComm, onHousing,
}: Props) {
  const navigate = useNavigate();

  const [clientTab, setClientTab] = useState<'all' | 'assigned' | 'unassigned'>('unassigned');
  const [clientSearch, setClientSearch] = useState('');
  const [filterCourse, setFilterCourse] = useState('');
  const [filterReception, setFilterReception] = useState('');
  const [filterPay, setFilterPay] = useState('');

  const getSubRounds = (subId: string) => daqqiRounds.filter(r => r.attendees.some(a => a.subscriberId === subId));
  const getSubReception = (subId: string) => {
    const rounds = getSubRounds(subId);
    const activeRound = rounds.find(r => r.status === 'active') || rounds.find(r => (r.status || 'new') === 'new') || rounds[0];
    return activeRound ? { name: activeRound.receptionName, id: activeRound.receptionId } : null;
  };

  let filteredClients = daqqiSubs;
  if (clientTab === 'assigned') filteredClients = daqqiSubs.filter(s => assignedSubIds.has(s.id));
  if (clientTab === 'unassigned') filteredClients = daqqiSubs.filter(s => !assignedSubIds.has(s.id));
  if (clientSearch) {
    const q = clientSearch.toLowerCase();
    filteredClients = filteredClients.filter(s => s.name.toLowerCase().includes(q) || s.phone.includes(clientSearch));
  }
  if (filterCourse) filteredClients = filteredClients.filter(s => s.enrolledCourseIds.includes(filterCourse));
  if (filterReception) filteredClients = filteredClients.filter(s => getSubRounds(s.id).some(r => r.receptionId === filterReception));
  if (filterPay === 'outstanding') {
    filteredClients = filteredClients.filter(s => {
      const paid = (s.paymentHistory || []).reduce((sum, p) => p.currency === 'EGP' ? sum + Number(p.amount) : sum, 0);
      const expected = s.enrolledCourseIds.reduce((sum, cid) => sum + (courses.find(c => c.id === cid)?.price?.EGP ?? 0), 0);
      return expected > 0 && paid < expected;
    });
  } else if (filterPay === 'paid') {
    filteredClients = filteredClients.filter(s => {
      const paid = (s.paymentHistory || []).reduce((sum, p) => p.currency === 'EGP' ? sum + Number(p.amount) : sum, 0);
      const expected = s.enrolledCourseIds.reduce((sum, cid) => sum + (courses.find(c => c.id === cid)?.price?.EGP ?? 0), 0);
      return expected === 0 || paid >= expected;
    });
  }

  return (
    <div className="border border-blue-200 rounded-2xl bg-white overflow-hidden order-last">
      {/* Header toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-blue-100 bg-blue-50/40">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-blue-600" />
          <h4 className="font-bold text-gray-800 text-sm">
            عملاء فرع الدقي <span className="text-gray-400 font-normal">({filteredClients.length} / {daqqiSubs.length})</span>
          </h4>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-xl border border-gray-200 overflow-hidden text-xs">
            {(['all', 'assigned', 'unassigned'] as const).map(tab => {
              const labels: Record<string, string> = { all: 'الكل', assigned: 'المسكّنون', unassigned: 'الغير مسكّنون' };
              return (
                <button key={tab} onClick={() => setClientTab(tab)}
                  className={`px-3 py-1.5 font-bold transition ${clientTab === tab ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                  {labels[tab]}
                </button>
              );
            })}
          </div>
          <button onClick={onAddClient}
            className="flex items-center gap-1.5 bg-green-600 text-white px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-green-700 transition">
            <UserPlus size={13} /> إضافة عميل
          </button>
        </div>
      </div>
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 px-4 py-2.5 bg-gray-50/70 border-b border-gray-100">
        <div className="relative">
          <Search size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input type="text" placeholder="بحث بالاسم أو الهاتف..." value={clientSearch}
            onChange={e => setClientSearch(e.target.value)}
            className="pr-7 pl-3 py-1.5 border border-gray-200 rounded-lg text-xs min-w-[160px] focus:outline-none focus:border-blue-400 bg-white" />
        </div>
        <select value={filterCourse} onChange={e => setFilterCourse(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs min-w-[130px] bg-white">
          <option value="">كل الكورسات</option>
          {courses.map(c => <option key={c.id} value={c.id}>{c.titleAr || c.title}</option>)}
          {bundles.map(b => <option key={`bundle:${b.id}`} value={`bundle:${b.id}`}>📦 {b.title}</option>)}
        </select>
        <select value={filterReception} onChange={e => setFilterReception(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs min-w-[130px] bg-white">
          <option value="">كل الريسبشن</option>
          {receptionOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={filterPay} onChange={e => setFilterPay(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs min-w-[120px] bg-white">
          <option value="">كل الحالات المالية</option>
          <option value="outstanding">متبقي دفع</option>
          <option value="paid">مكتمل الدفع</option>
        </select>
        {(clientSearch || filterCourse || filterReception || filterPay) && (
          <button onClick={() => { setClientSearch(''); setFilterCourse(''); setFilterReception(''); setFilterPay(''); }}
            className="px-2 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 text-xs font-bold flex items-center gap-1">
            <X size={11} /> مسح
          </button>
        )}
      </div>
      {/* Table */}
      {filteredClients.length === 0 ? (
        <div className="py-10 text-center text-gray-400 text-sm">لا يوجد عملاء مطابقون للفلاتر.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] border-collapse" dir="rtl">
            <thead className="bg-gray-50 text-gray-700 sticky top-0 z-10">
              <tr>
                <th className="text-right px-2 py-2 border border-gray-200 font-semibold">الاسم</th>
                <th className="text-center px-1 py-2 border border-gray-200 font-semibold text-[11px] whitespace-nowrap">تاريخ الاشتراك</th>
                <th className="text-right px-2 py-2 border border-gray-200 font-semibold">الكورسات</th>
                <th className="text-center px-1 py-2 border border-gray-200 font-semibold text-[11px]">القيمة</th>
                <th className="text-center px-1 py-2 border border-gray-200 font-semibold text-[11px]">المدفوع</th>
                <th className="text-center px-1 py-2 border border-gray-200 font-semibold text-[11px]">المتبقي</th>
                <th className="text-center px-1 py-2 border border-gray-200 font-semibold text-[11px]">الشهادات</th>
                <th className="text-right px-2 py-2 border border-gray-200 font-semibold">رسيبشن الدقي</th>
                <th className="text-center px-1 py-2 border border-indigo-200 bg-indigo-50 font-semibold text-[11px] whitespace-nowrap text-indigo-700">التسكين والروند</th>
                <th className="text-right px-2 py-2 border border-gray-200 font-semibold">ملاحظات التواصل</th>
                <th className="text-right px-2 py-2 border border-gray-200 font-semibold">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.map(s => {
                const paidHistory = (s.paymentHistory || []).filter(p => p.status !== 'pending' && p.status !== 'failed');
                const pendingAmt = (s.paymentHistory || []).filter(p => p.status === 'pending').reduce((sum, p) => p.currency === 'EGP' ? sum + Number(p.amount) : sum, 0);
                const reception = getSubReception(s.id);
                const subRounds = getSubRounds(s.id);
                const totalPaid = paidHistory.reduce((sum, p) => p.currency === 'EGP' ? sum + Number(p.amount) : sum, 0);
                const sortedComms = [...(s.communications || [])].sort((a, b) => b.date.localeCompare(a.date));
                const lastComm = sortedComms[0] || null;
                const contactCell = lastComm ? (
                  <div>
                    <div className="text-gray-600 text-[10px] leading-snug">{lastComm.notes?.slice(0, 50) || lastComm.outcome || '—'}</div>
                    <div className="text-gray-400 text-[9px] mt-0.5">{lastComm.date.slice(0, 10)}</div>
                  </div>
                ) : <span className="text-gray-300 text-[10px]">—</span>;
                const courseRows = [...new Set(s.enrolledCourseIds)].map(cid => {
                  const course = courses.find(c => c.id === cid);
                  const bundle = cid.startsWith('bundle:') ? bundles.find(b => b.id === cid.replace('bundle:', '')) : null;
                  const cPay = paidHistory.filter(p => p.courseId === cid);
                  const paid = cPay.reduce((sum, p) => p.currency === 'EGP' ? sum + Number(p.amount) : sum, 0);
                  const price = bundle ? (bundle.price.EGP ?? 0) : (course?.price?.EGP ?? 0);
                  const certCount = (s.certificates || []).filter(cert => cert.courseId === cid).length;
                  return { cid, label: bundle?.title || course?.titleAr || course?.title || cid, price, paid, certCount };
                });
                const rowSpan = Math.max(courseRows.length, 1);
                const nameCell = (
                  <div className="min-w-0">
                    <button onClick={() => navigate(`/client/${s.clientCode || s.id}`)} className="font-bold text-gray-800 hover:text-primary-700 text-[11px] block truncate max-w-[110px]">{s.name}</button>
                    <a href={`tel:${s.phone}`} className="text-xs font-semibold text-blue-600">{s.phone}</a>
                    {pendingAmt > 0 && <div className="mt-0.5"><span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-1 rounded-full border border-amber-200">⏳ {pendingAmt.toLocaleString()}</span></div>}
                  </div>
                );
                const receptionCell = (
                  <div className="flex flex-col gap-0.5">
                    {reception
                      ? <div className="flex items-center gap-1">
                          <span className="inline-flex w-4 h-4 rounded-full bg-indigo-100 text-indigo-700 items-center justify-center text-[9px] font-bold flex-shrink-0">{(reception.name || '?').charAt(0)}</span>
                          <span className="font-medium text-indigo-700 text-[10px]">{reception.name}</span>
                        </div>
                      : <span className="text-gray-400 text-[10px]">— غير مسند —</span>}
                  </div>
                );
                const housingCell = subRounds.length > 0 ? (
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="inline-flex items-center gap-0.5 text-[9px] font-bold bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-full px-1.5 py-0.5">🏠 مسكن</span>
                    <div className="flex flex-wrap gap-0.5">
                      {subRounds.slice(0, 2).map(r => <span key={r.id} className="text-[9px] font-bold text-gray-700">{r.code}</span>)}
                    </div>
                  </div>
                ) : <span className="text-[9px] text-gray-400">غير مسكن</span>;
                const actionsCell = (
                  <div className="flex flex-col gap-0.5">
                    <div className="grid grid-cols-4 gap-0.5">
                      <button onClick={() => onComm(s.id, s.name, s.phone)} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-purple-50 hover:text-purple-600 flex items-center justify-center transition" title="تسجيل تواصل"><Phone size={12} /></button>
                      <button onClick={() => onPayment(s.id, s.name, s.enrolledCourseIds[0] || '')} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-green-50 hover:text-green-600 flex items-center justify-center transition" title="تسجيل دفعة"><CreditCard size={12} /></button>
                      <button onClick={() => { const wNum = s.phone.replace(/\D/g, ''); const waNum = wNum.startsWith('0') ? '2' + wNum : wNum; window.open(`https://wa.me/${waNum}`, '_blank'); }} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-teal-50 hover:text-teal-600 flex items-center justify-center transition" title="واتساب"><MessageCircle size={12} /></button>
                      <button onClick={() => navigate(`/client/${s.clientCode || s.id}`)} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-blue-50 hover:text-blue-600 flex items-center justify-center transition" title="عرض الملف"><Eye size={12} /></button>
                    </div>
                    <div className="grid grid-cols-3 gap-0.5">
                      <button title={subRounds.length > 0 ? `مسكن في روند ${subRounds[0]?.code}` : 'تسكين في روند'}
                        onClick={() => onHousing(s.id)}
                        className={`h-7 rounded flex items-center justify-center transition text-xs font-bold ${subRounds.length > 0 ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100' : 'bg-gray-50 text-gray-500 hover:bg-indigo-50 hover:text-indigo-600'}`}>
                        🏠
                      </button>
                      <button onClick={() => navigate(`/client/${s.clientCode || s.id}`)} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-orange-50 hover:text-orange-600 flex items-center justify-center transition" title="الملف الكامل"><ArrowLeftRight size={12} /></button>
                      <button onClick={() => { if (confirm(`حذف "${s.name}"؟`)) { mysqlAdmin.deleteSubscriber(s.id).then(() => notify('success', 'تم الحذف')).catch(() => notify('error', 'فشل الحذف')); } }} className="h-7 rounded bg-gray-50 text-red-400 hover:bg-red-50 hover:text-red-600 flex items-center justify-center transition" title="حذف"><X size={12} /></button>
                    </div>
                  </div>
                );
                if (courseRows.length === 0) {
                  return (
                    <tr key={s.id} className="hover:bg-gray-50/80">
                      <td className="px-2 py-2 border border-gray-200">{nameCell}</td>
                      <td className="px-2 py-2 border border-gray-200 text-center text-[10px] text-gray-500">{(s.createdAt || '').slice(0, 10) || '—'}</td>
                      <td className="px-3 py-2 border border-gray-200 text-xs text-gray-400">لا يوجد</td>
                      <td className="px-2 py-2 border border-gray-200 text-center text-gray-300 text-xs">—</td>
                      <td className="px-2 py-2 border border-gray-200 text-center">
                        {totalPaid > 0 ? <span className="font-bold text-emerald-700 text-[11px]">{totalPaid.toLocaleString()} ج.م</span> : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="px-2 py-2 border border-gray-200 text-center text-gray-300 text-xs">—</td>
                      <td className="px-2 py-2 border border-gray-200 text-center text-gray-300 text-xs">—</td>
                      <td className="px-2 py-2 border border-gray-200">{receptionCell}</td>
                      <td className="px-2 py-2 border border-indigo-100 text-center">{housingCell}</td>
                      <td className="px-2 py-2 border border-gray-200 text-[10px]">{contactCell}</td>
                      <td className="px-1 py-1.5 border border-gray-200 w-[90px]">{actionsCell}</td>
                    </tr>
                  );
                }
                return courseRows.map((cr, ci) => {
                  const courseRemaining = cr.price > 0 ? Math.max(0, cr.price - cr.paid) : 0;
                  return (
                    <tr key={`${s.id}-${cr.cid}`} className={`hover:bg-gray-50/40 ${ci % 2 === 1 ? 'bg-gray-50/30' : ''}`}>
                      {ci === 0 && <td rowSpan={rowSpan} className="px-2 py-2 border border-gray-200 align-top">{nameCell}</td>}
                      <td className="px-2 py-2 border border-gray-200 text-center text-[10px] text-gray-500 whitespace-nowrap">{(s.createdAt || '').slice(0, 10) || '—'}</td>
                      <td className="px-2 py-2 border border-gray-200 text-[11px] text-gray-700 max-w-[150px] truncate" title={cr.label}>{cr.label}</td>
                      <td className="px-2 py-2 border border-gray-200 text-center text-[11px] font-bold text-gray-600">{cr.price > 0 ? `${cr.price.toLocaleString()} ج.م` : '—'}</td>
                      <td className="px-2 py-2 border border-gray-200 text-center text-[11px] font-bold text-emerald-700">{cr.paid > 0 ? `${cr.paid.toLocaleString()} ج.م` : <span className="text-gray-300">—</span>}</td>
                      <td className="px-2 py-2 border border-gray-200 text-center text-[11px] font-bold">
                        {cr.price > 0
                          ? courseRemaining > 0
                            ? <span className="text-red-600">{courseRemaining.toLocaleString()} ج.م</span>
                            : <span className="text-emerald-600 text-[10px]">✅ مكتمل</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-2 py-2 border border-gray-200 text-center">
                        {cr.certCount > 0
                          ? <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-1.5 py-0.5">🎓 {cr.certCount}</span>
                          : <span className="text-gray-300 text-[10px]">—</span>}
                      </td>
                      {ci === 0 && <td rowSpan={rowSpan} className="px-2 py-2 border border-gray-200 align-top">{receptionCell}</td>}
                      {ci === 0 && <td rowSpan={rowSpan} className="px-2 py-2 border border-indigo-100 text-center align-top">{housingCell}</td>}
                      {ci === 0 && <td rowSpan={rowSpan} className="px-2 py-2 border border-gray-200 align-top text-[10px]">{contactCell}</td>}
                      {ci === 0 && <td rowSpan={rowSpan} className="px-1 py-1.5 border border-gray-200 align-top w-[90px]">{actionsCell}</td>}
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
