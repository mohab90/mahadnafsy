import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar, ExternalLink, MessageSquareText, Phone, Receipt, RefreshCw, Trash2, Wallet,
} from 'lucide-react';
import type {
  Bundle, CommunicationRecord, Course, 
  StaffMember, SubscriberItem,
} from '../../../../types';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { SUB_STATUS_CFG, normBranchId, type SubStatus } from '../../dashboardShared';
import { createClientPaymentDraft } from '../../../../lib/clientActionDrafts';
import { type SubscriberWithCustomPrices } from '../onlineClientsUtils';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type SubInstDraft = {
  courseId: string; currency: 'EGP'|'SAR'|'USD';
  amountPerInst: string; numInstallments: string;
  inputMode: 'count'|'amount'; startDate: string;
  intervalDays: string; notes: string; overrideExpected: string;
};
type SubContactDraft = {
  type: CommunicationRecord['type']; date: string;
  notes: string; outcome: string; nextFollowUp: string;
};
type HousingInfo = { roundId: string; roundCode: string; receptionId: string; receptionName: string };

interface Props {
  pageRows: SubscriberItem[];
  vc: Record<string, boolean>;
  cw: Record<string, number>;
  startColResize: (col: string, e: React.MouseEvent) => void;
  isDaqqiClientsTab: boolean;
  collOnlineSelected: Set<string>;
  setCollOnlineSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  housingMap: Map<string, HousingInfo>;
  courses: Course[];
  bundles: Bundle[];
  staffMembers: StaffMember[];
  onlineTeamMembers: StaffMember[];
  isAdmin: boolean;
  isOnlineManager: boolean;
  isDaqqiManager: boolean;
  shouldUseScopedSubscribers: boolean;
  updateSubscriber: (s: SubscriberItem) => void;
  setSalesOwnSubscribers: React.Dispatch<React.SetStateAction<SubscriberItem[]>>;
  deleteSubscriber: (id: string) => void;
  setSubPayRow: (row: SubscriberItem | null) => void;
  setSubPayDraft: React.Dispatch<React.SetStateAction<import('../../../../components/PaymentModal').PaymentDraft>>;
  setSubContactRow: (row: SubscriberItem | null) => void;
  setSubContactDraft: React.Dispatch<React.SetStateAction<SubContactDraft>>;
  setSubInstRow: (row: SubscriberItem | null) => void;
  setSubInstDraft: React.Dispatch<React.SetStateAction<SubInstDraft>>;
  setSubWaRow: (row: SubscriberItem | null) => void;
  setDaqqiHousingModal: (row: SubscriberItem | null) => void;
  setDaqqiHousingRoundId: (id: string) => void;
  setCollDetailsDraft: React.Dispatch<React.SetStateAction<{courseId:string;expected:string;paid:string;createdAt:string}[]>>;
  setCollDetailsRow: (row: SubscriberItem | null) => void;
  setConvertRow: (row: SubscriberItem | null) => void;
  setConvertType: (t: 'finished'|'paused'|'refunded'|'daqqi'|'leads'|'online'|'') => void;
  setConvertAttendedLive: (v: boolean) => void;
  setConvertGotCert: (v: boolean) => void;
  setConvertPauseReason: (v: string) => void;
  setConvertRefundReason: (v: string) => void;
  setConvertRefundAmount: (v: string) => void;
  setConvertRefundMethod: (v: string) => void;
  filteredLength: number;
  notify: NotifyFn;
}

