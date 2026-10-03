import React, { useState } from 'react';
import { cairoDateOnly, cairoMonthOnly, cairoDay, cairoWeekStart } from '../../../../shared/cairoDate';
import { Modal } from '../../../../shared/ui/Modal';
import { useSearchParams } from 'react-router-dom';
import { usePaymentBoxes } from '../../../lib/paymentMethods';
import {
  
  Plus, X,
} from 'lucide-react';
import type {
  Bundle, Course,
  DaqqiRound, DaqqiRoundAttendee, LeadItem,
  StaffMember, SubscriberItem,
} from '../../../types';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { normBranchId } from '../dashboardShared';
import PaymentModal, { blankPaymentDraft, type PaymentDraft } from '../../../components/PaymentModal';
import { createClientWithPayment } from '../../../lib/createClientWithPayment';
import SectionCustomTabs from './SectionCustomTabs';

// Kept beside the component so the URL parser and the tab strip agree on what
// a valid view is; an unknown ?view= falls back to 'active' rather than
// rendering an empty table.
type OnlineViewTab = 'active' | 'real-local' | 'real-saudi' | 'real-intl' | 'finished' | 'paused' | 'refunded' | 'old_data' | 'old_local' | 'old_intl' | 'booked2024' | 'booked2025';
const ONLINE_VIEW_TABS: OnlineViewTab[] = ['active', 'real-local', 'real-saudi', 'real-intl', 'finished', 'paused', 'refunded', 'old_data', 'old_local', 'old_intl', 'booked2024', 'booked2025'];
// «محلي / سعودي / دولي» — by what the client pays in (onlineClientsUtils).
const MARKET_TABS: Partial<Record<OnlineViewTab, ClientMarket>> = { 'real-local': 'local', 'real-saudi': 'saudi', 'real-intl': 'intl' };
// The Dokki cohort tabs. Keyed rather than parsed out of the tab name so adding
// عملاء 26 next year is one entry here plus one in ViewTabsBar.
const BOOKING_YEAR_TABS: Partial<Record<OnlineViewTab, number>> = { booked2024: 2024, booked2025: 2025 };
import { branchMatchesFilter } from '../branchWorkspaceFilters';
import { OnlineClientConvertModal, type OnlineClientConvertType } from './OnlineClientConvertModal';
import { DaqqiHousingModal } from './DaqqiHousingModal';
import { OnlineClientsKpiStrip } from './OnlineClientsKpiStrip';
import { OldDataImportSection } from './online-clients-sections/OldDataImportSection';
import { BulkActionBar } from './online-clients-sections/BulkActionBar';
import { ClientsPagination } from './online-clients-sections/ClientsPagination';
import { ViewTabsBar } from './online-clients-sections/ViewTabsBar';
import { FiltersToolbar } from './online-clients-sections/FiltersToolbar';
import { ClientsTable } from './online-clients-sections/ClientsTable';
import { InstallmentPlansModal } from './online-clients-sections/InstallmentPlansModal';
import { CollectionSettingsModal } from './online-clients-sections/CollectionSettingsModal';
import { OnlineImportModal } from './online-clients-sections/OnlineImportModal';
import { itemKeyOf } from '../../../lib/agreedPrice';
import {
  calcSubscribersPaidEGP,
  formatCompactNumber,
  isInternationalSubscriber,
  isOnlineClient,
  MARKET_BRANCH,
  MARKET_LABELS,
  subscriberMarket,
  clientCurrency,
  isFullyPaid,
  subscriberBalance,
  type ClientMarket,
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
  canDeleteSubscriber: boolean;
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
  branchFilter?: string;
}

