import React from 'react';
import { cairoDateOnly, cairoDay, cairoDaysAhead } from '../../../../../shared/cairoDate';
import { Modal } from '../../../../../shared/ui/Modal';
import { useNavigate } from 'react-router-dom';
import {
  CalendarClock, ExternalLink, Phone, Receipt, RefreshCw, Trash2, Wallet,
} from 'lucide-react';
import type {
  Bundle, CommunicationRecord, Course, 
  StaffMember, SubscriberItem,
} from '../../../../types';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { SUB_STATUS_CFG, normBranchId, type SubStatus } from '../../dashboardShared';
import { createClientPaymentDraft } from '../../../../lib/clientActionDrafts';
import { BRANCH_LABELS_AR, normalizeBranch } from '../../../../constants/branches';

/** The branch as a person reads it. Falls back to whatever is stored so an
 *  unrecognised value shows rather than disappearing into an em dash. */
const branchLabel = (value?: string | null): string => {
  const key = normalizeBranch(value);
  return key ? BRANCH_LABELS_AR[key] : (String(value || '').trim() || '—');
};
import { ClientCourseAccessPanel } from './ClientCourseAccessPanel';
import { currencyForBranch } from '../../../../lib/branchCurrency';
import { isOnlineClient, subscriberMarket } from '../onlineClientsUtils';
import { clientItems } from '../../../../lib/agreedPrice';
import { isCollected } from '../../../../lib/money';
import ClientNameCell from './ClientNameCell';
import type { OnlineClientConvertType } from '../OnlineClientConvertModal';
import { waLink } from '../../../../lib/whatsappLink';
import { WhatsAppIcon } from '../../../../components/WhatsAppIcon';
import { useCertificateCatalog } from '../../../../lib/certificateCatalog';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
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
  canDeleteSubscriber: boolean;
  shouldUseScopedSubscribers: boolean;
  updateSubscriber: (s: SubscriberItem) => Promise<boolean>;
  reloadSubscribers: () => Promise<void>;
  setSalesOwnSubscribers: React.Dispatch<React.SetStateAction<SubscriberItem[]>>;
  deleteSubscriber: (id: string) => Promise<boolean>;
  setSubPayRow: (row: SubscriberItem | null) => void;
  setSubPayDraft: React.Dispatch<React.SetStateAction<import('../../../../components/PaymentModal').PaymentDraft>>;
  setDaqqiHousingModal: (row: SubscriberItem | null) => void;
  setDaqqiHousingRoundId: (id: string) => void;
  setConvertRow: (row: SubscriberItem | null) => void;
  setConvertType: (t: OnlineClientConvertType) => void;
  setConvertAttendedLive: (v: boolean) => void;
  setConvertGotCert: (v: boolean) => void;
  setConvertPauseReason: (v: string) => void;
  setConvertRefundReason: (v: string) => void;
  setConvertRefundAmount: (v: string) => void;
  setConvertRefundMethod: (v: string) => void;
  /** «الأقساط» — the client's plans, a new schedule, paying an instalment. */
  setInstallmentsRow: (row: SubscriberItem | null) => void;
  filteredLength: number;
  notify: NotifyFn;
}

