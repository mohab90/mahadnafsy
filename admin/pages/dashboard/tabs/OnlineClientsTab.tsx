import React, { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  Bundle, CommunicationRecord, Course,
  DaqqiRound, DaqqiRoundAttendee, LeadItem,
  StaffMember, SubscriberItem,
} from '../../../types';
import { normBranchId } from '../dashboardShared';
import { type PaymentDraft } from '../../../components/PaymentModal';
import AddSubscriberModal from '../../../components/AddSubscriberModal';
import OnlineSubscriberModal from '../../../components/OnlineSubscriberModal';
import { KpiStatsRow } from './online-clients-sections/KpiStatsRow';
import { ViewTabsBar } from './online-clients-sections/ViewTabsBar';
import { FiltersToolbar } from './online-clients-sections/FiltersToolbar';
import { BulkActionBar } from './online-clients-sections/BulkActionBar';
import { OldDataDistributionPanel } from './online-clients-sections/OldDataDistributionPanel';
import { OldDataImportSection } from './online-clients-sections/OldDataImportSection';
import { ClientsTable } from './online-clients-sections/ClientsTable';
import { ClientsPagination } from './online-clients-sections/ClientsPagination';
import { DaqqiHousingModal } from './online-clients-sections/DaqqiHousingModal';
import { ConvertClientModal } from './online-clients-sections/ConvertClientModal';
import { ClientDetailsModal } from './online-clients-sections/ClientDetailsModal';

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
  updateSubscriber: (s: SubscriberItem) => void;
  addSubscriber: (s: SubscriberItem) => void;
  addLead: (lead: LeadItem) => void;
  deleteSubscriber: (id: string) => void;
  notify: NotifyFn;
  isDaqqiManager: boolean;
  isReceptionDaqqi: boolean;
  isAdmin: boolean;
  isOnlineManager: boolean;
  isNonAdminStaff: boolean;
  currentStaff: StaffMember | null;
  staffSelf: StaffMember | null;
  onlineTeamMembers: StaffMember[];
  setSubPayRow: (row: SubscriberItem | null) => void;
  setSubPayDraft: React.Dispatch<React.SetStateAction<PaymentDraft>>;
  setSubContactRow: (row: SubscriberItem | null) => void;
  setSubContactDraft: React.Dispatch<React.SetStateAction<SubContactDraft>>;
  setSubInstRow: (row: SubscriberItem | null) => void;
  setSubInstDraft: React.Dispatch<React.SetStateAction<SubInstDraft>>;
  setSubWaRow: (row: SubscriberItem | null) => void;
}