export default function OnlineClientsTab({
  activeTab, subscribers, salesOwnSubscribers, setSalesOwnSubscribers,
  courses, bundles, staffMembers, content, salesOwnDaqqiRounds, setSalesOwnDaqqiRounds,
  salesOwnLeads, updateSubscriber, addSubscriber, reloadSubscribers, reloadLeads, deleteSubscriber, notify,
  isDaqqiManager, canDeleteSubscriber, isReceptionDaqqi, isAdmin, isOnlineManager, isNonAdminStaff, currentStaff,
  staffSelf, onlineTeamMembers, subCsDistributing, setSubCsDistributing,
  daqqiOldDistribPlan, setDaqqiOldDistribPlan, daqqiOldDistributing, setDaqqiOldDistributing,
  setSubPayRow, setSubPayDraft,
  branchFilter,
}: Props) {
  // One list for every box dropdown: what الإعدادات lists, plus every box the
  // institute has collected into. A hook, so it is read once at the top —
  // the dropdowns below sit inside conditional blocks and callbacks.
  const paymentBoxes = usePaymentBoxes(content['finance.payment_methods']);

  // The Dokki branch's real client count, from the database, the moment the tab
  // opens. The rows arrive in pages behind it (SiteData.loadBranchSubscribers), so
  // the figure above the table is right long before the table is full — it used to
  // be however many of the 500 newest clients of all branches were Dokki's.
  const [daqqiServerCount, setDaqqiServerCount] = useState<{ total: number; byStatus: Record<string, number> } | null>(null);
  React.useEffect(() => {
    if (activeTab !== 'daqqi_clients') return undefined;
    let cancelled = false;
    mysqlAdmin.countSubscribers('DAQQI')
      .then(result => { if (!cancelled) setDaqqiServerCount(result); })
      .catch(() => { /* the loaded rows are counted instead */ });
    return () => { cancelled = true; };
  }, [activeTab]);

  // Collection role — online clients tab state
  const [collOnlineSearch, setCollOnlineSearch] = useState('');
  const [collOnlinePage, setCollOnlinePage] = useState(1);
  const [collOnlineDateFrom, setCollOnlineDateFrom] = useState('');
  const [collOnlineDateTo, setCollOnlineDateTo] = useState('');
  const [collOnlineRemainingFilter, setCollOnlineRemainingFilter] = useState<'all'|'has_remaining'|'paid'>('all');
  const [collOnlineCourseFilter, setCollOnlineCourseFilter] = useState('');
  const [collOnlineVisibleCols, setCollOnlineVisibleCols] = useState<Record<string,boolean>>({
    // branch: the list holds every branch now, so which one a client belongs to
    // has to be readable on the row rather than implied by the tab you opened.
    branch: true,
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
  // The open tab lives in the URL rather than in component state, so the link
  // in the address bar names the view you are actually looking at: it can be
  // sent to a colleague, bookmarked, and the browser's back button steps
  // through tabs instead of leaving the page.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlView = searchParams.get('view') as OnlineViewTab | null;
  const collOnlineViewTab: OnlineViewTab = urlView && ONLINE_VIEW_TABS.includes(urlView) ? urlView : 'active';
  // A staff-built tab open in the same row; opening a built-in one closes it.
  const [customTabId, setCustomTabId] = useState<string | null>(null);
  const [customTabsSlot, setCustomTabsSlot] = useState<HTMLSpanElement | null>(null);
  const setCollOnlineViewTab = (value: OnlineViewTab) => {
    setCustomTabId(null);
    const next = new URLSearchParams(searchParams);
    next.set('view', value);
    // replace: switching tabs is not a navigation worth a history entry per
    // click, but the URL still reflects where you are.
    setSearchParams(next, { replace: true });
  };
  // Daqqi clients tab — housing + old data state
  const [daqqiHousingFilter, setDaqqiHousingFilter] = useState<'all'|'housed'|'unhoused'>('all');
  const [daqqiRoundFilter, setDaqqiRoundFilter] = useState('');
  const [daqqiReceptionFilter, setDaqqiReceptionFilter] = useState('');
  // One draft for the shared booking screen. This was a hand-rolled object of
  // twelve fields — a third spelling of the same form.
  // A collection officer's new customer is a booking the manager reviews: the
  // same booking screen, and nothing is added until the transfer is confirmed.
  // Their customers are online ones, so the draft starts there, not at Daqqi.
  const isCollectionStaff = String(currentStaff?.role || '').toLowerCase() === 'collection';
  const newClientBranch = isCollectionStaff ? 'ONLINE_EGYPT' : 'DAQQI';
  const [newClientDraft, setNewClientDraft] = useState<PaymentDraft>(blankPaymentDraft({ branch: newClientBranch }));
  // Creating the customer and recording the money in one place, through the
  // endpoint that journals it. This screen used to post the payment itself and
  // the Daqqi desk wrote it onto the subscriber record — two spellings, one of
  // which never reached the books.
  const handleNewCollectionClient = async (draft: PaymentDraft) => {
    const result = await createClientWithPayment(draft, { branch: draft.branch || 'ONLINE_EGYPT', source: 'staff' });
    notify('info', result.pendingReview
      ? `اتبعت حجز ${(draft.name || '').trim()} للمسئول — هيتضاف بعد ما يراجع التحويل ويعتمده`
      : `✅ تم إضافة ${(draft.name || '').trim()}`);
  };
  const handleNewDaqqiClient = async (draft: PaymentDraft) => {
    const result = await createClientWithPayment(draft, { branch: draft.branch || 'DAQQI', source: 'reception' });
    const fresh = await mysqlAdmin.listAllSubscribers();
    setSalesOwnSubscribers(fresh as unknown as SubscriberItem[]);
    notify(result.approvalRequired ? 'info' : 'success',
      result.approvalRequired
        ? `✅ تم إضافة ${(draft.name || '').trim()} والدفعة بانتظار اعتماد المالية`
        : `✅ تم إضافة ${(draft.name || '').trim()} بنجاح`);
  };
  const [daqqiSettingsOpen, setDaqqiSettingsOpen] = useState(false);
  // The staff-built tabs dialog, opened from this screen's own settings menu.
  const [showSectionTabs, setShowSectionTabs] = useState(false);
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
  const [convertRefundPaymentId, setConvertRefundPaymentId] = useState('');
  const [convertSaving, setConvertSaving] = useState(false);
  // New subscriber popup (online manager)
  const [omNewSubOpen, setOmNewSubOpen] = useState(false);
  const [omNewSubDraft, setOmNewSubDraft] = useState<{name:string;phone:string;email:string;password:string;branch:string;amount:string;currency:'EGP'|'SAR'|'USD';paymentMethod:string;date:string;transactionId:string;note:string;referredBy:string;courses:{courseId:string;accessType:'full'|'limited';videoCount:string;discount:string;customPrice:string}[]}>({ name: '', phone: '', email: '', password: '', branch: '', amount: '', currency: 'EGP', paymentMethod: '', date: cairoDateOnly(), transactionId: '', note: '', referredBy: '', courses: [{courseId:'',accessType:'full',videoCount:'',discount:'',customPrice:''}] });
  const [omNewSubSaving, setOmNewSubSaving] = useState(false);
  const omNewSubReset = () => setOmNewSubDraft({name:'',phone:'',email:'',password:'',branch:'',amount:'',currency:'EGP',paymentMethod:'',date:cairoDateOnly(),transactionId:'',note:'',referredBy:'',courses:[{courseId:'',accessType:'full',videoCount:'',discount:'',customPrice:''}]});
  // "تفاصيل" popup for online_clients table
  const [installmentsRow, setInstallmentsRow] = useState<SubscriberItem | null>(null);
  const [collectionSettingsOpen, setCollectionSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

              const isDaqqiClientsTab = activeTab === 'daqqi_clients';
              // Housing map: subscriberId → { roundId, roundCode, receptionId, receptionName }
              // The client follows the round: whoever is the round's reception is the
              // person responsible for the client in it. A client in several rounds
              // follows the latest booking, a running round over a finished one — the
              // first round in the list used to win, whatever its age.
              const housingMap = new Map<string, { roundId: string; roundCode: string; receptionId: string; receptionName: string }>();
              if (isDaqqiClientsTab) {
                const chosen = new Map<string, { bookedAt: string; live: boolean }>();
                (salesOwnDaqqiRounds ?? []).forEach((round: DaqqiRound) => {
                  (round.attendees ?? []).forEach((att: DaqqiRoundAttendee) => {
                    const bookedAt = String(att.bookedAt || '');
                    const live = round.status !== 'finished';
                    const held = chosen.get(att.subscriberId);
                    if (held && (held.live && !live || (held.live === live && held.bookedAt >= bookedAt))) return;
                    chosen.set(att.subscriberId, { bookedAt, live });
                    housingMap.set(att.subscriberId, {
                      roundId: round.id,
                      roundCode: round.code || round.id.slice(0,6),
                      receptionId: round.receptionId,
                      receptionName: round.receptionName,
                    });
                  });
                });
              }
              // سنة الحجز — the year a client was booked into a round, off
              // attendee.bookedAt. A client can be booked into more than one
              // round, so a cohort tab shows everyone booked that year rather
              // than only first-timers.
              const bookingYearsById = new Map<string, Set<number>>();
              if (isDaqqiClientsTab) {
                (salesOwnDaqqiRounds ?? []).forEach((round: DaqqiRound) => {
                  (round.attendees ?? []).forEach((att: DaqqiRoundAttendee) => {
                    const year = Number(String(att.bookedAt || '').slice(0, 4));
                    if (!Number.isInteger(year) || year < 1900) return;
                    const years = bookingYearsById.get(att.subscriberId) || new Set<number>();
                    years.add(year);
                    bookingYearsById.set(att.subscriberId, years);
                  });
                });
              }
              // A client not yet placed in any round has no booking date at all,
              // so their registration year stands in — otherwise every unhoused
              // client would be missing from both cohorts.
              const bookedInYear = (s: SubscriberItem, year: number) => {
                const booked = bookingYearsById.get(s.id);
                if (booked?.size) return booked.has(year);
                return Number(String(s.createdAt || '').slice(0, 4)) === year;
              };
              const isIntlSub = isInternationalSubscriber;
              // Prefer staff-scoped data when it is present, but fall back to context data.
              // Production can temporarily return an empty scoped list after API/date issues;
              // falling back keeps managers from seeing an empty CRM while the full context is loaded.
              //
              // A payment or a booking reloads the context's list at once, while the
              // desk's own copy is rebuilt only on the next poll. Reading the own copy
              // alone is why an instalment recorded a moment ago did not show on the
              // client: the row was the one fetched before it.
              const scopedOrContextSubscribers = salesOwnSubscribers.length > 0
                ? (() => {
                  const fresh = new Map(subscribers.map(row => [row.id, row]));
                  return salesOwnSubscribers.map(row => fresh.get(row.id) ?? row);
                })()
                : subscribers;
              const masterList = isDaqqiClientsTab
                ? scopedOrContextSubscribers
                : (isAdmin && !isOnlineManager ? subscribers : scopedOrContextSubscribers);
              const shouldUseScopedSubscribers = isOnlineManager || isNonAdminStaff || isDaqqiManager || isReceptionDaqqi;
              const actionSubscribers = shouldUseScopedSubscribers ? scopedOrContextSubscribers : subscribers;
              const branchScopedMasterList = branchFilter
                ? masterList.filter(s => branchMatchesFilter(s.branch, branchFilter))
                : masterList;
              // عملاء الدقي is the Daqqi desk and stays Daqqi-only; the online
              // screen holds online clients only — محلي، سعودي، دولي. It used to
              // list every branch, so Dokki and Tagamoa clients sat in it, and
              // «إجمالي العملاء» (1491) was more than its own three markets
              // added up to (1477).
              const allCombined = isDaqqiClientsTab
                ? branchScopedMasterList.filter(s => normBranchId(s.branch) === 'DAQQI')
                : branchScopedMasterList.filter(isOnlineClient);
              const holdsItem = (s: SubscriberItem, item: string) => (item.startsWith('bundle:')
                ? (s.enrolledBundleIds || []).includes(item.slice(7))
                : (s.enrolledCourseIds || []).includes(item))
                || (s.paymentHistory || []).some(payment => itemKeyOf(payment) === item);
              // Each client's balance once per render, for the filter and the
              // total — from the same items the table shows.
              const balances = new Map<string, ReturnType<typeof subscriberBalance>>();
              const balanceOf = (s: SubscriberItem) => {
                if (!balances.has(s.id)) balances.set(s.id, subscriberBalance(s, courses, bundles));
                return balances.get(s.id)!;
              };
              // For local/intl real tabs, always draw from allCombined
              const viewMarket = MARKET_TABS[collOnlineViewTab];
              const tabFiltered =
                viewMarket ? allCombined.filter(s => isOnlineClient(s) && subscriberMarket(s) === viewMarket) :
                collOnlineViewTab === 'old_data'  ? allCombined :
                collOnlineViewTab === 'old_local' ? allCombined.filter(s => !isIntlSub(s)) :
                collOnlineViewTab === 'old_intl'  ? allCombined.filter(isIntlSub) :
                // The collOnlineSubTab branches that used to sit here (local /
                // intl / mine) were unreachable: nothing in the UI ever called
                // its setter, so the value stayed 'all' and only this last arm
                // could run. collOnlineViewTab above is the control that is
                // actually wired to the tab strip.
                allCombined;
              const filtered = tabFiltered.filter(s => {
                // View tab filter — use clientStatus field (set by convert button)
                const clientSt = s.clientStatus || '';
                if (collOnlineViewTab === 'active') {
                  if (s.isActive === false) return false;
                  if (['finished','paused','refunded','refund_pending'].includes(clientSt)) return false;
                } else if (viewMarket) {
                  // فعلي = active + has at least one enrolled course
                  if (s.isActive === false) return false;
                  if (['finished','paused','refunded','refund_pending'].includes(clientSt)) return false;
                  if ((s.enrolledCourseIds||[]).length === 0) return false;
                } else if (BOOKING_YEAR_TABS[collOnlineViewTab]) {
                  // A cohort, not a lifecycle state: everyone booked that year,
                  // whatever their status happens to be now.
                  if (!bookedInYear(s, BOOKING_YEAR_TABS[collOnlineViewTab] as number)) return false;
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
                if (collOnlineDateFrom && cairoDay(s.createdAt) < collOnlineDateFrom) return false;
                if (collOnlineDateTo   && cairoDay(s.createdAt) > collOnlineDateTo)   return false;
                // A course or a track the client holds. A track never appears in
                // enrolledCourseIds, so choosing one showed nobody.
                if (collOnlineCourseFilter && !holdsItem(s, collOnlineCourseFilter)) return false;
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
                if (collOnlineRemainingFilter === 'has_remaining' && balanceOf(s).remainingEgp <= 0) return false;
                if (collOnlineRemainingFilter === 'paid' && !isFullyPaid(balanceOf(s))) return false;
                return true;
              });
              const todayOnlineStr = cairoDateOnly();
              // Collection financial stats
              const thisWeekStart = cairoWeekStart();
              const calcPaidEGP = calcSubscribersPaidEGP;
              const collTodayRev  = calcPaidEGP(allCombined, todayOnlineStr, todayOnlineStr);
              const collWeekRev   = calcPaidEGP(allCombined, thisWeekStart);
              const collMonthRev  = calcPaidEGP(allCombined, cairoMonthOnly()+'-01');
              const collTotalRem  = allCombined.reduce((sum, s) => sum + balanceOf(s).remainingEgp, 0);
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
                  {/* One element serves both halves of this screen: the same
                      component is mounted under 'daqqi' when the الدقي clients
                      tab is open and 'online' otherwise, so each keeps its own
                      set of staff-built tabs without a second implementation. */}
                  <OnlineClientsKpiStrip
                    isDaqqiClientsTab={isDaqqiClientsTab}
                    allCombined={allCombined}
                    collTodayRev={collTodayRev}
                    collWeekRev={collWeekRev}
                    collMonthRev={collMonthRev}
                    collTotalRem={collTotalRem}
                    fmtK={fmtK}
                    marketOf={s => (isOnlineClient(s) ? subscriberMarket(s) : null)}
                    serverCount={isDaqqiClientsTab ? daqqiServerCount : null}
                  />
                  {isDaqqiClientsTab && daqqiServerCount && allCombined.length < daqqiServerCount.total && (
                    <div className="mb-2 flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-[11px] font-bold text-indigo-700" role="status">
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
                      جاري تحميل باقي العملاء… {allCombined.length.toLocaleString('ar-EG-u-nu-latn')} من {daqqiServerCount.total.toLocaleString('ar-EG-u-nu-latn')}
                    </div>
                  )}

                  {/* === Tabs row === */}
                  <ViewTabsBar
                    onOpenSectionTabs={isAdmin ? () => setShowSectionTabs(true) : undefined}
                    onOpenCollectionSettings={(isAdmin || isOnlineManager) ? () => setCollectionSettingsOpen(true) : undefined}
                    onOpenImport={(isAdmin || isOnlineManager) ? () => setImportOpen(true) : undefined}
                    customTabsSlot={setCustomTabsSlot}
                    customTabOpen={!!customTabId}
                    staffMembers={staffMembers}
                    isDaqqiClientsTab={isDaqqiClientsTab}
                    allCombined={allCombined}
                    isIntlSub={isIntlSub}
                    bookedInYear={bookedInYear}
                    marketOf={s => (isOnlineClient(s) ? subscriberMarket(s) : null)}
                    collOnlineViewTab={collOnlineViewTab}
                    setCollOnlineViewTab={setCollOnlineViewTab}
                    setCollOnlinePage={setCollOnlinePage}
                    filtered={filtered}
                    isOnlineManager={isOnlineManager}
                    isCollection={isCollectionStaff}
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

                  <SectionCustomTabs
                    section={isDaqqiClientsTab ? 'daqqi' : 'online'}
                    notify={notify}
                    settingsOpen={showSectionTabs}
                    onSettingsOpenChange={setShowSectionTabs}
                    stripSlot={customTabsSlot}
                    openTabId={customTabId}
                    onOpenTabIdChange={setCustomTabId}
                  />
                  {/* The built-in view, unless a staff-built tab is open in its place. */}
                  {!customTabId && (<>
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
                    notify={notify}
                    setSalesOwnSubscribers={setSalesOwnSubscribers}
                  />
                  <ClientsTable
                    canDeleteSubscriber={canDeleteSubscriber}
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
                    isCollection={isCollectionStaff}
                    shouldUseScopedSubscribers={shouldUseScopedSubscribers}
                    updateSubscriber={updateSubscriber}
                    reloadSubscribers={reloadSubscribers}
                    setSalesOwnSubscribers={setSalesOwnSubscribers}
                    deleteSubscriber={deleteSubscriber}
                    setSubPayRow={setSubPayRow}
                    setSubPayDraft={setSubPayDraft}
                    setDaqqiHousingModal={setDaqqiHousingModal}
                    setDaqqiHousingRoundId={setDaqqiHousingRoundId}
                    setConvertRow={setConvertRow}
                    setConvertType={setConvertType}
                    setConvertAttendedLive={setConvertAttendedLive}
                    setConvertGotCert={setConvertGotCert}
                    setConvertPauseReason={setConvertPauseReason}
                    setConvertRefundReason={setConvertRefundReason}
                    setConvertRefundAmount={setConvertRefundAmount}
                    setConvertRefundMethod={setConvertRefundMethod}
                    setConvertRefundPaymentId={setConvertRefundPaymentId}
                    setInstallmentsRow={setInstallmentsRow}
                    filteredLength={filtered.length}
                    notify={notify}
                  />
                  {/* Pagination */}
                  <ClientsPagination totalPages={totalPages} safePage={safePage} setCollOnlinePage={setCollOnlinePage} />
                  </>)}


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
                    const pmList: string[] = paymentBoxes;
                    return (
                    <>
                      {isCollectionStaff && !isDaqqiClientsTab ? (
                        <PaymentModal
                          mode="new"
                          subject={{ id: '', name: '' }}
                          draft={newClientDraft}
                          setDraft={setNewClientDraft}
                          onSubmit={handleNewCollectionClient}
                          lockPrice
                          onClose={() => { setOmNewSubOpen(false); setNewClientDraft(blankPaymentDraft({ branch: newClientBranch })); }}
                        />
                      ) : isDaqqiClientsTab ? (
                        /* عميل دقي جديد — نفس شاشة الحجز والدفع المستخدمة في كل مكان.
                           كانت نسخة مكتوبة هنا بحقولها الخاصة، وتوأمها في مكتب الدقي. */
                        <PaymentModal
                          mode="new"
                          subject={{ id: '', name: '' }}
                          draft={newClientDraft}
                          setDraft={setNewClientDraft}
                          onSubmit={handleNewDaqqiClient}
                          onClose={() => { setOmNewSubOpen(false); setNewClientDraft(blankPaymentDraft({ branch: newClientBranch })); }}
                        />
                      ) : (
                      /* مشترك أونلاين جديد — إنشاء حساب دخول:
                         باسورد، وصلاحية كل كورس، وأول دفعة في نداء واحد. */
                      <Modal
                        open
                        onClose={() => { setOmNewSubOpen(false); omNewSubReset(); }}
                        title="🌐 مشترك أونلاين جديد"
                        subtitle="إنشاء حساب عميل أونلاين"
                        tone="emerald"
                        size="md"
                        align="sheet"
                      >
                        <div className="space-y-4">
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
                                <label className="block text-xs font-bold text-gray-600 mb-1">رقم الهاتف *</label>
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
                          {/* A client is reached by phone, and money is not recorded against
                              one without (the server refuses it: PHONE_REQUIRED). */}
                          <button disabled={omNewSubSaving || !omNewSubDraft.name.trim() || omNewSubDraft.phone.replace(/\D/g, '').length < 9 || !omNewSubDraft.email.trim() || !omNewSubDraft.password.trim() || (Number(omNewSubDraft.amount) > 0 && !omNewSubDraft.paymentMethod)}
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
                      </Modal>
                      )} {/* end isDaqqiClientsTab ternary */}
                    </>
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
                      refundPaymentId={convertRefundPaymentId}
                      setRefundPaymentId={setConvertRefundPaymentId}
                      saving={convertSaving}
                      isDaqqiClientsTab={isDaqqiClientsTab}
                      currentMarket={isOnlineClient(convertRow) ? subscriberMarket(convertRow) : null}
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
                                      if (convertType === 'local' || convertType === 'saudi' || convertType === 'intl') {
                                        // Moved by hand: the market sticks whatever they paid in, and
                                        // the branch follows so currency and pricing agree with it.
                                        const { crm_json: _dropCrm3, ...marketRowClean } = convertRow as SubscriberItem & { crm_json?: unknown };
                                        const moved: SubscriberItem = {
                                          ...marketRowClean, market: convertType, branch: MARKET_BRANCH[convertType],
                                          clientStatus: 'active', transferDate: cairoDateOnly(),
                                        };
                                        if (!await updateSubscriber(moved)) throw new Error('فشل حفظ تحويل العميل');
                                        setSalesOwnSubscribers(prev => prev.map(s => s.id === moved.id ? moved : s));
                                        setConvertRow(null);
                                        notify('success', `✅ تم تحويل ${convertRow.name} إلى ${MARKET_LABELS[convertType]}`);
                                        return;
                                      }
                                      if (convertType === 'online') {
                                        const { crm_json: _dropCrm2, ...onlineRowClean } = convertRow as SubscriberItem & { crm_json?: unknown };
                                        const onlineUpdated: SubscriberItem = { ...onlineRowClean, branch: 'ONLINE_EGYPT' as const, clientStatus: 'active' as const, transferDate: cairoDateOnly() };
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
                                         // A refund request against the payment chosen, for approval in
                                         // «طلبات الاسترداد»; the client shows as awaiting it meanwhile.
                                         const payment = (convertRow.paymentHistory || []).find(p => p.id === convertRefundPaymentId);
                                         if (!payment) throw new Error('اختار الدفعة اللي هتترد');
                                         await mysqlAdmin.createRefundByAdmin({
                                           subscriber_id: convertRow.id, payment_id: payment.id,
                                           amount: Number(convertRefundAmount) || payment.amount, currency: payment.currency || 'EGP',
                                           reason: convertRefundReason.trim(), refund_method: convertRefundMethod,
                                         });
                                         const { crm_json: _dropCrm4, ...refundRowClean } = convertRow as SubscriberItem & { crm_json?: unknown };
                                         const pending: SubscriberItem = { ...refundRowClean, clientStatus: 'refund_pending', transferAnswers: answers, transferDate: cairoDateOnly() };
                                         if (!await updateSubscriber(pending)) throw new Error('اتفتح طلب الاسترداد، بس حالة العميل متحفظتش');
                                         setSalesOwnSubscribers(prev => prev.map(s => s.id === pending.id ? pending : s));
                                         setConvertRow(null);
                                         notify('success', `✅ اتفتح طلب استرداد لـ ${convertRow.name} — مستني الاعتماد في «طلبات الاسترداد»`);
                                         return;
                                       }
                                       // Strip any stale crm_json property to prevent nesting in DB
                                      const { crm_json: _dropCrm, ...convertRowClean } = convertRow as SubscriberItem & { crm_json?: unknown };
                                      const updated: SubscriberItem = {
                                        ...convertRowClean,
                                        clientStatus: convertType === 'daqqi' ? undefined : convertType,
                                        transferAnswers: answers,
                                        transferDate: cairoDateOnly(),
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

                  {collectionSettingsOpen && (
                    <CollectionSettingsModal
                      staffMembers={isOnlineManager ? onlineTeamMembers : staffMembers}
                      subscribers={scopedOrContextSubscribers}
                      notify={notify}
                      onClose={() => setCollectionSettingsOpen(false)}
                      onChanged={reloadSubscribers}
                    />
                  )}

                  {importOpen && (
                    <OnlineImportModal
                      staffMembers={isOnlineManager ? onlineTeamMembers : staffMembers}
                      notify={notify}
                      onClose={() => setImportOpen(false)}
                      onImported={reloadSubscribers}
                    />
                  )}

                  {installmentsRow && (
                    <InstallmentPlansModal
                      subscriber={installmentsRow}
                      courses={courses}
                      bundles={bundles}
                      paymentBoxes={paymentBoxes}
                      defaultCurrency={clientCurrency(installmentsRow)}
                      notify={notify}
                      onClose={() => setInstallmentsRow(null)}
                      onChanged={reloadSubscribers}
                      lockPrice={isCollectionStaff}
                    />
                  )}
                </article>
              );
}