export function ClientsTable({
  pageRows, vc, cw, startColResize, isDaqqiClientsTab, collOnlineSelected, setCollOnlineSelected,
  housingMap, courses, bundles, staffMembers, onlineTeamMembers, isAdmin, isOnlineManager,
  isDaqqiManager, shouldUseScopedSubscribers,
  updateSubscriber, setSalesOwnSubscribers, deleteSubscriber, setSubPayRow, setSubPayDraft,
  setSubContactRow, setSubContactDraft, setSubInstRow, setSubInstDraft, setSubWaRow,
  setDaqqiHousingModal, setDaqqiHousingRoundId, setCollDetailsDraft, setCollDetailsRow,
  setConvertRow, setConvertType, setConvertAttendedLive, setConvertGotCert, setConvertPauseReason,
  setConvertRefundReason, setConvertRefundAmount, setConvertRefundMethod, filteredLength, notify,
}: Props) {
  const navigate = useNavigate();
  const todayOnlineStr = new Date().toISOString().slice(0, 10);
  const in3daysOnlineStr = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const currFmt = (c: string) => c === 'SAR' ? 'ر.س' : c === 'USD' ? '$' : 'ج.م';

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]" dir="rtl">
        <thead className="bg-gray-50 text-gray-700 sticky top-0 z-10">
          <tr>
            <th className="px-2 py-2 border border-gray-200 text-center w-8">
              <input type="checkbox" className="accent-blue-600 cursor-pointer"
                checked={pageRows.length > 0 && pageRows.every(r => collOnlineSelected.has(r.id))}
                onChange={e => {
                  const next = new Set(collOnlineSelected);
                  if (e.target.checked) pageRows.forEach(r => next.add(r.id));
                  else pageRows.forEach(r => next.delete(r.id));
                  setCollOnlineSelected(next);
                }} />
            </th>
            <th className="text-right px-2 py-2 border border-gray-200 font-semibold relative select-none" style={cw['name']?{width:cw['name']}:{}}>الاسم<span onMouseDown={e=>startColResize('name',e)} className="absolute top-0 left-0 h-full w-1 cursor-col-resize hover:bg-blue-400 opacity-0 hover:opacity-100 transition-opacity z-20" /></th>
            {vc.createdAt  && <th className="text-center px-1 py-2 border border-gray-200 font-semibold text-[11px] whitespace-nowrap relative select-none" style={cw['createdAt']?{width:cw['createdAt']}:{}}>تاريخ الاشتراك<span onMouseDown={e=>startColResize('createdAt',e)} className="absolute top-0 left-0 h-full w-1 cursor-col-resize hover:bg-blue-400 opacity-0 hover:opacity-100 transition-opacity z-20" /></th>}
            {vc.courses    && <th className="text-right px-2 py-2 border border-gray-200 font-semibold relative select-none" style={cw['courses']?{width:cw['courses']}:{}}>الكورسات<span onMouseDown={e=>startColResize('courses',e)} className="absolute top-0 left-0 h-full w-1 cursor-col-resize hover:bg-blue-400 opacity-0 hover:opacity-100 transition-opacity z-20" /></th>}
            {vc.value      && <th className="text-center px-1 py-2 border border-gray-200 font-semibold text-[11px] relative select-none" style={cw['value']?{width:cw['value']}:{}}>القيمة<span onMouseDown={e=>startColResize('value',e)} className="absolute top-0 left-0 h-full w-1 cursor-col-resize hover:bg-blue-400 opacity-0 hover:opacity-100 transition-opacity z-20" /></th>}
            {vc.paid       && <th className="text-center px-1 py-2 border border-gray-200 font-semibold text-[11px] relative select-none" style={cw['paid']?{width:cw['paid']}:{}}>المدفوع<span onMouseDown={e=>startColResize('paid',e)} className="absolute top-0 left-0 h-full w-1 cursor-col-resize hover:bg-blue-400 opacity-0 hover:opacity-100 transition-opacity z-20" /></th>}
            {vc.remaining  && <th className="text-center px-1 py-2 border border-gray-200 font-semibold text-[11px] relative select-none" style={cw['remaining']?{width:cw['remaining']}:{}}>المتبقي<span onMouseDown={e=>startColResize('remaining',e)} className="absolute top-0 left-0 h-full w-1 cursor-col-resize hover:bg-blue-400 opacity-0 hover:opacity-100 transition-opacity z-20" /></th>}
            {vc.certificates && <th className="text-center px-1 py-2 border border-gray-200 font-semibold text-[11px] relative select-none" style={cw['certificates']?{width:cw['certificates']}:{}}>الشهادات<span onMouseDown={e=>startColResize('certificates',e)} className="absolute top-0 left-0 h-full w-1 cursor-col-resize hover:bg-blue-400 opacity-0 hover:opacity-100 transition-opacity z-20" /></th>}
            {vc.installments && <th className="text-right px-2 py-2 border border-gray-200 font-semibold whitespace-nowrap relative select-none" style={cw['installments']?{width:cw['installments']}:{}}>الأقساط<span onMouseDown={e=>startColResize('installments',e)} className="absolute top-0 left-0 h-full w-1 cursor-col-resize hover:bg-blue-400 opacity-0 hover:opacity-100 transition-opacity z-20" /></th>}
            {vc.status     && <th className="text-center px-1 py-2 border border-gray-200 font-semibold text-[11px] relative select-none" style={cw['status']?{width:cw['status']}:{}}>الحالة<span onMouseDown={e=>startColResize('status',e)} className="absolute top-0 left-0 h-full w-1 cursor-col-resize hover:bg-blue-400 opacity-0 hover:opacity-100 transition-opacity z-20" /></th>}
            {vc.sales      && <th className="text-right px-2 py-2 border border-gray-200 font-semibold relative select-none" style={cw['sales']?{width:cw['sales']}:{}}>{isDaqqiClientsTab ? 'رسيبشن الدقي' : 'المسئول'}<span onMouseDown={e=>startColResize('sales',e)} className="absolute top-0 left-0 h-full w-1 cursor-col-resize hover:bg-blue-400 opacity-0 hover:opacity-100 transition-opacity z-20" /></th>}
            {isDaqqiClientsTab && <th className="text-center px-1 py-2 border border-indigo-200 bg-indigo-50 font-semibold text-[11px] whitespace-nowrap text-indigo-700">التسكين والروند</th>}
            {vc.followup   && <th className="text-right px-2 py-2 border border-gray-200 font-semibold whitespace-nowrap relative select-none" style={cw['followup']?{width:cw['followup']}:{}}>موعد المتابعة<span onMouseDown={e=>startColResize('followup',e)} className="absolute top-0 left-0 h-full w-1 cursor-col-resize hover:bg-blue-400 opacity-0 hover:opacity-100 transition-opacity z-20" /></th>}
            {vc.contact    && <th className="text-right px-2 py-2 border border-gray-200 font-semibold relative select-none" style={cw['contact']?{width:cw['contact']}:{}}>ملاحظات التواصل<span onMouseDown={e=>startColResize('contact',e)} className="absolute top-0 left-0 h-full w-1 cursor-col-resize hover:bg-blue-400 opacity-0 hover:opacity-100 transition-opacity z-20" /></th>}
            <th className="text-right px-2 py-2 border border-gray-200 font-semibold">إجراءات</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row) => {
            const clientCode = row.clientCode || row.id;
            const salesName = row.assignedSalesName || '';
            const payments = row.paymentHistory || [];
            const enrolledIds = [...new Set(row.enrolledCourseIds || [])];
            const allCBundles = bundles.filter(b => b.courses.length > 0 && b.courses.every(co => enrolledIds.includes(co.id)));
            const completeBundles = allCBundles.filter(b => !allCBundles.some(other => other.id !== b.id && other.courses.length > b.courses.length && b.courses.every(co => other.courses.some(oc => oc.id === co.id))));
            const bundleHiddenIds = new Set(completeBundles.flatMap(b => b.courses.map(co => co.id)));
            const partialCids = enrolledIds.filter(id => !bundleHiddenIds.has(id));
            const branchId = normBranchId(row.branch);
            const detCur = (fp?: {currency?:string}): 'EGP'|'SAR'|'USD' =>
              (fp?.currency as 'EGP'|'SAR'|'USD') || (branchId === 'ONLINE_SAUDI' ? 'SAR' : branchId === 'ONLINE_ABROAD' ? 'USD' : 'EGP');
            const certTypeAr: Record<string,string> = {
              social_solidarity:'تضامن اجتماعي', ain_shams:'عين شمس',
              experience_external:'خبرة خارجية', practice_external:'ممارسة خارجية',
              national_council:'المجلس القومي', american_board:'البورد الأمريكي',
              institute:'معهد', other:'أخرى',
            };
            const certLabel = (t?: string) => (t && certTypeAr[t]) ? certTypeAr[t] : (t || 'شهادة');
            const customPrices: Record<string,number> = (row as SubscriberWithCustomPrices).customPrices || {};
            const multiCourseKey = completeBundles.length === 0 && partialCids.length > 1
              ? `multi:${[...partialCids].sort().join(',')}`
              : null;
            const courseRows = (multiCourseKey)
              ? (() => {
                  const totalPaid = payments.filter(p => p.paymentType !== 'certificate' && p.paymentType !== 'book').reduce((s,p)=>s+(Number(p.amount)||0),0);
                  const autoExp = partialCids.reduce((s, cid) => {
                    const nb2 = payments.find(p => p.courseId === cid && !p.isInstallment && p.paymentType !== 'certificate');
                    const catP = courses.find(c=>c.id===cid)?.price?.EGP || 0;
                    return s + (nb2?.courseExpected || catP);
                  }, 0);
                  const exp = customPrices[multiCourseKey] || autoExp;
                  const lbl = 'باقة: ' + partialCids.map(cid => courses.find(c=>c.id===cid)?.title || cid).join(' + ');
                  return [{ cid: multiCourseKey, label: lbl, expected: exp, paid: totalPaid, remaining: Math.max(0, exp - totalPaid), cur: detCur(payments[0]) }];
                })()
              : [
              ...completeBundles.map(b => {
                const bCids = b.courses.map(co => co.id);
                const bundleCid = `bundle:${b.id}`;
                const bPay = payments.filter(p => (p.courseId && bCids.includes(p.courseId)) || (p.bundleId === b.id) || (!p.courseId && !p.bundleId && (p.paymentType === 'course' || !p.paymentType)));
                const cur = detCur(bPay[0]);
                const nb = bPay.find(p => !p.isInstallment);
                const bPrice = (b.price as unknown as Record<string,number>)[cur] || b.price.EGP || 0;
                const expected = customPrices[bundleCid] || nb?.courseExpected || bPrice || 0;
                const paid = bPay.reduce((s,p) => s+(Number(p.amount)||0), 0);
                return { cid: bundleCid, label: b.title, expected, paid, remaining: expected > 0 ? Math.max(0, expected-paid) : 0, cur };
              }),
              ...partialCids.map((cid, pidx) => {
                const course = courses.find(c => c.id === cid);
                const cPayBase = payments.filter(p => p.courseId === cid && p.paymentType !== 'certificate' && p.paymentType !== 'book');
                // Fallback: attribute payments with no courseId to first course when no bundles
                // Exclude bundleId-tagged payments (they belong to a bundle, not first course)
                const unattributed = (pidx === 0 && completeBundles.length === 0)
                  ? payments.filter(p => !p.courseId && !p.bundleId && (p.paymentType === 'course' || !p.paymentType))
                  : [];
                const cPay = [...cPayBase, ...unattributed];
                const nb = cPay.find(p => !p.isInstallment);
                const cur = detCur(nb || payments[0]);
                const catPrice = course?.price?.[cur] || course?.price?.EGP || 0;
                const expected = customPrices[cid] || nb?.courseExpected || catPrice;
                const paid = cPay.reduce((s,p) => s+(Number(p.amount)||0), 0);
                return { cid, label: course?.title || cid, expected, paid, remaining: expected > 0 ? Math.max(0, expected-paid) : 0, cur };
              }),
            ];
            const instPlans = row.installmentPlans || [];
            const nextInst = instPlans.flatMap(p => (p.entries||[]).filter(e=>!e.paidAt).map(e=>({dueDate:e.dueDate,amount:e.amount,currency:p.currency,note:e.note||p.courseTitle||''}))).sort((a,b)=>a.dueDate.localeCompare(b.dueDate))[0] || null;
            const instOverdue = !!(nextInst && nextInst.dueDate < todayOnlineStr);
            const instToday  = !!(nextInst && nextInst.dueDate === todayOnlineStr);
            const instSoon   = !!(nextInst && !instOverdue && !instToday && nextInst.dueDate <= in3daysOnlineStr);
            const comms = row.communications || [];
            const lastComm = comms.length > 0 ? [...comms].sort((a,b)=>b.date.localeCompare(a.date))[0] : null;
            const commActor = lastComm ? (staffMembers.find(s => s.id === (lastComm as {actorId?:string}).actorId)?.name || (lastComm as {actorName?:string}).actorName || '') : '';
            const rowSpan = Math.max(courseRows.length, 1);
            const instCell = (
              nextInst ? (
                <div className={`text-[10px] rounded-lg p-1.5 border ${instOverdue?'bg-red-50 border-red-200':instToday?'bg-amber-50 border-amber-200':instSoon?'bg-yellow-50 border-yellow-200':'bg-gray-50 border-gray-100'}`}>
                  <div className={`font-bold ${instOverdue?'text-red-700':instToday?'text-amber-700':instSoon?'text-yellow-700':'text-gray-600'}`}>
                    {instOverdue?'🔴':instToday?'🟡':instSoon?'🟠':'📅'} {nextInst.dueDate}
                  </div>
                  <div className="font-bold text-gray-800 mt-0.5">{nextInst.amount.toLocaleString()} {currFmt(nextInst.currency)}</div>
                </div>
              ) : <span className="text-gray-300 text-[10px]">—</span>
            );
            const statusCell = (
              <select value={row.status||'active'} onChange={e => {
                const nextStatus = e.target.value as SubscriberItem['status'];
                // `status` (this dropdown) and `clientStatus` (which tab the client shows
                // in — المنتهين/المتوقفين/المستردين) were two separate, unsynced fields:
                // picking "استرداد معلق" here changed the row's color but never moved the
                // client to the الاسترداد tab and never created a real refund request. Keep
                // them in sync for the statuses that have a matching tab.
                const clientStatusMap: Partial<Record<string, SubscriberItem['clientStatus']>> = {
                  finished: 'finished', paused: 'paused',
                  refunded: 'refunded', refund_pending: 'refund_pending',
                };
                const nextClientStatus = clientStatusMap[nextStatus as string];
                const nextRow = nextClientStatus ? { ...row, status: nextStatus, clientStatus: nextClientStatus } : { ...row, status: nextStatus };
                updateSubscriber(nextRow);
                if (nextStatus === 'refunded' || nextStatus === 'refund_pending') {
                  mysqlAdmin.adminPost('/admin/refund-requests/by-admin', {
                    subscriber_id: row.id,
                    amount: row.totalPaid || 0,
                    currency: 'EGP',
                    reason: 'تغيير حالة العميل من صفحة العملاء',
                  }).catch((err: unknown) => notify('error', 'تم تغيير حالة العميل لكن فشل إنشاء طلب الاسترداد: ' + (err instanceof Error ? err.message : String(err))));
                }
              }}
                className={`text-[11px] font-bold border-0 rounded-full px-2 py-0.5 focus:outline-none cursor-pointer w-full ${(SUB_STATUS_CFG[(row.status||'active') as SubStatus]||SUB_STATUS_CFG.active).cls}`}>
                {(Object.entries(SUB_STATUS_CFG) as [SubStatus,{label:string;cls:string}][]).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
              </select>
            );
            const csName = (row as unknown as {assignedCsName?: string}).assignedCsName || '';
            // Housing info for this row (daqqi tab only)
            const rowHousing = housingMap.get(row.id) || null;
            const housingCell = isDaqqiClientsTab ? (
              rowHousing ? (
                <div className="flex flex-col items-center gap-0.5">
                  <span className="inline-flex items-center gap-0.5 text-[9px] font-bold bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-full px-1.5 py-0.5">🏠 مسكن</span>
                  <span className="text-[9px] font-bold text-gray-700">{rowHousing.roundCode}</span>
                </div>
              ) : (
                <span className="text-[9px] text-gray-400">غير مسكن</span>
              )
            ) : null;
            // Sales cell: for daqqi tab show reception from round, otherwise show collection
            const salesCell = isDaqqiClientsTab ? (
              <div className="flex flex-col gap-0.5">
                {rowHousing ? (
                  <>
                    <div className="flex items-center gap-1">
                      <span className="inline-flex w-4 h-4 rounded-full bg-indigo-100 text-indigo-700 items-center justify-center text-[9px] font-bold flex-shrink-0">{(rowHousing.receptionName||'?').charAt(0)}</span>
                      <span className="font-medium text-indigo-700 text-[10px]">{rowHousing.receptionName}</span>
                    </div>
                    <span className="text-[9px] text-gray-400">روند: {rowHousing.roundCode}</span>
                  </>
                ) : <span className="text-gray-400 text-[10px]">— غير مسند —</span>}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {salesName && <div className="flex items-center gap-1">
                  <span className="inline-flex w-4 h-4 rounded-full bg-orange-100 text-orange-700 items-center justify-center text-[9px] font-bold flex-shrink-0">{salesName.charAt(0)}</span>
                  <span className="font-medium text-gray-700 text-[10px]">{salesName}</span>
                </div>}
                {(isAdmin||isOnlineManager) ? (
                  <select
                    value={row.assignedCsId||''}
                    onChange={async e=>{
                      const csId=e.target.value;
                      const csStaffMember=(isOnlineManager?onlineTeamMembers:staffMembers).find(st=>st.id===csId);
                      const updated={...row,assignedCsId:csId||undefined,assignedCsName:csStaffMember?.name||undefined};
                      updateSubscriber(updated);
                      if(shouldUseScopedSubscribers) setSalesOwnSubscribers(prev=>prev.map(s=>s.id===row.id?updated:s));
                      await mysqlAdmin.assignSubscriberCollection(row.id,csId||null,csStaffMember?.name||null);
                    }}
                    className="w-full border border-gray-200 rounded text-[10px] px-1 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-teal-300"
                    title="مسئول التحصيل">
                    <option value="">— مسئول التحصيل —</option>
                    {(isOnlineManager?onlineTeamMembers:staffMembers).filter(st=>(st.role||'').toLowerCase()==='collection').map(st=><option key={st.id} value={st.id}>{st.name}</option>)}
                  </select>
                ) : csName ? (
                  <div className="flex items-center gap-1">
                    <span className="inline-flex w-4 h-4 rounded-full bg-blue-100 text-blue-700 items-center justify-center text-[9px] font-bold flex-shrink-0">{csName.charAt(0)}</span>
                    <span className="text-blue-600 text-[10px]">{csName}</span>
                  </div>
                ) : null}
                {!salesName && !csName && !(isAdmin||isOnlineManager) && <span className="text-gray-300">—</span>}
              </div>
            );
            const followupDate = row.nextFollowUpDate || (lastComm as CommunicationRecord | null)?.nextFollowUp || null;
            const todayStr2 = new Date().toISOString().slice(0, 10);
            const followupOverdue = !!(followupDate && followupDate < todayStr2);
            const followupToday = !!(followupDate && followupDate === todayStr2);
            const followupCell = followupDate ? (
              <div className={`text-[10px] font-semibold rounded-lg px-1.5 py-1 border whitespace-nowrap ${followupOverdue ? 'bg-red-50 border-red-200 text-red-700' : followupToday ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-indigo-50 border-indigo-200 text-indigo-700'}`}>
                {followupOverdue ? '🔴' : followupToday ? '🟡' : '📅'} {followupDate.slice(0, 10)}
              </div>
            ) : <span className="text-gray-300 text-[10px]">—</span>;
            const contactCell = lastComm ? (
              <div>
                {commActor && <div className="font-semibold text-gray-700 whitespace-nowrap">{commActor} :</div>}
                <div className="text-gray-600">{lastComm.notes?.slice(0,40) || lastComm.outcome || '—'}</div>
                <div className="text-gray-400 mt-0.5">{lastComm.date.slice(0,10)}</div>
              </div>
            ) : <span className="text-gray-300">—</span>;
            const actionsCell = (
              <div className="flex flex-col gap-0.5">
                <div className="grid grid-cols-4 gap-0.5">
                  <button title="ملف العميل" onClick={()=>navigate(`/client/${clientCode}`)} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-primary-50 hover:text-primary-600 flex items-center justify-center transition"><ExternalLink size={12}/></button>
                  <button title="تسجيل دفعة" onClick={()=>{
                    setSubPayRow(row);
                    setSubPayDraft(createClientPaymentDraft({
                      currency: (branchId==='ONLINE_ABROAD'||branchId==='ONLINE_SAUDI')?'SAR':'EGP',
                      courseId: completeBundles.length > 0 ? `bundle:${completeBundles[0].id}` : (row.enrolledCourseIds?.[0] || ''),
                    }));
                    setSubPayDraft(prev => ({ ...prev, bookingType: (row.enrolledCourseIds||[]).length > 0 ? 'installment' : 'new_booking' }));
                  }} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-emerald-50 hover:text-emerald-600 flex items-center justify-center transition"><Wallet size={12}/></button>
                  <button title="تواصل" onClick={()=>{setSubContactRow(row);setSubContactDraft({type:'call',date:new Date().toISOString().slice(0,16),notes:'',outcome:'',nextFollowUp:''}); }} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-blue-50 hover:text-blue-600 flex items-center justify-center transition"><Phone size={12}/></button>
                  <button title="خطة أقساط" onClick={()=>{setSubInstRow(row);setSubInstDraft({courseId:'',currency:'EGP',amountPerInst:'',numInstallments:'3',inputMode:'count',startDate:new Date().toISOString().slice(0,10),intervalDays:'30',notes:'',overrideExpected:''}); }} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-purple-50 hover:text-purple-600 flex items-center justify-center transition"><Calendar size={12}/></button>
                </div>
                <div className={`grid gap-0.5 ${(isDaqqiClientsTab||isAdmin||isOnlineManager||isDaqqiManager)?'grid-cols-4':'grid-cols-3'}`}>
                  <button title="واتساب" onClick={()=>setSubWaRow(row)} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-green-50 hover:text-green-600 flex items-center justify-center transition"><MessageSquareText size={12}/></button>
                  {isDaqqiClientsTab ? (
                    <button title={rowHousing ? `مسكن في روند ${rowHousing.roundCode}` : 'تسكين في روند'} onClick={()=>{ setDaqqiHousingModal(row); setDaqqiHousingRoundId(rowHousing?.roundId||''); }}
                      className={`h-7 rounded flex items-center justify-center transition text-xs font-bold ${rowHousing ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100' : 'bg-gray-50 text-gray-500 hover:bg-indigo-50 hover:text-indigo-600'}`}>
                      🏠
                    </button>
                  ) : (
                    <button title="تفاصيل الكورسات" onClick={()=>{
                      const draft = courseRows.map(cr => ({
                        courseId: cr.cid,
                        expected: cr.expected > 0 ? String(cr.expected) : '',
                        paid: cr.paid > 0 ? String(cr.paid) : '',
                        createdAt: (row.createdAt||'').slice(0,10),
                      }));
                      setCollDetailsDraft(draft);
                      setCollDetailsRow(row);
                    }} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-indigo-50 hover:text-indigo-600 flex items-center justify-center transition"><Receipt size={12}/></button>
                  )}
                  <button title="تحويل" onClick={()=>{setConvertRow(row);setConvertType('');setConvertAttendedLive(false);setConvertGotCert(false);setConvertPauseReason('');setConvertRefundReason('');setConvertRefundAmount('');setConvertRefundMethod('');}} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-orange-50 hover:text-orange-600 flex items-center justify-center transition"><RefreshCw size={12}/></button>
                  {/* Was gated on "is the Daqqi tab open" instead of "can this role actually delete" —
                      reception_daqqi could see and click this, but the backend (requireAdmin, i.e.
                      admin/manager/online_manager/daqqi_manager only) silently rejected it. */}
                  {(isAdmin||isOnlineManager||isDaqqiManager) && <button title="حذف العميل" onClick={()=>{if(confirm(`حذف "${row.name}"؟ لا يمكن التراجع.`)){deleteSubscriber(row.id);if(shouldUseScopedSubscribers) setSalesOwnSubscribers(prev=>prev.filter(s=>s.id!==row.id));
                  }}} className="h-7 rounded bg-gray-50 text-red-400 hover:bg-red-50 hover:text-red-600 flex items-center justify-center transition"><Trash2 size={12}/></button>}
                </div>
              </div>
            );
            return courseRows.length === 0 ? (
              <tr key={row.id} className={`hover:bg-gray-50/80 ${collOnlineSelected.has(row.id)?'bg-blue-50':''}`}>
                <td className="px-2 py-2 border border-gray-200 text-center w-8">
                  <input type="checkbox" className="accent-blue-600 cursor-pointer" checked={collOnlineSelected.has(row.id)} onChange={e => {
                    const next = new Set(collOnlineSelected);
                    if (e.target.checked) next.add(row.id); else next.delete(row.id);
                    setCollOnlineSelected(next);
                  }} />
                </td>
                <td className="px-2 py-2 border border-gray-200">
                  <div className="min-w-0">
                    {(() => {
                      const isEnglish = /^[a-zA-Z\s]+$/.test(row.name.trim());
                      const displayName = isEnglish ? row.name.trim().split(/\s+/).slice(0,2).join(' ') : row.name;
                      return <button onClick={()=>navigate(`/client/${clientCode}`)} className="font-bold text-gray-800 hover:text-primary-700 text-[11px] block truncate max-w-[110px]" dir={isEnglish?'ltr':'rtl'}>{displayName}</button>;
                    })()}
                    <a href={`tel:${row.phone}`} className="text-xs font-semibold text-blue-600">{row.phone}</a>
                    {row.clientStatus && row.clientStatus !== 'active' && (() => {
                      const csBadge: Record<string,string> = {finished:'bg-green-100 text-green-700',paused:'bg-amber-100 text-amber-700',refunded:'bg-red-100 text-red-700',refund_pending:'bg-orange-100 text-orange-700',leads:'bg-purple-100 text-purple-700'};
                      const csLabel: Record<string,string> = {finished:'✅ منتهي',paused:'⏸ متوقف',refunded:'↩️ مسترد',refund_pending:'⏳ استرداد معلق',leads:'👥 محتمل'};
                      return <span className={`inline-block mt-0.5 text-[9px] font-bold rounded-full px-1.5 py-0.5 ${csBadge[row.clientStatus]||'bg-gray-100 text-gray-500'}`}>{csLabel[row.clientStatus]||row.clientStatus}</span>;
                    })()}
                  </div>
                </td>
                {vc.createdAt  && <td className="px-2 py-2 border border-gray-200 text-center text-[10px] text-gray-500 whitespace-nowrap">{(row.createdAt||'').slice(0,10)||'—'}</td>}
                {vc.courses    && <td className="px-3 py-2 border border-gray-200 text-xs text-gray-400">لا يوجد</td>}
                {vc.value      && <td className="px-2 py-2 border border-gray-200 text-center text-gray-300 text-xs">—</td>}
                {vc.paid       && <td className="px-2 py-2 border border-gray-200 text-center text-gray-300 text-xs">—</td>}
                {vc.remaining  && <td className="px-2 py-2 border border-gray-200 text-center text-gray-300 text-xs">—</td>}
                {vc.certificates && <td className="px-2 py-2 border border-gray-200 text-center text-[10px]">
                  {(() => {
                    const issuedCerts = row.certificates||[];
                    const certReqs = row.extraCertificateRequests||[];
                    if (issuedCerts.length === 0 && certReqs.length === 0) return <span className="text-gray-300">—</span>;
                    return (
                      <div className="flex flex-col items-center gap-0.5">
                        {issuedCerts.slice(0,3).map((cert,ci2) => (
                          <span key={ci2} className="inline-flex items-center gap-0.5 font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-1.5 py-0.5 text-[9px]">🎓 {(cert as {certificateNumber?:string}).certificateNumber||'شهادة'}</span>
                        ))}
                        {certReqs.map((req, rqi) => {
                          const reqPaid = req.paidAmount||0;
                          const reqTotal = req.price||0;
                          const reqRem = Math.max(0, reqTotal - reqPaid);
                          return (
                            <div key={rqi} className="w-full text-center">
                              <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded-full ${reqRem<=0?'bg-emerald-100 text-emerald-700':'bg-orange-100 text-orange-700'}`}>📜 {certLabel(req.type)}</span>
                              {reqTotal > 0 && <div className="text-[9px] text-gray-500"><span className="text-emerald-600 font-bold">{reqPaid.toLocaleString()}</span>{reqRem > 0 && <span className="text-red-500 font-bold"> / م {reqRem.toLocaleString()}</span>} {(req.currency||'EGP')==='SAR'?'ر.س':(req.currency||'EGP')==='USD'?'$':'ج'}</div>}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </td>}
                {vc.installments && <td className="px-2 py-2 border border-gray-200">{instCell}</td>}
                {vc.status     && <td className="px-2 py-2 border border-gray-200 text-center">{statusCell}</td>}
                {vc.sales      && <td className="px-3 py-2 border border-gray-200 text-xs">{salesCell}</td>}
                {isDaqqiClientsTab && <td className="px-2 py-2 border border-indigo-100 text-center">{housingCell}</td>}
                {vc.followup   && <td className="px-2 py-2 border border-gray-200 text-[10px]">{followupCell}</td>}
                {vc.contact    && <td className="px-2 py-2 border border-gray-200 text-[10px]">{contactCell}</td>}
                <td className="px-1 py-1.5 border border-gray-200">{actionsCell}</td>
              </tr>
            ) : (
              courseRows.map((cr, ci) => {
                // Per-course subscription date: first payment date for this course
                const crPays = payments.filter(p => p.courseId === cr.cid || (cr.cid.startsWith('bundle:') && p.courseId && bundles.find(b=>`bundle:${b.id}`===cr.cid)?.courses.some(co=>co.id===p.courseId)));
                const crFirstPayDate = crPays.length > 0 ? [...crPays].sort((a,b)=>(a.at||'').localeCompare(b.at||''))[0]?.at?.slice(0,10) || (row.createdAt||'').slice(0,10) : (row.createdAt||'').slice(0,10);
                // Per-course certificate: check if cert exists for this courseId
                const crCertId = cr.cid.startsWith('bundle:') ? cr.cid.replace('bundle:','') : cr.cid;
                const crCert = (row.certificates||[]).find(cert => cert.courseId === crCertId || cert.courseId === cr.cid);
                const crCertReqs = (row.extraCertificateRequests||[]).filter(req => req.courseId === crCertId || req.courseId === cr.cid);
                const crCertStatus = cr.remaining <= 0 ? 'مكتمل' : 'جزئي';
                return (
                <tr key={`${row.id}-${cr.cid}`} className={`hover:bg-gray-50/40 ${ci%2===1?'bg-gray-50/30':''} ${collOnlineSelected.has(row.id)?'bg-blue-50':''}`}>
                  {ci === 0 && (
                    <td rowSpan={rowSpan} className="px-2 py-2 border border-gray-200 text-center w-8 align-top">
                      <input type="checkbox" className="accent-blue-600 cursor-pointer mt-1" checked={collOnlineSelected.has(row.id)} onChange={e => {
                        const next = new Set(collOnlineSelected);
                        if (e.target.checked) next.add(row.id); else next.delete(row.id);
                        setCollOnlineSelected(next);
                      }} />
                    </td>
                  )}
                  {ci === 0 && (
                    <td rowSpan={rowSpan} className="px-2 py-2 border border-gray-200 align-top">
                      <div className="min-w-0">
                        {(() => {
                          const isEnglish = /^[a-zA-Z\s]+$/.test(row.name.trim());
                          const displayName = isEnglish ? row.name.trim().split(/\s+/).slice(0,2).join(' ') : row.name;
                          return <button onClick={()=>navigate(`/client/${clientCode}`)} className="font-bold text-gray-800 hover:text-primary-700 text-[11px] block truncate max-w-[110px]" dir={isEnglish?'ltr':'rtl'}>{displayName}</button>;
                        })()}
                        <a href={`tel:${row.phone}`} className="text-xs font-semibold text-blue-600">{row.phone}</a>
                        {row.clientStatus && row.clientStatus !== 'active' && (() => {
                          const csBadge: Record<string,string> = {finished:'bg-green-100 text-green-700',paused:'bg-amber-100 text-amber-700',refunded:'bg-red-100 text-red-700',refund_pending:'bg-orange-100 text-orange-700',leads:'bg-purple-100 text-purple-700'};
                          const csLabel: Record<string,string> = {finished:'✅ منتهي',paused:'⏸ متوقف',refunded:'↩️ مسترد',refund_pending:'⏳ استرداد معلق',leads:'👥 محتمل'};
                          return <span className={`inline-block mt-0.5 text-[9px] font-bold rounded-full px-1.5 py-0.5 ${csBadge[row.clientStatus]||'bg-gray-100 text-gray-500'}`}>{csLabel[row.clientStatus]||row.clientStatus}</span>;
                        })()}
                      </div>
                    </td>
                  )}
                  {vc.createdAt && <td className="px-2 py-2 border border-gray-200 text-center text-[10px] text-gray-500 whitespace-nowrap">{crFirstPayDate||'—'}</td>}
                  {vc.courses && <td className="px-2 py-2 border border-gray-200 text-[11px] text-gray-700 max-w-[160px] truncate" title={cr.label}>{cr.label}</td>}
                  {vc.value && <td className="px-2 py-2 border border-gray-200 text-center text-[11px] font-bold text-gray-700">
                    {cr.expected > 0 ? `${cr.expected.toLocaleString()} ${currFmt(cr.cur)}` : '—'}
                  </td>}
                  {vc.paid && <td className="px-2 py-2 border border-gray-200 text-center text-[11px] font-bold text-emerald-700">
                    {cr.paid > 0 ? `${cr.paid.toLocaleString()} ${currFmt(cr.cur)}` : '—'}
                  </td>}
                  {vc.remaining && <td className="px-2 py-2 border border-gray-200 text-center text-[11px] font-bold">
                    {cr.remaining > 0 ? <span className="text-red-600">{cr.remaining.toLocaleString()} {currFmt(cr.cur)}</span> : <span className="text-emerald-600 text-[10px]">✅ مكتمل</span>}
                  </td>}
                  {vc.certificates && <td className="px-2 py-2 border border-gray-200 text-center text-[10px]">
                    {(crCert || crCertReqs.length > 0) ? (
                      <div className="flex flex-col items-center gap-0.5">
                        {crCert && (
                          <>
                            <span className="inline-flex items-center gap-0.5 font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-1.5 py-0.5">🎓 {crCert.certificateNumber||'شهادة'}</span>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${crCertStatus==='مكتمل'?'bg-emerald-100 text-emerald-700':'bg-orange-100 text-orange-700'}`}>{crCertStatus}</span>
                          </>
                        )}
                        {crCertReqs.map((req, rqi) => {
                          const reqPaid = req.paidAmount||0;
                          const reqTotal = req.price||0;
                          const reqRem = Math.max(0, reqTotal - reqPaid);
                          return (
                            <div key={rqi} className="w-full text-center">
                              <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded-full ${reqRem<=0?'bg-emerald-100 text-emerald-700':'bg-orange-100 text-orange-700'}`}>📜 {certLabel(req.type)}</span>
                              {reqTotal > 0 && <div className="text-[9px]"><span className="text-emerald-600 font-bold">{reqPaid.toLocaleString()}</span>{reqRem > 0 && <span className="text-red-500 font-bold"> / م {reqRem.toLocaleString()}</span>} <span className="text-gray-400">{(req.currency||'EGP')==='SAR'?'ر.س':(req.currency||'EGP')==='USD'?'$':'ج'}</span></div>}
                            </div>
                          );
                        })}
                      </div>
                    ) : <span className="text-gray-300">—</span>}
                  </td>}
                  {ci === 0 && vc.installments && <td rowSpan={rowSpan} className="px-2 py-2 border border-gray-200 align-top">{instCell}</td>}
                  {ci === 0 && vc.status && <td rowSpan={rowSpan} className="px-2 py-2 border border-gray-200 text-center align-top">{statusCell}</td>}
                  {ci === 0 && vc.sales && <td rowSpan={rowSpan} className="px-3 py-2 border border-gray-200 text-xs align-top">{salesCell}</td>}
                  {ci === 0 && isDaqqiClientsTab && <td rowSpan={rowSpan} className="px-2 py-2 border border-indigo-100 text-center align-top">{housingCell}</td>}
                  {ci === 0 && vc.followup && <td rowSpan={rowSpan} className="px-2 py-2 border border-gray-200 text-[10px] align-top">{followupCell}</td>}
                  {ci === 0 && vc.contact && <td rowSpan={rowSpan} className="px-2 py-2 border border-gray-200 text-[10px] align-top">{contactCell}</td>}
                  {ci === 0 && <td rowSpan={rowSpan} className="px-1 py-1.5 border border-gray-200 align-top w-[90px]">{actionsCell}</td>}
                </tr>
                );
              })
            );
          })}
        </tbody>
      </table>
      {filteredLength === 0 && <p className="text-sm text-gray-500 mt-3">لا يوجد عملاء مطابقين للبحث.</p>}
    </div>
  );
}