export default function OnlineClientsTab({
  activeTab, subscribers, salesOwnSubscribers, setSalesOwnSubscribers,
  courses, bundles, staffMembers, content, salesOwnDaqqiRounds, setSalesOwnDaqqiRounds,
  salesOwnLeads, updateSubscriber, addSubscriber, addLead, deleteSubscriber, notify,
  isDaqqiManager, isReceptionDaqqi, isAdmin, isOnlineManager, isNonAdminStaff, currentStaff,
  staffSelf, onlineTeamMembers,
  setSubPayRow, setSubPayDraft, setSubContactRow, setSubContactDraft,
  setSubInstRow, setSubInstDraft, setSubWaRow,
}: Props) {
  // Distribution UI state — lifted out of the Dashboard god-hub (tab-local).
  const [subCsDistributing, setSubCsDistributing] = useState(false);
  const [daqqiOldDistribPlan, setDaqqiOldDistribPlan] = useState<{staffId: string; count: string}[]>([{ staffId: '', count: '' }]);
  const [daqqiOldDistributing, setDaqqiOldDistributing] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  // Collection role — online clients tab state. Seeded from the URL so each tab
  // is deep-linkable and the back/forward buttons move between tabs.
  const _SEG = ['all', 'local', 'intl', 'mine'] as const;
  const _VIEW = ['active', 'real-local', 'real-intl', 'finished', 'paused', 'refunded', 'old_data', 'old_local', 'old_intl'] as const;
  const [collOnlineSubTab, setCollOnlineSubTab] = useState<typeof _SEG[number]>(
    () => (_SEG as readonly string[]).includes(searchParams.get('seg') || '') ? (searchParams.get('seg') as typeof _SEG[number]) : 'all'
  );
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
  const [collOnlineViewTab, setCollOnlineViewTab] = useState<typeof _VIEW[number]>(
    () => (_VIEW as readonly string[]).includes(searchParams.get('view') || '') ? (searchParams.get('view') as typeof _VIEW[number]) : 'active'
  );
  // ── Sync the online-clients tabs ↔ the URL (?view= & ?seg=) so each tab is a
  //    deep-linkable "page" and back/forward navigate between them. Online tab only.
  useEffect(() => {
    if (activeTab !== 'online_clients') return;
    if (searchParams.get('view') === collOnlineViewTab && searchParams.get('seg') === collOnlineSubTab) return;
    const next = new URLSearchParams(searchParams);
    next.set('view', collOnlineViewTab);
    next.set('seg', collOnlineSubTab);
    setSearchParams(next); // pushes history → back button moves between tabs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collOnlineViewTab, collOnlineSubTab, activeTab]);
  useEffect(() => {
    if (activeTab !== 'online_clients') return;
    const v = searchParams.get('view');
    const s = searchParams.get('seg');
    if (v && (_VIEW as readonly string[]).includes(v) && v !== collOnlineViewTab) setCollOnlineViewTab(v as typeof _VIEW[number]);
    if (s && (_SEG as readonly string[]).includes(s) && s !== collOnlineSubTab) setCollOnlineSubTab(s as typeof _SEG[number]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, activeTab]);
  // Daqqi clients tab — housing + old data state
  const [daqqiHousingFilter, setDaqqiHousingFilter] = useState<'all'|'housed'|'unhoused'>('all');
  const [daqqiRoundFilter, setDaqqiRoundFilter] = useState('');
  const [daqqiReceptionFilter, setDaqqiReceptionFilter] = useState('');
  const [daqqiSettingsOpen, setDaqqiSettingsOpen] = useState(false);
  const [daqqiHousingModal, setDaqqiHousingModal] = useState<SubscriberItem|null>(null);
  const [daqqiHousingRoundId, setDaqqiHousingRoundId] = useState('');
  // Bulk selection
  const [collOnlineSelected, setCollOnlineSelected] = useState<Set<string>>(new Set());
  const [collOnlineBulkConfirm, setCollOnlineBulkConfirm] = useState<null|'pause'|'finish'|'delete'|'refund'|'assign'>(null);
  const [collOnlineBulkAssignTo, setCollOnlineBulkAssignTo] = useState('');
  // Convert client modal
  const [convertRow, setConvertRow] = useState<SubscriberItem | null>(null);
  const [convertType, setConvertType] = useState<'finished'|'paused'|'refunded'|'daqqi'|'leads'|'online'|''>('');
  const [convertAttendedLive, setConvertAttendedLive] = useState<boolean>(false);
  const [convertGotCert, setConvertGotCert] = useState<boolean>(false);
  const [convertPauseReason, setConvertPauseReason] = useState('');
  const [convertRefundReason, setConvertRefundReason] = useState('');
  const [convertRefundAmount, setConvertRefundAmount] = useState('');
  const [convertRefundMethod, setConvertRefundMethod] = useState('');
  const [convertSaving, setConvertSaving] = useState(false);
  const [refundActionSaving, setRefundActionSaving] = useState<string|null>(null);
  // New subscriber popup (online manager) — form lives in OnlineSubscriberModal
  const [omNewSubOpen, setOmNewSubOpen] = useState(false);
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
              // Helper: identify international (SAR/USD) vs local (EGP) by payment currency or branch
              const isIntlSub = (s: SubscriberItem) => {
                const nb = normBranchId(s.branch);
                if (nb === 'ONLINE_SAUDI' || nb === 'ONLINE_ABROAD') return true;
                const raw = (s.branch || '').toLowerCase();
                if (raw.includes('saudi') || raw.includes('abroad') || raw.includes('خارج')) return true;
                // Fallback: check if any payment is SAR or USD
                return (s.paymentHistory || []).some(p => p.currency === 'SAR' || p.currency === 'USD');
              };
              const isOnlineSub = (s: SubscriberItem) => {
                const nb = normBranchId(s.branch);
                const raw = (s.branch || '').toLowerCase();
                return nb.startsWith('ONLINE') || raw.includes('online') ||
                  raw.includes('اونلاين') || raw.includes('اون_لاين') || raw.includes('اون لاين');
              };
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
              const mineSubsAll = masterList.filter(s => s.leadId && myCollLeadIds.has(s.leadId));
              // For allOnline KPI tiles — subscribers with explicit online branch
              const allOnline = scopedOrContextSubscribers.filter(isOnlineSub);
              const allCombined = isDaqqiClientsTab
                ? masterList.filter(s => normBranchId(s.branch) === 'DAQQI')
                : masterList.filter(s => normBranchId(s.branch) !== 'DAQQI');
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
                  if (['finished','paused','refunded','refund_pending'].includes(clientSt)) return false;
                } else if (collOnlineViewTab === 'real-local' || collOnlineViewTab === 'real-intl') {
                  // فعلي = active + has at least one enrolled course
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
                  const hist = s.paymentHistory||[];
                  const cpMap: Record<string,number> = {};
                  hist.forEach(p => { if (p.courseId && p.courseExpected && !cpMap[p.courseId]) cpMap[p.courseId] = Number(p.courseExpected)||0; });
                  const totalExp = Object.values(cpMap).reduce((a,b)=>a+b,0);
                  const totalPaid = hist.reduce((a,p)=>{
                    const egp = p.currency==='SAR'?(Number(p.amount)||0)*13:p.currency==='USD'?(Number(p.amount)||0)*50:(Number(p.amount)||0);
                    return a+egp;
                  },0);
                  const rem = totalExp>0 ? Math.max(0,totalExp-totalPaid) : 0;
                  if (collOnlineRemainingFilter==='has_remaining' && rem<=0) return false;
                  if (collOnlineRemainingFilter==='paid' && (totalExp===0||rem>0)) return false;
                }
                return true;
              });
              const todayOnlineStr = new Date().toISOString().slice(0, 10);
              const pmList: string[] = content['finance.payment_methods']
                ? content['finance.payment_methods'].split('||').map((s:string)=>s.trim()).filter(Boolean)
                : ['كاش','فودافون كاش','انستاباي','تحويل بنكي','بطاقة ائتمان','خزنة الدقي'];
              // Collection financial stats
              const thisWeekStart = (() => { const d=new Date(); d.setDate(d.getDate()-d.getDay()); return d.toISOString().slice(0,10); })();
              const calcPaidEGP = (subs: SubscriberItem[], fromDate?: string, toDate?: string) =>
                subs.flatMap(s=>s.paymentHistory||[]).reduce((sum,p)=>{
                  const pDate = (p.at||'').slice(0,10);
                  if (fromDate && pDate < fromDate) return sum;
                  if (toDate && pDate > toDate) return sum;
                  const egp = p.currency==='SAR'?(Number(p.amount)||0)*13:p.currency==='USD'?(Number(p.amount)||0)*50:(Number(p.amount)||0);
                  return sum+egp;
                },0);
              const collTodayRev  = calcPaidEGP(allCombined, todayOnlineStr, todayOnlineStr);
              const collWeekRev   = calcPaidEGP(allCombined, thisWeekStart);
              const collMonthRev  = calcPaidEGP(allCombined, new Date().toISOString().slice(0,7)+'-01');
              const collTotalRem  = allCombined.reduce((sum,s)=>{
                const hist=s.paymentHistory||[];
                const cpMap:Record<string,number>={};
                hist.forEach(p=>{ if(p.courseId&&p.courseExpected&&!cpMap[p.courseId]) cpMap[p.courseId]=Number(p.courseExpected)||0; });
                const exp=Object.values(cpMap).reduce((a,b)=>a+b,0);
                const paid=hist.reduce((a,p)=>{
                  const egp=p.currency==='SAR'?(Number(p.amount)||0)*13:p.currency==='USD'?(Number(p.amount)||0)*50:(Number(p.amount)||0);
                  return a+egp;
                },0);
                return sum+Math.max(0,exp-paid);
              },0);
              const fmtK = (n: number) => n>=1000 ? `${(n/1000).toFixed(1)}K` : String(Math.round(n));
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
                  <KpiStatsRow
                    isDaqqiClientsTab={isDaqqiClientsTab}
                    allCombined={allCombined}
                    isIntlSub={isIntlSub}
                    mineSubsAll={mineSubsAll}
                    collTodayRev={collTodayRev}
                    collWeekRev={collWeekRev}
                    collMonthRev={collMonthRev}
                    collTotalRem={collTotalRem}
                    fmtK={fmtK}
                  />

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
                    subscribers={subscribers}
                    salesOwnSubscribers={salesOwnSubscribers}
                    updateSubscriber={updateSubscriber}
                    notify={notify}
                  />

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
                    subscribers={subscribers}
                    salesOwnSubscribers={salesOwnSubscribers}
                    setSalesOwnSubscribers={setSalesOwnSubscribers}
                    deleteSubscriber={deleteSubscriber}
                    updateSubscriber={updateSubscriber}
                    notify={notify}
                  />
                  {/* Table (hidden when old_data tab is active) */}
                  {/* ── Distribution panel for محلي قديم / دولي قديم ── */}
                  {((collOnlineViewTab === 'old_local' || collOnlineViewTab === 'old_intl') || (collOnlineViewTab === 'old_data' && isDaqqiClientsTab)) && (
                    <OldDataDistributionPanel
                      isDaqqiClientsTab={isDaqqiClientsTab}
                      isAdmin={isAdmin}
                      isDaqqiManager={isDaqqiManager}
                      filtered={filtered}
                      daqqiOldDistribPlan={daqqiOldDistribPlan}
                      setDaqqiOldDistribPlan={setDaqqiOldDistribPlan}
                      daqqiOldDistributing={daqqiOldDistributing}
                      setDaqqiOldDistributing={setDaqqiOldDistributing}
                      staffMembers={staffMembers}
                      subscribers={subscribers}
                      salesOwnSubscribers={salesOwnSubscribers}
                      setSalesOwnSubscribers={setSalesOwnSubscribers}
                      notify={notify}
                    />
                  )}
                  <OldDataImportSection
                    collOnlineViewTab={collOnlineViewTab}
                    isDaqqiClientsTab={isDaqqiClientsTab}
                    courses={courses}
                    notify={notify}
                    setSalesOwnSubscribers={setSalesOwnSubscribers}
                  />
                  {!(collOnlineViewTab === 'old_data' && isDaqqiClientsTab) && (
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
                    updateSubscriber={updateSubscriber}
                    setSalesOwnSubscribers={setSalesOwnSubscribers}
                    deleteSubscriber={deleteSubscriber}
                    setSubPayRow={setSubPayRow}
                    setSubPayDraft={setSubPayDraft}
                    setSubContactRow={setSubContactRow}
                    setSubContactDraft={setSubContactDraft}
                    setSubInstRow={setSubInstRow}
                    setSubInstDraft={setSubInstDraft}
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
                  />
                  )}
                  <ClientsPagination
                    totalPages={totalPages}
                    safePage={safePage}
                    setCollOnlinePage={setCollOnlinePage}
                  />

                  <DaqqiHousingModal
                    daqqiHousingModal={daqqiHousingModal}
                    isDaqqiClientsTab={isDaqqiClientsTab}
                    setDaqqiHousingModal={setDaqqiHousingModal}
                    daqqiHousingRoundId={daqqiHousingRoundId}
                    setDaqqiHousingRoundId={setDaqqiHousingRoundId}
                    salesOwnDaqqiRounds={salesOwnDaqqiRounds}
                    setSalesOwnDaqqiRounds={setSalesOwnDaqqiRounds}
                    housingMap={housingMap}
                    notify={notify}
                  />

                  {/* ===== مشترك جديد — دقي (unified) ===== */}
                  <AddSubscriberModal
                    isOpen={omNewSubOpen && isDaqqiClientsTab}
                    onClose={() => setOmNewSubOpen(false)}
                    notify={notify}
                    mode="daqqi"
                    branchLabel="فرع الدقي"
                  />
                  {/* ===== مشترك جديد — أونلاين (unified) ===== */}
                  <OnlineSubscriberModal
                    isOpen={omNewSubOpen && !isDaqqiClientsTab}
                    onClose={() => setOmNewSubOpen(false)}
                    notify={notify}
                  />

                  <ConvertClientModal
                    convertRow={convertRow}
                    setConvertRow={setConvertRow}
                    convertType={convertType}
                    setConvertType={setConvertType}
                    isDaqqiClientsTab={isDaqqiClientsTab}
                    convertAttendedLive={convertAttendedLive}
                    setConvertAttendedLive={setConvertAttendedLive}
                    convertGotCert={convertGotCert}
                    setConvertGotCert={setConvertGotCert}
                    convertPauseReason={convertPauseReason}
                    setConvertPauseReason={setConvertPauseReason}
                    convertRefundReason={convertRefundReason}
                    setConvertRefundReason={setConvertRefundReason}
                    convertRefundAmount={convertRefundAmount}
                    setConvertRefundAmount={setConvertRefundAmount}
                    convertRefundMethod={convertRefundMethod}
                    setConvertRefundMethod={setConvertRefundMethod}
                    convertSaving={convertSaving}
                    setConvertSaving={setConvertSaving}
                    updateSubscriber={updateSubscriber}
                    setSalesOwnSubscribers={setSalesOwnSubscribers}
                    deleteSubscriber={deleteSubscriber}
                    addLead={addLead}
                    notify={notify}
                  />

                  <ClientDetailsModal
                    collDetailsRow={collDetailsRow}
                    setCollDetailsRow={setCollDetailsRow}
                    collDetailsDraft={collDetailsDraft}
                    setCollDetailsDraft={setCollDetailsDraft}
                    collDetailsSaving={collDetailsSaving}
                    setCollDetailsSaving={setCollDetailsSaving}
                    courses={courses}
                    bundles={bundles}
                    updateSubscriber={updateSubscriber}
                    isNonAdminStaff={isNonAdminStaff}
                    setSalesOwnSubscribers={setSalesOwnSubscribers}
                    notify={notify}
                  />
                </article>
              );
}
