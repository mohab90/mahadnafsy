import React, { useState } from 'react';
import {
  
  Plus, X,
} from 'lucide-react';
import type {
  BranchType, Bundle, Course,
  DaqqiRound, DaqqiRoundAttendee, LeadItem,
  StaffMember, SubscriberItem,
} from '../../../types';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { normBranchId } from '../dashboardShared';
import { type PaymentDraft } from '../../../components/PaymentModal';
import { branchMatchesFilter } from '../branchWorkspaceFilters';
import { OnlineClientCourseDetailsModal } from './OnlineClientCourseDetailsModal';
import { OnlineClientConvertModal, type OnlineClientConvertType } from './OnlineClientConvertModal';
import { DaqqiHousingModal } from './DaqqiHousingModal';
import { OnlineClientsKpiStrip } from './OnlineClientsKpiStrip';
import { OldDataImportSection } from './online-clients-sections/OldDataImportSection';
import { BulkActionBar } from './online-clients-sections/BulkActionBar';
import { ClientsPagination } from './online-clients-sections/ClientsPagination';
import { ViewTabsBar } from './online-clients-sections/ViewTabsBar';
import { FiltersToolbar } from './online-clients-sections/FiltersToolbar';
import { ClientsTable } from './online-clients-sections/ClientsTable';
import {
  calcSubscribersPaidEGP,
  formatCompactNumber,
  isInternationalSubscriber,
  subscriberRemainingEGP,
  type SubContactDraft,
  type SubscriberSavePayload,
} from './onlineClientsUtils';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface Props {
  activeTab: string;
  subscribers: SubscriberItem[];
  salesOwnSubscribers: SubscriberItem[];
  setSalesOwnSubscribers: React.Dispatch<React.SetStateAction<SubscriberItem[]>>;
  courses: Course[];
  bundles: Bundle[];
  staffMembers: StaffMember[];
  content: Record<string, string>;
  salesOwnDaqqiRounds: DaqqiRound[];
  setSalesOwnDaqqiRounds: React.Dispatch<React.SetStateAction<DaqqiRound[] | null>>;
  salesOwnLeads: LeadItem[];
  updateSubscriber: (s: SubscriberItem) => Promise<boolean>;
  addSubscriber: (s: SubscriberItem) => Promise<boolean>;
  reloadSubscribers: () => Promise<void>;
  reloadLeads: () => Promise<void>;
  deleteSubscriber: (id: string) => Promise<boolean>;
  notify: NotifyFn;
  isDaqqiManager: boolean;
  isReceptionDaqqi: boolean;
  isAdmin: boolean;
  isOnlineManager: boolean;
  isNonAdminStaff: boolean;
  currentStaff: StaffMember | null;
  staffSelf: StaffMember | null;
  onlineTeamMembers: StaffMember[];
  subCsDistributing: boolean;
  setSubCsDistributing: (v: boolean) => void;
  daqqiOldDistribPlan: {staffId: string; count: string}[];
  setDaqqiOldDistribPlan: React.Dispatch<React.SetStateAction<{staffId: string; count: string}[]>>;
  daqqiOldDistributing: boolean;
  setDaqqiOldDistributing: (v: boolean) => void;
  setSubPayRow: (row: SubscriberItem | null) => void;
  setSubPayDraft: React.Dispatch<React.SetStateAction<PaymentDraft>>;
  setSubContactRow: (row: SubscriberItem | null) => void;
  setSubContactDraft: React.Dispatch<React.SetStateAction<SubContactDraft>>;
  setSubWaRow: (row: SubscriberItem | null) => void;
  branchFilter?: string;
}