export function ClientsTable({
  pageRows, vc, cw, startColResize, isDaqqiClientsTab, collOnlineSelected, setCollOnlineSelected,
  housingMap, courses, bundles, staffMembers, onlineTeamMembers, isAdmin, isOnlineManager,
  canDeleteSubscriber, shouldUseScopedSubscribers,
  updateSubscriber, reloadSubscribers, setSalesOwnSubscribers, deleteSubscriber, setSubPayRow, setSubPayDraft,
  setDaqqiHousingModal, setDaqqiHousingRoundId,
  setConvertRow, setConvertType, setConvertAttendedLive, setConvertGotCert, setConvertPauseReason,
  setConvertRefundReason, setConvertRefundAmount, setConvertRefundMethod, setInstallmentsRow, filteredLength, notify,
}: Props) {
  // Which customer we are adjusting course access for. The default length is
  // set per course in the catalogue; this is where one person is changed.
  const [accessRow, setAccessRow] = React.useState<SubscriberItem | null>(null);
  const certCatalog = useCertificateCatalog();
  const navigate = useNavigate();
  const todayOnlineStr = cairoDateOnly();
  const in3daysOnlineStr = cairoDaysAhead(3);
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
            {/* عملائي holds every branch now, so which one a client belongs to
                has to be readable on the row rather than implied by the tab. */}
            {vc.branch && <th className="text-center px-1 py-2 border border-gray-200 font-semibold text-[11px] whitespace-nowrap relative select-none" style={cw['branch']?{width:cw['branch']}:{}}>الفرع<span onMouseDown={e=>startColResize('branch',e)} className="absolute top-0 left-0 h-full w-1 cursor-col-resize hover:bg-blue-400 opacity-0 hover:opacity-100 transition-opacity z-20" /></th>}
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
            // Collected money only: a pending or refunded row is not paid.
            const payments = (row.paymentHistory || []).filter(isCollected);
            const branchId = normBranchId(row.branch);
            // The currency they pay in: their online market's, else their
            // branch's. A riyal client filed under an Egypt branch showed no
            // payments at all, every one being filtered out as the wrong currency.
            const branchCurrency = isOnlineClient(row)
              ? ({ local: 'EGP', saudi: 'SAR', intl: 'USD' } as const)[subscriberMarket(row)]
              : currencyForBranch(branchId);
            const certLabel = (t?: string) => certCatalog.label(t);
            // One row per course or track they hold, at the price agreed, with
            // what they paid for it here and before the system — the same items
            // and numbers as «صلاحية الكورسات», the payment dialog and the plans
            // (lib/agreedPrice.ts clientItems). This guessed a track whenever a
            // client held all of its courses and folded several courses into one
            // «باقة» row, so the table could list items no other screen did.
            const courseRows = clientItems(row, courses, bundles, branchCurrency).map(item => ({
              cid: item.item,
              label: item.isTrack ? `📌 ${item.title}` : item.title,
              expected: item.expected, paid: item.paid, remaining: item.remaining, cur: item.currency,
            }));
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
                  <div className="font-bold text-gray-800 mt-0.5">{nextInst.amount.toLocaleString('ar-EG-u-nu-latn')} {currFmt(nextInst.currency)}</div>
                </div>
              ) : <span className="text-gray-300 text-[10px]">—</span>
            );
            const statusCell = (
              <select value={row.status||'active'} onChange={async e => {
                const nextStatus = e.target.value as SubscriberItem['status'];
                if (nextStatus === 'refunded' || nextStatus === 'refund_pending') {
                  notify('info', 'الاسترداد لازم يبدأ من الدفعة الأصلية داخل القسم المالي؛ لم يتم تغيير حالة العميل.');
                  return;
                }
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
                if (!await updateSubscriber(nextRow)) {
                  notify('error', 'فشل حفظ حالة العميل. لم يتم اعتماد التغيير.');
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
                      try {
                        await mysqlAdmin.assignSubscriberCollection(row.id,csId||null,csStaffMember?.name||null);
                        if(shouldUseScopedSubscribers) setSalesOwnSubscribers(prev=>prev.map(s=>s.id===row.id?updated:s));
                        await reloadSubscribers();
                      } catch (error) {
                        notify('error', `فشل تعيين مسئول التحصيل: ${error instanceof Error ? error.message : String(error)}`);
                      }
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
            const todayStr2 = cairoDateOnly();
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
                <div className="text-gray-400 mt-0.5">{cairoDay(lastComm.date)}</div>
              </div>
            ) : <span className="text-gray-300">—</span>;
            const actionsCell = (
              <div className="flex flex-col gap-0.5">
                <div className="grid grid-cols-4 gap-0.5">
                  <button title="ملف العميل" onClick={()=>navigate(`/client/${clientCode}`)} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-primary-50 hover:text-primary-600 flex items-center justify-center transition"><ExternalLink size={12}/></button>
                  <button title="تسجيل دفعة" onClick={()=>{
                    setSubPayRow(row);
                    setSubPayDraft(createClientPaymentDraft({
                      currency: currencyForBranch(branchId),
                      courseId: courseRows[0]?.cid || '',
                    }));
                    setSubPayDraft(prev => ({ ...prev, bookingType: (row.enrolledCourseIds||[]).length > 0 ? 'installment' : 'new_booking' }));
                  }} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-emerald-50 hover:text-emerald-600 flex items-center justify-center transition"><Wallet size={12}/></button>
                  <button title="الأقساط" onClick={()=>setInstallmentsRow(row)} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-teal-50 hover:text-teal-600 flex items-center justify-center transition"><CalendarClock size={12}/></button>
                  <button title="تواصل" onClick={()=>navigate(`/client/${clientCode}`, { state: { openTab: 'communications', addCommunication: true } })} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-blue-50 hover:text-blue-600 flex items-center justify-center transition"><Phone size={12}/></button>
                </div>
                <div className={`grid gap-0.5 ${canDeleteSubscriber?'grid-cols-4':'grid-cols-3'}`}>
                  {/* Opens the chat. It set a row for a WhatsApp dialog that no
                      screen ever drew, so pressing it did nothing. */}
                  {waLink(row.phone) ? (
                    <a title="واتساب" href={waLink(row.phone) || undefined} target="_blank" rel="noreferrer"
                      className="h-7 rounded bg-green-50 text-green-600 hover:bg-green-100 flex items-center justify-center transition"><WhatsAppIcon size={13}/></a>
                  ) : (
                    <span title="مفيش رقم" className="h-7 rounded bg-gray-50 text-gray-300 flex items-center justify-center"><WhatsAppIcon size={13}/></span>
                  )}
                  {isDaqqiClientsTab ? (
                    <button title={rowHousing ? `مسكن في روند ${rowHousing.roundCode}` : 'تسكين في روند'} onClick={()=>{ setDaqqiHousingModal(row); setDaqqiHousingRoundId(rowHousing?.roundId||''); }}
                      className={`h-7 rounded flex items-center justify-center transition text-xs font-bold ${rowHousing ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100' : 'bg-gray-50 text-gray-500 hover:bg-indigo-50 hover:text-indigo-600'}`}>
                      🏠
                    </button>
                  ) : (
                    <button title="تفاصيل الكورسات والصلاحية والمدفوعات" onClick={()=>setAccessRow(row)}
                      className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-indigo-50 hover:text-indigo-600 flex items-center justify-center transition"><Receipt size={12}/></button>
                  )}
                  <button title="تحويل" onClick={()=>{setConvertRow(row);setConvertType('');setConvertAttendedLive(false);setConvertGotCert(false);setConvertPauseReason('');setConvertRefundReason('');setConvertRefundAmount('');setConvertRefundMethod('');}} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-orange-50 hover:text-orange-600 flex items-center justify-center transition"><RefreshCw size={12}/></button>
                  {/* Gated on the permission the route checks, not on a role list:
                      DELETE /api/admin/subscribers/:id requires delete_subscribers, which
                      online_manager and daqqi_manager do not hold — both used to see this
                      button and get refused. */}
                  {canDeleteSubscriber && <button title="حذف العميل" onClick={async ()=>{
                    if (!confirm(`أرشفة "${row.name}"؟ سيظل السجل التاريخي محفوظًا.`)) return;
                    const ok = await deleteSubscriber(row.id);
                    if (ok && shouldUseScopedSubscribers) setSalesOwnSubscribers(prev=>prev.filter(s=>s.id!==row.id));
                    notify(ok ? 'success' : 'error', ok ? 'تمت أرشفة العميل.' : 'فشلت أرشفة العميل ولم يُحذف من النظام.');
                  }} className="h-7 rounded bg-gray-50 text-red-400 hover:bg-red-50 hover:text-red-600 flex items-center justify-center transition"><Trash2 size={12}/></button>}
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
                  <ClientNameCell row={row} clientCode={clientCode} navigate={navigate} />
                </td>
                {vc.branch && <td className="px-2 py-2 border border-gray-200 text-center text-[10px] whitespace-nowrap"><span className="rounded px-1.5 py-0.5 bg-gray-100 text-gray-600">{branchLabel(row.branch)}</span></td>}
                {vc.createdAt  && <td className="px-2 py-2 border border-gray-200 text-center text-[10px] text-gray-500 whitespace-nowrap">{cairoDay(row.createdAt)||'—'}</td>}
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
                              {reqTotal > 0 && <div className="text-[9px] text-gray-500"><span className="text-emerald-600 font-bold">{reqPaid.toLocaleString('ar-EG-u-nu-latn')}</span>{reqRem > 0 && <span className="text-red-500 font-bold"> / م {reqRem.toLocaleString('ar-EG-u-nu-latn')}</span>} {(req.currency||'EGP')==='SAR'?'ر.س':(req.currency||'EGP')==='USD'?'$':'ج'}</div>}
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
                const crFirstPayDate = crPays.length > 0 ? cairoDay([...crPays].sort((a,b)=>(a.at||'').localeCompare(b.at||''))[0]?.at) || cairoDay(row.createdAt) : cairoDay(row.createdAt);
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
                      <ClientNameCell row={row} clientCode={clientCode} navigate={navigate} />
                    </td>
                  )}
                  {vc.branch && <td className="px-2 py-2 border border-gray-200 text-center text-[10px] whitespace-nowrap"><span className="rounded px-1.5 py-0.5 bg-gray-100 text-gray-600">{branchLabel(row.branch)}</span></td>}
                  {vc.createdAt && <td className="px-2 py-2 border border-gray-200 text-center text-[10px] text-gray-500 whitespace-nowrap">{crFirstPayDate||'—'}</td>}
                  {vc.courses && <td className="px-2 py-2 border border-gray-200 text-[11px] text-gray-700 max-w-[160px] truncate" title={cr.label}>{cr.label}</td>}
                  {/* Paid above the recorded value is not an accounting error,
                      it means the recorded value is not trustworthy — usually a
                      deposit figure left in course_expected instead of the full
                      price. Marked rather than hidden, so it can be corrected
                      instead of being read as money that does not add up. */}
                  {vc.value && <td className="px-2 py-2 border border-gray-200 text-center text-[11px] font-bold text-gray-700">
                    {cr.expected > 0 ? (
                      cr.paid > cr.expected ? (
                        <span className="text-amber-700" title={`المسجَّل ${cr.expected.toLocaleString('ar-EG-u-nu-latn')} أقل من المحصَّل ${cr.paid.toLocaleString('ar-EG-u-nu-latn')} — راجع قيمة الاشتراك`}>
                          {cr.expected.toLocaleString('ar-EG-u-nu-latn')} {currFmt(cr.cur)} <span className="text-[10px]">⚠</span>
                        </span>
                      ) : `${cr.expected.toLocaleString('ar-EG-u-nu-latn')} ${currFmt(cr.cur)}`
                    ) : '—'}
                  </td>}
                  {vc.paid && <td className="px-2 py-2 border border-gray-200 text-center text-[11px] font-bold text-emerald-700">
                    {cr.paid > 0 ? `${cr.paid.toLocaleString('ar-EG-u-nu-latn')} ${currFmt(cr.cur)}` : '—'}
                  </td>}
                  {vc.remaining && <td className="px-2 py-2 border border-gray-200 text-center text-[11px] font-bold">
                    {cr.remaining > 0 ? <span className="text-red-600">{cr.remaining.toLocaleString('ar-EG-u-nu-latn')} {currFmt(cr.cur)}</span> : <span className="text-emerald-600 text-[10px]">✅ مكتمل</span>}
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
                              {reqTotal > 0 && <div className="text-[9px]"><span className="text-emerald-600 font-bold">{reqPaid.toLocaleString('ar-EG-u-nu-latn')}</span>{reqRem > 0 && <span className="text-red-500 font-bold"> / م {reqRem.toLocaleString('ar-EG-u-nu-latn')}</span>} <span className="text-gray-400">{(req.currency||'EGP')==='SAR'?'ر.س':(req.currency||'EGP')==='USD'?'$':'ج'}</span></div>}
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
      {accessRow && (
    <Modal
      open
      onClose={() => setAccessRow(null)}
      title={`صلاحية الكورسات — ${accessRow.name}`}
      size="lg"
    >
            <ClientCourseAccessPanel subscriberId={accessRow.id} notify={notify} onChanged={() => { void reloadSubscribers(); }} />
    </Modal>
      )}
    </div>
  );
}