export default function OnlineClientsTab({
  activeTab, subscribers, salesOwnSubscribers, setSalesOwnSubscribers,
  courses, bundles, staffMembers, content, salesOwnDaqqiRounds, setSalesOwnDaqqiRounds,
  salesOwnLeads, updateSubscriber, addSubscriber, reloadSubscribers, reloadLeads, deleteSubscriber, notify,
  isDaqqiManager, isReceptionDaqqi, isAdmin, isOnlineManager, isNonAdminStaff, currentStaff,
  staffSelf, onlineTeamMembers, subCsDistributing, setSubCsDistributing,
  daqqiOldDistribPlan, setDaqqiOldDistribPlan, daqqiOldDistributing, setDaqqiOldDistributing,
  setSubPayRow, setSubPayDraft, setSubContactRow, setSubContactDraft,
  setSubWaRow, branchFilter,
}: Props) {
  // Collection role — online clients tab state
  const [collOnlineSubTab, setCollOnlineSubTab] = useState<'all' | 'local' | 'intl' | 'mine'>('all');
  const [collOnlineSearch, setCollOnlineSearch] = useState('');
  const [collOnlinePage, setCollOnlinePage] = useState(1);
  const [collOnlineStatusFilter, setCollOnlineStatusFilter] = useState('');
  const [collOnlineDateFrom, setCollOnlineDateFrom] = useState('');
  const [collOnlineDateTo, setCollOnlineDateTo] = useState('');
  const [collOnlineRemainingFilter, setCollOnlineRemainingFilter] = useState<'all'|'has_remaining'|'paid'>('all');
  const [collOnlineCourseFilter, setCollOnlineCourseFilter] = useState('');
  const [collOnlineVisibleCols, setCollOnlineVisibleCols] = useState<Record<string,boolean>>({
    courses: true, value: true, paid: true, remaining: true, installments: true,
    status: true, sales: true, followup: true, contact: true, createdAt: true, certificates: true,
  });
  const [collOnlineColWidths, setCollOnlineColWidths] = useState<Record<string,number>>(() => {
    try { return JSON.parse(localStorage.getItem('collOnlineColWidths') || '{}'); } catch { return {}; }
  });
  const collOnlineResizing = React.useRef<{col:string;startX:number;startW:number}|null>(null);
  // Collection/online_manager — extra filters
  const [collOnlineCollectionFilter, setCollOnlineCollectionFilter] = useState('');
  const [collOnlineCertFilter, setCollOnlineCertFilter] = useState<'all'|'has_cert'|'no_cert'>('all');
  // Collection/online_manager — client sub-view tabs
  const [collOnlineViewTab, setCollOnlineViewTab] = useState<'active'|'real-local'|'real-intl'|'finished'|'paused'|'refunded'|'old_data'|'old_local'|'old_intl'>('active');
  // Daqqi clients tab — housing + old data state
  const [daqqiHousingFilter, setDaqqiHousingFilter] = useState<'all'|'housed'|'unhoused'>('all');
  const [daqqiRoundFilter, setDaqqiRoundFilter] = useState('');
  const [daqqiReceptionFilter, setDaqqiReceptionFilter] = useState('');
  const [daqqiBranchNewSubDraft, setDaqqiBranchNewSubDraft] = useState<{name:string;phone:string;email:string;courseIds:string[];courseExpected:string;amount:string;currency:'EGP'|'SAR'|'USD';paymentMethod:string;transactionId:string;date:string;note:string;bookingType:'new_booking'|'installment';}>({name:'',phone:'',email:'',courseIds:[],courseExpected:'',amount:'',currency:'EGP',paymentMethod:'',transactionId:'',date:new Date().toISOString().slice(0,10),note:'',bookingType:'new_booking'});
  const [daqqiBranchNewSubSaving, setDaqqiBranchNewSubSaving] = useState(false);
  const daqqiBranchNewSubReset = () => setDaqqiBranchNewSubDraft({name:'',phone:'',email:'',courseIds:[],courseExpected:'',amount:'',currency:'EGP',paymentMethod:'',transactionId:'',date:new Date().toISOString().slice(0,10),note:'',bookingType:'new_booking'});
  const [daqqiSettingsOpen, setDaqqiSettingsOpen] = useState(false);
  const [daqqiHousingModal, setDaqqiHousingModal] = useState<SubscriberItem|null>(null);
  const [daqqiHousingRoundId, setDaqqiHousingRoundId] = useState('');
  // Bulk selection
  const [collOnlineSelected, setCollOnlineSelected] = useState<Set<string>>(new Set());
  const [collOnlineBulkConfirm, setCollOnlineBulkConfirm] = useState<null|'pause'|'finish'|'delete'|'assign'>(null);
  const [collOnlineBulkAssignTo, setCollOnlineBulkAssignTo] = useState('');
  // Convert client modal
  const [convertRow, setConvertRow] = useState<SubscriberItem | null>(null);
  const [convertType, setConvertType] = useState<OnlineClientConvertType>('');
  const [convertAttendedLive, setConvertAttendedLive] = useState<boolean>(false);
  const [convertGotCert, setConvertGotCert] = useState<boolean>(false);
  const [convertPauseReason, setConvertPauseReason] = useState('');
  const [convertRefundReason, setConvertRefundReason] = useState('');
  const [convertRefundAmount, setConvertRefundAmount] = useState('');
  const [convertRefundMethod, setConvertRefundMethod] = useState('');
  const [convertSaving, setConvertSaving] = useState(false);
  const [refundActionSaving, setRefundActionSaving] = useState<string|null>(null);
  // New subscriber popup (online manager)
  const [omNewSubOpen, setOmNewSubOpen] = useState(false);
  const [omNewSubDraft, setOmNewSubDraft] = useState<{name:string;phone:string;email:string;password:string;branch:string;amount:string;currency:'EGP'|'SAR'|'USD';paymentMethod:string;date:string;transactionId:string;note:string;referredBy:string;courses:{courseId:string;accessType:'full'|'limited';videoCount:string;discount:string;customPrice:string}[]}>({ name: '', phone: '', email: '', password: '', branch: '', amount: '', currency: 'EGP', paymentMethod: '', date: new Date().toISOString().slice(0,10), transactionId: '', note: '', referredBy: '', courses: [{courseId:'',accessType:'full',videoCount:'',discount:'',customPrice:''}] });
  const [omNewSubSaving, setOmNewSubSaving] = useState(false);
  const omNewSubReset = () => setOmNewSubDraft({name:'',phone:'',email:'',password:'',branch:'',amount:'',currency:'EGP',paymentMethod:'',date:new Date().toISOString().slice(0,10),transactionId:'',note:'',referredBy:'',courses:[{courseId:'',accessType:'full',videoCount:'',discount:'',customPrice:''}]});
  // "تفاصيل" popup for online_clients table
  const [collDetailsRow, setCollDetailsRow] = useState<SubscriberItem | null>(null);
  const [collDetailsDraft, setCollDetailsDraft] = useState<{courseId:string;expected:string;paid:string;createdAt:string}[]>([]);
  const [collDetailsSaving, setCollDetailsSaving] = useState(false);

              const isDaqqiClientsTab = activeTab === 'daqqi_clients';
              // Housing map: subscriberId → { roundId, roundCode, receptionId, receptionName }
              const housingMap = new Map<string, { roundId: string; roundCode: string; receptionId: string; receptionName: string }>();
              if (isDaqqiClientsTab) {
                (salesOwnDaqqiRounds ?? []).forEach((round: DaqqiRound) => {
                  (round.attendees ?? []).forEach((att: DaqqiRoundAttendee) => {
                    if (!housingMap.has(att.subscriberId)) {
                      housingMap.set(att.subscriberId, {
                        roundId: round.id,
                        roundCode: round.code || round.id.slice(0,6),
                        receptionId: round.receptionId,
                        receptionName: round.receptionName,
                      });
                    }
                  });
                });
              }
              const isIntlSub = isInternationalSubscriber;
              // «عملائي» = subscribers personally converted by this collection employee
              const myCollLeadIds = new Set(
                salesOwnLeads
                  .filter((l: LeadItem) => l.assignedSalesId === (staffSelf?.id || currentStaff?.id))
                  .map((l: LeadItem) => l.id)
              );
              // Prefer staff-scoped data when it is present, but fall back to context data.
              // Production can temporarily return an empty scoped list after API/date issues;
              // falling back keeps managers from seeing an empty CRM while the full context is loaded.
              const scopedOrContextSubscribers =
                salesOwnSubscribers.length > 0 ? salesOwnSubscribers : subscribers;
              const masterList = isDaqqiClientsTab
                ? scopedOrContextSubscribers
                : (isAdmin && !isOnlineManager ? subscribers : scopedOrContextSubscribers);
              const shouldUseScopedSubscribers = isOnlineManager || isNonAdminStaff || isDaqqiManager || isReceptionDaqqi;
              const actionSubscribers = shouldUseScopedSubscribers ? scopedOrContextSubscribers : subscribers;
              const branchScopedMasterList = branchFilter
                ? masterList.filter(s => branchMatchesFilter(s.branch, branchFilter))
                : masterList;
              const mineSubsAll = branchScopedMasterList.filter(s => s.leadId && myCollLeadIds.has(s.leadId));
              // For allOnline KPI tiles — subscribers with explicit online branch
              const allCombined = isDaqqiClientsTab
                ? branchScopedMasterList.filter(s => normBranchId(s.branch) === 'DAQQI')
                : branchScopedMasterList.filter(s => normBranchId(s.branch) !== 'DAQQI');
              // For local/intl real tabs, always draw from allCombined
              const tabFiltered =
                collOnlineViewTab === 'real-local'      ? allCombined.filter(s => !isIntlSub(s)) :
                collOnlineViewTab === 'real-intl'       ? allCombined.filter(isIntlSub) :
                collOnlineViewTab === 'old_data'  ? allCombined :
                collOnlineViewTab === 'old_local' ? allCombined.filter(s => !isIntlSub(s)) :
                collOnlineViewTab === 'old_intl'  ? allCombined.filter(isIntlSub) :
                collOnlineSubTab === 'local' ? allCombined.filter(s => !isIntlSub(s)) :
                collOnlineSubTab === 'intl'  ? allCombined.filter(isIntlSub) :
                collOnlineSubTab === 'mine'  ? mineSubsAll :
                allCombined;
              const filtered = tabFiltered.filter(s => {
                // View tab filter — use clientStatus field (set by convert button)
                const clientSt = s.clientStatus || '';
                if (collOnlineViewTab === 'active') {
                  if (s.isActive === false) return false;
                  if (['finished','paused','refunded','refund_pending'].includes(clientSt)) return false;
                } else if (collOnlineViewTab === 'real-local' || collOnlineViewTab === 'real-intl') {
                  // فعلي = active + has at least one enrolled course
                  if (s.isActive === false) return false;
                  if (['finished','paused','refunded','refund_pending'].includes(clientSt)) return false;
                  if ((s.enrolledCourseIds||[]).length === 0) return false;
                } else {
                  if (collOnlineViewTab === 'refunded') {
                    if (clientSt !== 'refunded' && clientSt !== 'refund_pending') return false;
                  } else if (collOnlineViewTab === 'old_data') {
                    if (!['old_data','daqqi_old_local','daqqi_old_intl'].includes(clientSt)) return false;
                  } else {
                    if (clientSt !== collOnlineViewTab) return false;
                  }
                }
                if (collOnlineSearch.trim()) {
                  const q = collOnlineSearch.toLowerCase();
                  const searchDigits = collOnlineSearch.replace(/\D/g, '');
                  const phoneMatch = searchDigits.length >= 4
                    ? (s.phone || '').replace(/\D/g, '').includes(searchDigits)
                    : (s.phone || '').includes(collOnlineSearch);
                  if (!(s.name||'').toLowerCase().includes(q) && !phoneMatch &&
                      !(s.email||'').toLowerCase().includes(q) && !(s.nationalId||'').includes(collOnlineSearch)) return false;
                }
                if (collOnlineStatusFilter && s.status !== collOnlineStatusFilter) return false;
                if (collOnlineDateFrom && (s.createdAt||'').slice(0,10) < collOnlineDateFrom) return false;
                if (collOnlineDateTo   && (s.createdAt||'').slice(0,10) > collOnlineDateTo)   return false;
                if (collOnlineCourseFilter && !(s.enrolledCourseIds||[]).includes(collOnlineCourseFilter)) return false;
                // فلتر مسئول التحصيل
                if (collOnlineCollectionFilter && s.assignedCsId !== collOnlineCollectionFilter) return false;
                // فلتر التسكين (لتب عملاء الدقي فقط)
                if (isDaqqiClientsTab && daqqiHousingFilter === 'housed'   && !housingMap.has(s.id)) return false;
                if (isDaqqiClientsTab && daqqiHousingFilter === 'unhoused' && housingMap.has(s.id))  return false;
                if (isDaqqiClientsTab && daqqiRoundFilter) {
                  const _h = housingMap.get(s.id);
                  if (!_h || _h.roundId !== daqqiRoundFilter) return false;
                }
                if (isDaqqiClientsTab && daqqiReceptionFilter) {
                  const _h = housingMap.get(s.id);
                  if (!_h || _h.receptionId !== daqqiReceptionFilter) return false;
                }
                // فلتر الشهادات
                if (collOnlineCertFilter === 'has_cert' && (s.certificates||[]).length === 0) return false;
                if (collOnlineCertFilter === 'no_cert' && (s.certificates||[]).length > 0) return false;
                if (collOnlineRemainingFilter !== 'all') {
                  const rem = subscriberRemainingEGP(s);
                  if (collOnlineRemainingFilter==='has_remaining' && rem<=0) return false;
                  if (collOnlineRemainingFilter==='paid' && rem>0) return false;
                }
                return true;
              });
              const todayOnlineStr = new Date().toISOString().slice(0, 10);
              // Collection financial stats
              const thisWeekStart = (() => { const d=new Date(); d.setDate(d.getDate()-d.getDay()); return d.toISOString().slice(0,10); })();
              const calcPaidEGP = calcSubscribersPaidEGP;
              const collTodayRev  = calcPaidEGP(allCombined, todayOnlineStr, todayOnlineStr);
              const collWeekRev   = calcPaidEGP(allCombined, thisWeekStart);
              const collMonthRev  = calcPaidEGP(allCombined, new Date().toISOString().slice(0,7)+'-01');
              const collTotalRem  = allCombined.reduce((sum,s)=>{
                return sum + subscriberRemainingEGP(s);
              },0);
              const fmtK = formatCompactNumber;
              const COLL_PAGE_SIZE = 100;
              const totalPages = Math.max(1, Math.ceil(filtered.length / COLL_PAGE_SIZE));
              const safePage = Math.min(collOnlinePage, totalPages);
              const pageRows = filtered.slice((safePage - 1) * COLL_PAGE_SIZE, safePage * COLL_PAGE_SIZE);
              const toggleCol = (col: string) => setCollOnlineVisibleCols(prev => ({ ...prev, [col]: !prev[col] }));
              const vc = collOnlineVisibleCols;
              const cw = collOnlineColWidths;
              const startColResize = (col: string, e: React.MouseEvent) => {
                e.preventDefault();
                const th = (e.currentTarget as HTMLElement).closest('th') as HTMLTableCellElement;
                collOnlineResizing.current = { col, startX: e.clientX, startW: th.offsetWidth };
                const onMove = (me: MouseEvent) => {
                  if (!collOnlineResizing.current) return;
                  const diff = me.clientX - collOnlineResizing.current.startX;
                  const newW = Math.max(48, collOnlineResizing.current.startW + diff);
                  setCollOnlineColWidths(prev => {
                    const next = { ...prev, [collOnlineResizing.current!.col]: newW };
                    try { localStorage.setItem('collOnlineColWidths', JSON.stringify(next)); } catch {}
                    return next;
                  });
                };
                const onUp = () => { collOnlineResizing.current = null; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
              };
              return (
                <article className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm" dir="rtl">
                  <OnlineClientsKpiStrip
                    isDaqqiClientsTab={isDaqqiClientsTab}
                    allCombined={allCombined}
                    mineSubsAll={mineSubsAll}
                    collTodayRev={collTodayRev}
                    collWeekRev={collWeekRev}
                    collMonthRev={collMonthRev}
                    collTotalRem={collTotalRem}
                    fmtK={fmtK}
                    isIntlSub={isIntlSub}
                  />

                  {/* === Tabs row === */}
                  <ViewTabsBar
                    isDaqqiClientsTab={isDaqqiClientsTab}
                    allCombined={allCombined}
                    isIntlSub={isIntlSub}
                    collOnlineViewTab={collOnlineViewTab}
                    setCollOnlineViewTab={setCollOnlineViewTab}
                    setCollOnlinePage={setCollOnlinePage}
                    filtered={filtered}
                    isOnlineManager={isOnlineManager}
                    isDaqqiManager={isDaqqiManager}
                    isAdmin={isAdmin}
                    setOmNewSubOpen={setOmNewSubOpen}
                    daqqiSettingsOpen={daqqiSettingsOpen}
                    setDaqqiSettingsOpen={setDaqqiSettingsOpen}
                    collOnlineSelected={collOnlineSelected}
                    courses={courses}
                    bundles={bundles}
                    housingMap={housingMap}
                    subCsDistributing={subCsDistributing}
                    setSubCsDistributing={setSubCsDistributing}
                    actionSubscribers={actionSubscribers}
                    reloadSubscribers={reloadSubscribers}
                    notify={notify}
                  />

                  {/* Filters row + column visibility toggles */}
                  <FiltersToolbar
                    isDaqqiClientsTab={isDaqqiClientsTab}
                    collOnlineSearch={collOnlineSearch}
                    setCollOnlineSearch={setCollOnlineSearch}
                    setCollOnlinePage={setCollOnlinePage}
                    daqqiHousingFilter={daqqiHousingFilter}
                    setDaqqiHousingFilter={setDaqqiHousingFilter}
                    daqqiRoundFilter={daqqiRoundFilter}
                    setDaqqiRoundFilter={setDaqqiRoundFilter}
                    salesOwnDaqqiRounds={salesOwnDaqqiRounds}
                    housingMap={housingMap}
                    daqqiReceptionFilter={daqqiReceptionFilter}
                    setDaqqiReceptionFilter={setDaqqiReceptionFilter}
                    collOnlineStatusFilter={collOnlineStatusFilter}
                    setCollOnlineStatusFilter={setCollOnlineStatusFilter}
                    collOnlineRemainingFilter={collOnlineRemainingFilter}
                    setCollOnlineRemainingFilter={setCollOnlineRemainingFilter}
                    collOnlineCollectionFilter={collOnlineCollectionFilter}
                    setCollOnlineCollectionFilter={setCollOnlineCollectionFilter}
                    isOnlineManager={isOnlineManager}
                    isAdmin={isAdmin}
                    onlineTeamMembers={onlineTeamMembers}
                    staffMembers={staffMembers}
                    collOnlineCertFilter={collOnlineCertFilter}
                    setCollOnlineCertFilter={setCollOnlineCertFilter}
                    collOnlineCourseFilter={collOnlineCourseFilter}
                    setCollOnlineCourseFilter={setCollOnlineCourseFilter}
                    courses={courses}
                    bundles={bundles}
                    collOnlineDateFrom={collOnlineDateFrom}
                    setCollOnlineDateFrom={setCollOnlineDateFrom}
                    collOnlineDateTo={collOnlineDateTo}
                    setCollOnlineDateTo={setCollOnlineDateTo}
                    collOnlineSelected={collOnlineSelected}
                    filtered={filtered}
                    vc={vc}
                    toggleCol={toggleCol}
                  />
                  {/* Bulk action bar + confirm dialog */}
                  <BulkActionBar
                    collOnlineSelected={collOnlineSelected}
                    setCollOnlineSelected={setCollOnlineSelected}
                    collOnlineBulkConfirm={collOnlineBulkConfirm}
                    setCollOnlineBulkConfirm={setCollOnlineBulkConfirm}
                    collOnlineBulkAssignTo={collOnlineBulkAssignTo}
                    setCollOnlineBulkAssignTo={setCollOnlineBulkAssignTo}
                    isAdmin={isAdmin}
                    staffMembers={staffMembers}
                    filtered={filtered}
                    courses={courses}
                    actionSubscribers={actionSubscribers}
                    shouldUseScopedSubscribers={shouldUseScopedSubscribers}
                    setSalesOwnSubscribers={setSalesOwnSubscribers}
                    deleteSubscriber={deleteSubscriber}
                    updateSubscriber={updateSubscriber}
                    notify={notify}
                  />
                  {/* Table (hidden when old_data tab is active) */}
                  {/* ── Distribution panel for محلي قديم / دولي قديم ── */}
                  {((collOnlineViewTab === 'old_local' || collOnlineViewTab === 'old_intl') || (collOnlineViewTab === 'old_data' && isDaqqiClientsTab)) && (isAdmin || isDaqqiManager) && (
                    <div className="mb-4 bg-gradient-to-l from-indigo-50 to-violet-50 border border-indigo-200 rounded-2xl p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="text-base">📊</span>
                        <h4 className="font-extrabold text-indigo-800 text-sm">{isDaqqiClientsTab ? 'توزيع العملاء على فريق الدقي' : 'توزيع العملاء على مسئولي التحصيل'}</h4>
                        <span className="text-xs text-indigo-500">({filtered.filter(s => !s.assignedCsId).length} غير موزع من أصل {filtered.length})</span>
                      </div>
                      <div className="space-y-2">
                        {daqqiOldDistribPlan.map((entry, idx) => {
                          const csMembers = isDaqqiClientsTab
                              ? staffMembers.filter(s => s.role === 'daqqi_manager' || s.role === 'reception_daqqi')
                              : staffMembers.filter(s => (s.role||'').toLowerCase() === 'collection');
                          return (
                            <div key={idx} className="flex items-center gap-2 flex-wrap">
                              <select value={entry.staffId} onChange={e => setDaqqiOldDistribPlan(prev => prev.map((p,i) => i===idx ? {...p,staffId:e.target.value} : p))}
                                className="border border-indigo-200 rounded-xl px-3 py-1.5 text-xs bg-white focus:ring-2 focus:ring-indigo-200 focus:outline-none min-w-[160px]">
                                <option value="">{isDaqqiClientsTab ? '— اختر من فريق الدقي —' : '— اختر مسئول تحصيل —'}</option>
                                {csMembers.map(s => <option key={s.id} value={s.id}>{s.name} ({(salesOwnSubscribers.length>0?salesOwnSubscribers:subscribers).filter(sub=>sub.assignedCsId===s.id).length} موزع)</option>)}
                              </select>
                              <input type="number" min="1" max={filtered.filter(s=>!s.assignedCsId).length} placeholder="عدد العملاء"
                                value={entry.count} onChange={e => setDaqqiOldDistribPlan(prev => prev.map((p,i) => i===idx ? {...p,count:e.target.value} : p))}
                                className="border border-indigo-200 rounded-xl px-3 py-1.5 text-xs w-28 focus:ring-2 focus:ring-indigo-200 focus:outline-none" />
                              {daqqiOldDistribPlan.length > 1 && (
                                <button onClick={() => setDaqqiOldDistribPlan(prev => prev.filter((_,i) => i!==idx))}
                                  className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50 text-sm">✕</button>
                              )}
                            </div>
                          );
                        })}
                        <div className="flex items-center gap-2 pt-1">
                          <button onClick={() => setDaqqiOldDistribPlan(prev => [...prev, {staffId:'',count:''}])}
                            className="flex items-center gap-1 text-xs font-bold text-indigo-600 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-xl transition">
                            <Plus size={11}/> إضافة مسئول
                          </button>
                          <button disabled={daqqiOldDistributing || daqqiOldDistribPlan.every(e=>!e.staffId||!e.count)}
                            onClick={async () => {
                              const unassigned = filtered.filter(s => !s.assignedCsId);
                              let offset = 0; let totalDone = 0; let totalFailed = 0;
                              setDaqqiOldDistributing(true);
                              try {
                                for (const entry of daqqiOldDistribPlan) {
                                  if (!entry.staffId || !entry.count) continue;
                                  const n = Math.min(Number(entry.count)||0, unassigned.length - offset);
                                  if (n <= 0) continue;
                                  const batch = unassigned.slice(offset, offset + n);
                                  offset += n;
                                  const staffMember = staffMembers.find(s => s.id === entry.staffId);
                                  for (const sub of batch) {
                                    try {
                                      const updatedSub = { ...sub, assignedCsId: entry.staffId, assignedCsName: staffMember?.name || '' };
                                      await mysqlAdmin.saveSubscriber(updatedSub as SubscriberSavePayload);
                                      setSalesOwnSubscribers(prev => prev.map(s => s.id === sub.id ? updatedSub : s));
                                      totalDone++;
                                    } catch { totalFailed++; }
                                  }
                                }
                                await reloadSubscribers();
                                notify(
                                  totalFailed > 0 ? 'error' : 'success',
                                  totalFailed > 0
                                    ? `تم توزيع ${totalDone} عميل وفشل ${totalFailed}. لم تُخفَ العمليات الفاشلة.`
                                    : `✅ تم توزيع ${totalDone} عميل على ${isDaqqiClientsTab ? 'فريق الدقي' : 'مسئولي التحصيل'}`
                                );
                                setDaqqiOldDistribPlan([{staffId:'',count:''}]);
                              } finally { setDaqqiOldDistributing(false); }
                            }}
                            className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 transition">
                            {daqqiOldDistributing ? <><span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin"/> جاري...</> : '🚀 توزيع'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  <OldDataImportSection
                    collOnlineViewTab={collOnlineViewTab}
                    isDaqqiClientsTab={isDaqqiClientsTab}
                    courses={courses}
                    notify={notify}
                    setSalesOwnSubscribers={setSalesOwnSubscribers}
                  />
                  <ClientsTable
                    pageRows={pageRows}
                    vc={vc}
                    cw={cw}
                    startColResize={startColResize}
                    isDaqqiClientsTab={isDaqqiClientsTab}
                    collOnlineSelected={collOnlineSelected}
                    setCollOnlineSelected={setCollOnlineSelected}
                    housingMap={housingMap}
                    courses={courses}
                    bundles={bundles}
                    staffMembers={staffMembers}
                    onlineTeamMembers={onlineTeamMembers}
                    isAdmin={isAdmin}
                    isOnlineManager={isOnlineManager}
                    isDaqqiManager={isDaqqiManager}
                    shouldUseScopedSubscribers={shouldUseScopedSubscribers}
                    updateSubscriber={updateSubscriber}
                    reloadSubscribers={reloadSubscribers}
                    setSalesOwnSubscribers={setSalesOwnSubscribers}
                    deleteSubscriber={deleteSubscriber}
                    setSubPayRow={setSubPayRow}
                    setSubPayDraft={setSubPayDraft}
                    setSubContactRow={setSubContactRow}
                    setSubContactDraft={setSubContactDraft}
                    setSubWaRow={setSubWaRow}
                    setDaqqiHousingModal={setDaqqiHousingModal}
                    setDaqqiHousingRoundId={setDaqqiHousingRoundId}
                    setCollDetailsDraft={setCollDetailsDraft}
                    setCollDetailsRow={setCollDetailsRow}
                    setConvertRow={setConvertRow}
                    setConvertType={setConvertType}
                    setConvertAttendedLive={setConvertAttendedLive}
                    setConvertGotCert={setConvertGotCert}
                    setConvertPauseReason={setConvertPauseReason}
                    setConvertRefundReason={setConvertRefundReason}
                    setConvertRefundAmount={setConvertRefundAmount}
                    setConvertRefundMethod={setConvertRefundMethod}
                    filteredLength={filtered.length}
                    notify={notify}
                  />
                  {/* Pagination */}
                  <ClientsPagination totalPages={totalPages} safePage={safePage} setCollOnlinePage={setCollOnlinePage} />


                  {/* ===== تسكين في روند (daqqi) ===== */}
                  {isDaqqiClientsTab && (
                    <DaqqiHousingModal
                      subscriber={daqqiHousingModal}
                      roundId={daqqiHousingRoundId}
                      rounds={salesOwnDaqqiRounds ?? []}
                      housingMap={housingMap}
                      setRoundId={setDaqqiHousingRoundId}
                      setRounds={setSalesOwnDaqqiRounds}
                      notify={notify}
                      onClose={() => setDaqqiHousingModal(null)}
                    />
                  )}

                  {/* ===== مشترك جديد popup ===== */}
                  {omNewSubOpen && (() => {
                    const pmList: string[] = content['finance.payment_methods']
                      ? content['finance.payment_methods'].split('||').map((s:string)=>s.trim()).filter(Boolean)
                      : ['كاش','فودافون كاش','انستاباي','تحويل بنكي','بطاقة ائتمان','خزنة الدقي'];
                    return (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" dir="rtl"
                      onClick={e=>{if(e.target===e.currentTarget){setOmNewSubOpen(false);omNewSubReset();daqqiBranchNewSubReset();}}}>
                      {isDaqqiClientsTab ? (
                        /* ══════════ مشترك جديد — فرع الدقي ══════════ */
                        <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
                          {/* Header */}
                          <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-l from-indigo-600 to-indigo-700 text-white">
                            <div>
                              <h3 className="font-extrabold text-base">🏢 عميل دقي جديد</h3>
                              <p className="text-xs text-indigo-200 mt-0.5">إضافة عميل لفرع الدقي</p>
                            </div>
                            <button onClick={()=>{setOmNewSubOpen(false);daqqiBranchNewSubReset();}} className="text-white/70 hover:text-white p-1 rounded-lg hover:bg-white/10"><X size={20}/></button>
                          </div>
                          <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
                            {/* بيانات العميل */}
                            <div>
                              <p className="text-xs font-extrabold text-gray-500 uppercase mb-2 flex items-center gap-1">👤 بيانات العميل</p>
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-xs font-bold text-gray-600 mb-1">الاسم الكامل *</label>
                                  <input type="text" value={daqqiBranchNewSubDraft.name} onChange={e=>setDaqqiBranchNewSubDraft(d=>({...d,name:e.target.value}))}
                                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" placeholder="اسم العميل" />
                                </div>
                                <div>
                                  <label className="block text-xs font-bold text-gray-600 mb-1">رقم الهاتف *</label>
                                  <input type="tel" value={daqqiBranchNewSubDraft.phone} onChange={e=>setDaqqiBranchNewSubDraft(d=>({...d,phone:e.target.value}))}
                                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" placeholder="+201xxxxxxxxx" dir="ltr" />
                                </div>
                              </div>
                              <div className="mt-2">
                                <label className="block text-xs font-bold text-gray-600 mb-1">البريد الإلكتروني (اختياري)</label>
                                <input type="email" value={daqqiBranchNewSubDraft.email} onChange={e=>setDaqqiBranchNewSubDraft(d=>({...d,email:e.target.value}))}
                                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" placeholder="email@example.com" dir="ltr" />
                              </div>
                            </div>
                            {/* الكورسات */}
                            <div>
                              <p className="text-xs font-extrabold text-gray-500 uppercase mb-2 flex items-center gap-1">🎓 الكورسات (اختياري)</p>
                              <div className="border border-gray-200 rounded-xl overflow-hidden">
                                <div className="max-h-44 overflow-y-auto divide-y divide-gray-100">
                                  {[
                                    ...bundles.map(b => ({ id: `bundle:${b.id}`, label: `📌 ${b.titleAr||b.title}`, price: b.price?.EGP||0, isBun: true })),
                                    ...courses.map(c => ({ id: c.id, label: `🎓 ${c.titleAr||c.title}`, price: c.price?.EGP||0, isBun: false })),
                                  ].map(item => {
                                    const sel = daqqiBranchNewSubDraft.courseIds.includes(item.id);
                                    return (
                                      <label key={item.id} className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition text-xs ${sel?'bg-indigo-50':' hover:bg-gray-50'}`}>
                                        <input type="checkbox" checked={sel} onChange={e=>{
                                          setDaqqiBranchNewSubDraft(d=>({...d,courseIds:e.target.checked?[...d.courseIds,item.id]:d.courseIds.filter(id=>id!==item.id)}));
                                        }} className="accent-indigo-600 w-3.5 h-3.5"/>
                                        <span className="flex-1 font-medium text-gray-800">{item.label}</span>
                                        {item.price>0 && <span className="text-emerald-600 font-bold">{item.price.toLocaleString()} ج.م</span>}
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                              {daqqiBranchNewSubDraft.courseIds.length > 0 && (
                                <div className="mt-2">
                                  <label className="block text-xs font-bold text-gray-600 mb-1">المبلغ المتوقع الإجمالي</label>
                                  <input type="number" min="0" value={daqqiBranchNewSubDraft.courseExpected}
                                    onChange={e=>setDaqqiBranchNewSubDraft(d=>({...d,courseExpected:e.target.value}))}
                                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" placeholder="0 ج.م" />
                                </div>
                              )}
                            </div>
                            {/* الدفعة الأولى */}
                            <div className="bg-gradient-to-l from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-3 space-y-3">
                              <p className="text-xs font-extrabold text-emerald-700 flex items-center gap-1">💳 دفعة أولى (اختياري)</p>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[11px] font-bold text-gray-600 mb-1">المبلغ</label>
                                  <input type="number" min="0" value={daqqiBranchNewSubDraft.amount}
                                    onChange={e=>setDaqqiBranchNewSubDraft(d=>({...d,amount:e.target.value}))}
                                    className="w-full border border-emerald-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" placeholder="0" />
                                </div>
                                <div>
                                  <label className="block text-[11px] font-bold text-gray-600 mb-1">العملة</label>
                                  <select value={daqqiBranchNewSubDraft.currency} onChange={e=>setDaqqiBranchNewSubDraft(d=>({...d,currency:e.target.value as 'EGP'|'SAR'|'USD'}))}
                                    className="w-full border border-emerald-200 rounded-xl px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200">
                                    <option value="EGP">ج.م — جنيه مصري</option>
                                    <option value="SAR">ر.س — ريال سعودي</option>
                                    <option value="USD">$ — دولار</option>
                                  </select>
                                </div>
                              </div>
                              <div>
                                <label className="block text-[11px] font-bold text-gray-600 mb-1">طريقة الدفع</label>
                                <div className="flex flex-wrap gap-1.5">
                                  {pmList.map(pm=>(
                                    <button key={pm} type="button" onClick={()=>setDaqqiBranchNewSubDraft(d=>({...d,paymentMethod:d.paymentMethod===pm?'':pm}))}
                                      className={`px-2.5 py-1 rounded-xl text-[11px] font-bold border transition ${daqqiBranchNewSubDraft.paymentMethod===pm?'bg-indigo-600 text-white border-indigo-600':'border-gray-200 text-gray-700 hover:bg-gray-100'}`}>
                                      {pm}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[11px] font-bold text-gray-600 mb-1">تاريخ الدفع</label>
                                  <input type="date" value={daqqiBranchNewSubDraft.date}
                                    onChange={e=>setDaqqiBranchNewSubDraft(d=>({...d,date:e.target.value}))}
                                    className="w-full border border-emerald-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" />
                                </div>
                                <div>
                                  <label className="block text-[11px] font-bold text-gray-600 mb-1">رقم الإيصال</label>
                                  <input type="text" value={daqqiBranchNewSubDraft.transactionId}
                                    onChange={e=>setDaqqiBranchNewSubDraft(d=>({...d,transactionId:e.target.value}))}
                                    className="w-full border border-emerald-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" placeholder="اختياري" />
                                </div>
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-gray-600 mb-1">ملاحظات</label>
                              <textarea value={daqqiBranchNewSubDraft.note} onChange={e=>setDaqqiBranchNewSubDraft(d=>({...d,note:e.target.value}))}
                                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 resize-none" rows={2} placeholder="أي ملاحظات..." />
                            </div>
                          </div>
                          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50">
                            <button onClick={()=>{setOmNewSubOpen(false);daqqiBranchNewSubReset();}} className="px-4 py-2 text-sm rounded-xl border border-gray-200 hover:bg-gray-100">إلغاء</button>
                            <button disabled={daqqiBranchNewSubSaving || !daqqiBranchNewSubDraft.name.trim() || !daqqiBranchNewSubDraft.phone.trim() || (Number(daqqiBranchNewSubDraft.amount) > 0 && (!daqqiBranchNewSubDraft.paymentMethod || daqqiBranchNewSubDraft.courseIds.length === 0))}
                              onClick={async()=>{
                                if (!daqqiBranchNewSubDraft.name.trim() || !daqqiBranchNewSubDraft.phone.trim()) return;
                                setDaqqiBranchNewSubSaving(true);
                                try {
                                  const amount = Number(daqqiBranchNewSubDraft.amount);
                                  if (!Number.isFinite(amount) || amount < 0) throw new Error('قيمة الدفعة غير صحيحة');
                                  if (amount > 0 && (!daqqiBranchNewSubDraft.paymentMethod || daqqiBranchNewSubDraft.courseIds.length === 0)) {
                                    throw new Error('اختر الكورس وطريقة الدفع قبل تسجيل الدفعة');
                                  }
                                  const courseExpected = Number(daqqiBranchNewSubDraft.courseExpected);
                                  const primarySelection = daqqiBranchNewSubDraft.courseIds[0] || '';
                                  let approvalRequired = false;
                                  if (amount > 0) {
                                    if (!primarySelection) throw new Error('اختر كورس أو باقة لربط الدفعة');
                                    if (daqqiBranchNewSubDraft.courseIds.length !== 1) {
                                      throw new Error('كل دفعة جديدة لازم ترتبط بكورس أو باقة واحدة فقط');
                                    }
                                    const result = await mysqlAdmin.adminPost<{
                                      ok: boolean; subscriberId: string; approvalRequired?: boolean;
                                    }>('/admin/subscriber-payments', {
                                      subscriber: {
                                        name: daqqiBranchNewSubDraft.name.trim(),
                                        phone: daqqiBranchNewSubDraft.phone.trim(),
                                        email: daqqiBranchNewSubDraft.email.trim(),
                                        branch: 'DAQQI',
                                        notes: daqqiBranchNewSubDraft.note || undefined,
                                        source: 'reception',
                                      },
                                      payment: {
                                        amount,
                                        currency: daqqiBranchNewSubDraft.currency,
                                        paymentType: 'course',
                                        isInstallment: false,
                                        ...(primarySelection.startsWith('bundle:')
                                          ? { bundleId: primarySelection.slice(7) }
                                          : { courseId: primarySelection }),
                                        courseExpected: courseExpected || undefined,
                                        paymentMethod: daqqiBranchNewSubDraft.paymentMethod || undefined,
                                        transactionId: daqqiBranchNewSubDraft.transactionId || undefined,
                                        at: daqqiBranchNewSubDraft.date,
                                        note: daqqiBranchNewSubDraft.note || undefined,
                                        source: 'reception',
                                        branch: 'DAQQI',
                                      },
                                    });
                                    approvalRequired = !!result.approvalRequired;
                                  } else {
                                    const newSub = {
                                      id:`daqqi-${Date.now()}`,
                                      name:daqqiBranchNewSubDraft.name.trim(),
                                      phone:daqqiBranchNewSubDraft.phone.trim(),
                                      email:daqqiBranchNewSubDraft.email.trim(),
                                      branch:'DAQQI' as BranchType,
                                      status:'active',
                                      enrolledCourseIds:[],
                                      courseAccess:{},
                                      paymentHistory:[],
                                      createdAt:new Date().toISOString().slice(0,10),
                                      clientCode:'',
                                      notes:daqqiBranchNewSubDraft.note||'',
                                    } as unknown as SubscriberItem;
                                    const added = await addSubscriber(newSub);
                                    if (!added) throw new Error('العميل موجود بالفعل');
                                  }
                                  const fresh = await mysqlAdmin.listAllSubscribers();
                                  setSalesOwnSubscribers(fresh as unknown as SubscriberItem[]);
                                  notify('success', approvalRequired
                                    ? `✅ تم إضافة ${daqqiBranchNewSubDraft.name.trim()} والدفعة بانتظار اعتماد المالية`
                                    : `✅ تم إضافة ${daqqiBranchNewSubDraft.name.trim()} بنجاح`);
                                  setOmNewSubOpen(false); daqqiBranchNewSubReset();
                                } catch(err:unknown) {
                                  const message = err instanceof Error ? err.message : String(err);
                                  notify('error', '❌ فشل الإضافة: ' + message);
                                } finally { setDaqqiBranchNewSubSaving(false); }
                              }}
                              className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 transition">
                              {daqqiBranchNewSubSaving ? '⏳ جاري الإضافة...' : '✅ إضافة العميل'}
                            </button>
                          </div>
                        </div>
                      ) : (
                      /* ══════════ مشترك جديد — أونلاين ══════════ */
                      <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-l from-emerald-600 to-teal-600 text-white">
                          <div>
                            <h3 className="font-extrabold text-base">🌐 مشترك أونلاين جديد</h3>
                            <p className="text-xs text-emerald-100 mt-0.5">إنشاء حساب عميل أونلاين</p>
                          </div>
                          <button onClick={()=>{setOmNewSubOpen(false);omNewSubReset();}} className="text-white/70 hover:text-white p-1 rounded-lg hover:bg-white/10"><X size={20}/></button>
                        </div>
                        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
                          {/* بيانات الحساب */}
                          <div>
                            <p className="text-xs font-extrabold text-gray-500 uppercase mb-2">👤 بيانات الحساب</p>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-bold text-gray-600 mb-1">الاسم الكامل *</label>
                                <input type="text" value={omNewSubDraft.name} onChange={e=>setOmNewSubDraft(d=>({...d,name:e.target.value}))}
                                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" placeholder="اسم العميل" />
                              </div>
                              <div>
                                <label className="block text-xs font-bold text-gray-600 mb-1">رقم الهاتف</label>
                                <input type="tel" value={omNewSubDraft.phone} onChange={e=>setOmNewSubDraft(d=>({...d,phone:e.target.value}))}
                                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" placeholder="+201xxxxxxxxx" dir="ltr" />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3 mt-2">
                              <div>
                                <label className="block text-xs font-bold text-gray-600 mb-1">البريد الإلكتروني *</label>
                                <input type="email" value={omNewSubDraft.email} onChange={e=>setOmNewSubDraft(d=>({...d,email:e.target.value}))}
                                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" placeholder="email@example.com" dir="ltr" />
                              </div>
                              <div>
                                <label className="block text-xs font-bold text-gray-600 mb-1">كلمة المرور *</label>
                                <input type="text" value={omNewSubDraft.password} onChange={e=>setOmNewSubDraft(d=>({...d,password:e.target.value}))}
                                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-200" placeholder="كلمة مرور" dir="ltr" />
                              </div>
                            </div>
                          </div>
                          {/* الكورسات */}
                          <div>
                            <p className="text-xs font-extrabold text-gray-500 uppercase mb-2">🎓 الكورسات والصلاحيات</p>
                            <div className="border border-gray-200 rounded-xl p-3 space-y-2">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs text-gray-500">اختر الكورس/الباقة وحدد الصلاحية</span>
                                <button onClick={()=>setOmNewSubDraft(d=>({...d,courses:[...d.courses,{courseId:'',accessType:'full',videoCount:'',discount:'',customPrice:''}]}))}
                                  className="flex items-center gap-1 text-xs text-emerald-700 font-bold border border-emerald-200 bg-emerald-50 rounded-lg px-2 py-1 hover:bg-emerald-100">
                                  <Plus size={11}/> إضافة
                                </button>
                              </div>
                              {omNewSubDraft.courses.map((c, i) => (
                                <div key={i} className="bg-gray-50 border border-gray-200 rounded-xl p-2 space-y-1.5">
                                  <div className="flex items-center gap-2">
                                    <select value={c.courseId} onChange={e=>setOmNewSubDraft(d=>({...d,courses:d.courses.map((x,j)=>j===i?{...x,courseId:e.target.value}:x)}))}
                                      className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200">
                                      <option value="">— اختر الكورس —</option>
                                      {courses.map(co=><option key={co.id} value={co.id}>🎓 {co.titleAr||co.title}</option>)}
                                      {bundles.map(b=><option key={`bundle:${b.id}`} value={`bundle:${b.id}`}>📌 {b.titleAr||b.title}</option>)}
                                    </select>
                                    {omNewSubDraft.courses.length > 1 && (
                                      <button onClick={()=>setOmNewSubDraft(d=>({...d,courses:d.courses.filter((_,j)=>j!==i)}))}
                                        className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50"><X size={13}/></button>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[11px] text-gray-500">الصلاحية:</span>
                                    <button onClick={()=>setOmNewSubDraft(d=>({...d,courses:d.courses.map((x,j)=>j===i?{...x,accessType:'full',videoCount:''}:x)}))}
                                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full border transition ${c.accessType==='full'?'bg-emerald-600 text-white border-emerald-600':'border-gray-200 text-gray-600 hover:bg-gray-100'}`}>صلاحية كاملة</button>
                                    <button onClick={()=>setOmNewSubDraft(d=>({...d,courses:d.courses.map((x,j)=>j===i?{...x,accessType:'limited'}:x)}))}
                                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full border transition ${c.accessType==='limited'?'bg-blue-600 text-white border-blue-600':'border-gray-200 text-gray-600 hover:bg-gray-100'}`}>عدد فيديوهات</button>
                                    {c.accessType === 'limited' && (
                                      <input type="number" min="1" value={c.videoCount} onChange={e=>setOmNewSubDraft(d=>({...d,courses:d.courses.map((x,j)=>j===i?{...x,videoCount:e.target.value}:x)}))}
                                        className="w-16 border border-blue-200 rounded-lg px-2 py-0.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-blue-200" placeholder="عدد" />
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 mt-1">
                                    <div className="flex-1">
                                      <label className="text-[10px] text-gray-500 mb-0.5 block">سعر مخصص (ج.م)</label>
                                      <input type="number" min="0" value={c.customPrice} onChange={e=>setOmNewSubDraft(d=>({...d,courses:d.courses.map((x,j)=>j===i?{...x,customPrice:e.target.value,discount:''}:x)}))}
                                        className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-200" placeholder="السعر الأصلي" />
                                    </div>
                                    <div className="text-[10px] text-gray-400 pt-4">أو</div>
                                    <div className="w-20">
                                      <label className="text-[10px] text-gray-500 mb-0.5 block">خصم %</label>
                                      <input type="number" min="0" max="100" value={c.discount} onChange={e=>setOmNewSubDraft(d=>({...d,courses:d.courses.map((x,j)=>j===i?{...x,discount:e.target.value,customPrice:''}:x)}))}
                                        className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs text-center focus:outline-none focus:ring-1 focus:ring-emerald-200" placeholder="0" />
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                          {/* الدفعة الأولى */}
                          <div className="bg-gradient-to-l from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-3 space-y-3">
                            <p className="text-xs font-extrabold text-emerald-700 flex items-center gap-1">💳 دفعة أولى (اختياري)</p>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[11px] font-bold text-gray-600 mb-1">المبلغ</label>
                                <input type="number" min="0" value={omNewSubDraft.amount} onChange={e=>setOmNewSubDraft(d=>({...d,amount:e.target.value}))}
                                  className="w-full border border-emerald-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" placeholder="0" />
                              </div>
                              <div>
                                <label className="block text-[11px] font-bold text-gray-600 mb-1">العملة</label>
                                <select value={omNewSubDraft.currency} onChange={e=>setOmNewSubDraft(d=>({...d,currency:e.target.value as 'EGP'|'SAR'|'USD'}))}
                                  className="w-full border border-emerald-200 rounded-xl px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200">
                                  <option value="EGP">ج.م — جنيه مصري</option>
                                  <option value="SAR">ر.س — ريال سعودي</option>
                                  <option value="USD">$ — دولار</option>
                                </select>
                              </div>
                            </div>
                            <div>
                              <label className="block text-[11px] font-bold text-gray-600 mb-1">طريقة الدفع</label>
                              <select value={omNewSubDraft.paymentMethod} onChange={e=>setOmNewSubDraft(d=>({...d,paymentMethod:e.target.value}))}
                                className="w-full border border-emerald-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200">
                                <option value="">— اختر طريقة الدفع —</option>
                                {pmList.map(pm=><option key={pm} value={pm}>{pm}</option>)}
                              </select>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[11px] font-bold text-gray-600 mb-1">تاريخ الدفع</label>
                                <input type="date" value={omNewSubDraft.date} onChange={e=>setOmNewSubDraft(d=>({...d,date:e.target.value}))}
                                  className="w-full border border-emerald-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" />
                              </div>
                              <div>
                                <label className="block text-[11px] font-bold text-gray-600 mb-1">رقم الإيصال</label>
                                <input type="text" value={omNewSubDraft.transactionId} onChange={e=>setOmNewSubDraft(d=>({...d,transactionId:e.target.value}))}
                                  className="w-full border border-emerald-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" placeholder="اختياري" />
                              </div>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-bold text-gray-600 mb-1">رقم المحوِّل</label>
                              <input type="text" value={omNewSubDraft.referredBy} onChange={e=>setOmNewSubDraft(d=>({...d,referredBy:e.target.value}))}
                                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" placeholder="كود أو اسم (اختياري)" />
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-gray-600 mb-1">ملاحظات</label>
                              <input type="text" value={omNewSubDraft.note} onChange={e=>setOmNewSubDraft(d=>({...d,note:e.target.value}))}
                                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" placeholder="أي ملاحظات..." />
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50">
                          <button onClick={()=>{setOmNewSubOpen(false);omNewSubReset();}} className="px-4 py-2 text-sm rounded-xl border border-gray-200 hover:bg-gray-100">إلغاء</button>
                          <button disabled={omNewSubSaving || !omNewSubDraft.name.trim() || !omNewSubDraft.email.trim() || !omNewSubDraft.password.trim() || (Number(omNewSubDraft.amount) > 0 && !omNewSubDraft.paymentMethod)}
                            onClick={async()=>{
                              if (!omNewSubDraft.name.trim() || !omNewSubDraft.email.trim() || !omNewSubDraft.password.trim()) return;
                              setOmNewSubSaving(true);
                              try {
                                const validCourses = omNewSubDraft.courses.filter(c=>c.courseId).map(c=>({
                                  courseId: c.courseId,
                                  accessType: c.accessType,
                                  ...(c.accessType==='limited' && c.videoCount ? {videoCount: String(c.videoCount)} : {}),
                                  ...(c.customPrice ? {customPrice: Number(c.customPrice)} : {}),
                                  ...(c.discount ? {discount: Number(c.discount)} : {}),
                                }));
                                const firstCourse = validCourses[0];
                                const firstPaymentAmount = Number(omNewSubDraft.amount);
                                const accountResult = await mysqlAdmin.createAccount({
                                  name: omNewSubDraft.name.trim(),
                                  email: omNewSubDraft.email.trim(),
                                  password: omNewSubDraft.password,
                                  phone: omNewSubDraft.phone.trim(),
                                  ...(validCourses.length > 0 ? { courses: validCourses } : {}),
                                  ...(omNewSubDraft.referredBy.trim() ? { referredBy: omNewSubDraft.referredBy.trim() } : {}),
                                  ...(firstPaymentAmount > 0 ? {
                                    firstPayment: {
                                      amount: firstPaymentAmount,
                                      currency: omNewSubDraft.currency,
                                      paymentMethod: omNewSubDraft.paymentMethod || undefined,
                                      date: omNewSubDraft.date,
                                      transactionId: omNewSubDraft.transactionId || undefined,
                                      note: omNewSubDraft.note || undefined,
                                      courseId: firstCourse?.courseId || undefined,
                                      courseExpected: firstCourse?.customPrice ? Number(firstCourse.customPrice) : undefined,
                                    },
                                  } : {}),
                                });
                                setOmNewSubOpen(false);
                                omNewSubReset();
                                notify(
                                  'success',
                                  accountResult.approvalRequired
                                    ? `✅ تم إنشاء حساب ${omNewSubDraft.name.trim()} والدفعة بانتظار اعتماد المالية`
                                    : `✅ تم إنشاء حساب ${omNewSubDraft.name.trim()} بنجاح`
                                );
                              } catch (err: unknown) {
                                notify('error', '❌ فشل إنشاء الحساب: ' + (err instanceof Error ? err.message : String(err)));
                              } finally {
                                setOmNewSubSaving(false);
                              }
                            }}
                            className="px-5 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 transition">
                            {omNewSubSaving ? '⏳ جاري الإنشاء...' : '✅ إنشاء الحساب'}
                          </button>
                        </div>
                      </div>
                      )} {/* end isDaqqiClientsTab ternary */}
                    </div>
                    );
                  })()}

                  {/* ===== تحويل popup ===== */}
                  {convertRow && (
                    <OnlineClientConvertModal
                      row={convertRow}
                      convertType={convertType}
                      setConvertType={setConvertType}
                      attendedLive={convertAttendedLive}
                      setAttendedLive={setConvertAttendedLive}
                      gotCert={convertGotCert}
                      setGotCert={setConvertGotCert}
                      pauseReason={convertPauseReason}
                      setPauseReason={setConvertPauseReason}
                      refundReason={convertRefundReason}
                      setRefundReason={setConvertRefundReason}
                      refundAmount={convertRefundAmount}
                      setRefundAmount={setConvertRefundAmount}
                      refundMethod={convertRefundMethod}
                      setRefundMethod={setConvertRefundMethod}
                      saving={convertSaving}
                      isDaqqiClientsTab={isDaqqiClientsTab}
                      onClose={() => setConvertRow(null)}
                      onConfirm={async () => {
                                    if (!convertRow) return;
                                    setConvertSaving(true);
                                    try {
                                      const answers: Record<string,unknown> = {};
                                      if (convertType === 'finished') { answers.attendedLive = convertAttendedLive; answers.gotCert = convertGotCert; }
                                      if (convertType === 'paused')   { answers.pauseReason  = convertPauseReason; }
                                      if (convertType === 'refunded') { answers.refundReason = convertRefundReason; answers.refundAmount = convertRefundAmount; answers.refundMethod = convertRefundMethod; }
                                      if (convertType === 'daqqi')    { answers.transferToDaqqi = true; }
                                      if (convertType === 'online') {
                                        const { crm_json: _dropCrm2, ...onlineRowClean } = convertRow as SubscriberItem & { crm_json?: unknown };
                                        const onlineUpdated: SubscriberItem = { ...onlineRowClean, branch: 'ONLINE_EGYPT' as const, clientStatus: 'active' as const, transferDate: new Date().toISOString().slice(0,10) };
                                        if (!await updateSubscriber(onlineUpdated)) throw new Error('فشل حفظ تحويل العميل');
                                        setSalesOwnSubscribers(prev => prev.map(s => s.id === onlineUpdated.id ? onlineUpdated : s));
                                        setConvertRow(null);
                                        notify('success', `✅ تم تحويل ${convertRow.name} إلى الأونلاين`);
                                        return;
                                      }
                                       if (convertType === 'leads') {
                                        await mysqlAdmin.convertSubscriberToLead(convertRow.id);
                                        await Promise.all([reloadSubscribers(), reloadLeads()]);
                                        setSalesOwnSubscribers(prev => prev.filter(s => s.id !== convertRow.id));
                                        setConvertRow(null);
                                        notify('success', `✅ تم تحويل ${convertRow.name} إلى العملاء المحتملين`);
                                         return;
                                       }
                                       if (convertType === 'refunded') {
                                         notify('error', 'لازم تبدأ الاسترداد من دفعة محددة داخل القسم المالي. لم يتم تغيير حالة العميل.');
                                         setConvertSaving(false);
                                         return;
                                       }
                                       // Strip any stale crm_json property to prevent nesting in DB
                                      const { crm_json: _dropCrm, ...convertRowClean } = convertRow as SubscriberItem & { crm_json?: unknown };
                                      const updated: SubscriberItem = {
                                        ...convertRowClean,
                                        clientStatus: convertType === 'daqqi' ? undefined : convertType,
                                        transferAnswers: answers,
                                        transferDate: new Date().toISOString().slice(0,10),
                                        ...(convertType === 'daqqi' ? { branch: 'DAQQI' as const } : {}),
                                      };
                                      if (!await updateSubscriber(updated)) throw new Error('فشل حفظ حالة العميل');
                                      setSalesOwnSubscribers(prev => prev.map(s => s.id === updated.id ? updated : s));
                                       setConvertRow(null);
                                       const typeLabel = convertType === 'finished' ? 'منتهي' : convertType === 'paused' ? 'متوقف' : 'فرع الدقي';
                                      notify('success', `✅ تم تحويل العميل إلى ${typeLabel}`);
                                    } catch (err: unknown) {
                                      notify('error', '❌ فشل التحويل: ' + (err instanceof Error ? err.message : String(err)));
                                    } finally {
                                      setConvertSaving(false);
                                    }
                                  }}
                    />
                  )}

                  <OnlineClientCourseDetailsModal
                    row={collDetailsRow}
                    draft={collDetailsDraft}
                    setDraft={setCollDetailsDraft}
                    saving={collDetailsSaving}
                    setSaving={setCollDetailsSaving}
                    courses={courses}
                    bundles={bundles}
                    reloadSubscribers={reloadSubscribers}
                    isNonAdminStaff={isNonAdminStaff}
                    setSalesOwnSubscribers={setSalesOwnSubscribers}
                    notify={notify}
                    onClose={() => setCollDetailsRow(null)}
                  />
                </article>
              );
}
