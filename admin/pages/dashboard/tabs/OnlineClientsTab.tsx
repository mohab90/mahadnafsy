import React, { useEffect, useState } from 'react';
import { housingNeedOf, isFullyHoused, needsHousing, type HousingNeed } from './daqqi/daqqiHousingNeeds';
import { cairoDateOnly, cairoMonthOnly, cairoDay, cairoWeekStart } from '../../../../shared/cairoDate';
import { Modal } from '../../../../shared/ui/Modal';
import { useSearchParams } from 'react-router-dom';
import { usePaymentBoxes } from '../../../lib/paymentMethods';
import {
  LayoutGrid, Plus, Table2, X,
} from 'lucide-react';
import { isMobileNow } from '../../../hooks/useIsMobile';
import type {
  Bundle, Course,
  DaqqiRound, DaqqiRoundAttendee, LeadItem,
  StaffMember, SubscriberItem,
} from '../../../types';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { normBranchId } from '../dashboardShared';
import { blankPaymentDraft, type PaymentDraft } from '../../../components/PaymentModal';
import { createClientWithPayment } from '../../../lib/createClientWithPayment';
import { announceRoundsChanged, housingOutcome } from '../../../lib/daqqiHousing';
import SectionCustomTabs from './SectionCustomTabs';
import { staffClientsPageOf, staffClientsQuery, useStaffClientsPage } from './useStaffClientsPage';
import { staffClientsArePaged } from '../staffListTabs';
import { useSiteData } from '../../../context/SiteDataContext';

// Kept beside the component so the URL parser and the tab strip agree on what
// a valid view is; an unknown ?view= falls back to 'active' rather than
// rendering an empty table.
type OnlineViewTab = 'active' | 'real-local' | 'real-saudi' | 'real-intl' | 'finished' | 'paused' | 'refunded' | 'old_data' | 'old_local' | 'old_intl' | 'booked2024' | 'booked2025';
const ONLINE_VIEW_TABS: OnlineViewTab[] = ['active', 'real-local', 'real-saudi', 'real-intl', 'finished', 'paused', 'refunded', 'old_data', 'old_local', 'old_intl', 'booked2024', 'booked2025'];
// «محلي / سعودي / دولي» — by what the client pays in (onlineClientsUtils).
const MARKET_TABS: Partial<Record<OnlineViewTab, ClientMarket>> = { 'real-local': 'local', 'real-saudi': 'saudi', 'real-intl': 'intl' };
import { branchMatchesFilter } from '../branchWorkspaceFilters';
import { OnlineClientConvertModal, type OnlineClientConvertType } from './OnlineClientConvertModal';
import { DaqqiHousingModal } from './DaqqiHousingModal';
import { NewSubscriberModal, blankNewSubscriber, type NewSubscriberDraft } from './NewSubscriberModal';
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
import { usePhysicalBranch } from '../../../lib/physicalBranch';
import { matchesSearch } from '../../../lib/clientSearch';
import { holdsIn, itemShowsIn, type BranchTest } from '../../../lib/coursePlacement';
import { NO_COLLECTOR } from './online-clients-sections/FiltersToolbar';
import { FOLLOW_FILTERS, followUpOf, matchesFollowFilter, type FollowFilter } from '../../../lib/clientFollowUp';
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
  courses: Course[];
  bundles: Bundle[];
  staffMembers: StaffMember[];
  content: Record<string, string>;
  salesOwnDaqqiRounds: DaqqiRound[];
  setSalesOwnDaqqiRounds: React.Dispatch<React.SetStateAction<DaqqiRound[] | null>>;
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
  activeTab,
  courses, bundles, staffMembers, content, salesOwnDaqqiRounds, setSalesOwnDaqqiRounds,
  updateSubscriber: updateSubscriberProp, addSubscriber, reloadSubscribers: reloadSubscribersProp, reloadLeads, deleteSubscriber: deleteSubscriberProp, notify,
  isDaqqiManager, canDeleteSubscriber, isReceptionDaqqi, isAdmin, isOnlineManager, currentStaff,
  staffSelf, onlineTeamMembers, subCsDistributing, setSubCsDistributing,
  daqqiOldDistribPlan, setDaqqiOldDistribPlan, daqqiOldDistributing, setDaqqiOldDistributing,
  setSubPayRow, setSubPayDraft,
  branchFilter,
}: Props) {
  // One list for every box dropdown: what الإعدادات lists, plus every box the
  // institute has collected into. A hook, so it is read once at the top —
  // the dropdowns below sit inside conditional blocks and callbacks.
  const paymentBoxes = usePaymentBoxes(content['finance.payment_methods']);

  // Dokki's clients, or Tagamoa's when shown in its section (lib/physicalBranch.tsx).
  const physicalBranch = usePhysicalBranch();
  const isDaqqiClientsTab = activeTab === 'daqqi_clients';
  // Both client screens read a page at a time from the server, which filters and counts (useStaffClientsPage), for
  // every account — the administration's online screen held the whole client table and filtered it here.
  const paged = staffClientsArePaged(activeTab);

  // Collection role — online clients tab state
  const [collOnlineSearch, setCollOnlineSearch] = useState('');
  const [collOnlinePage, setCollOnlinePage] = useState(1);
  // Cards or the table. A phone gets the cards unless it was told otherwise; a desk keeps the table. The
  // choice is remembered — «الجدول احتياطي، وعلى الموبايل الكروت هي الأساسي» (17 Oct 2026).
  const [layout, setLayoutState] = useState<'cards' | 'table'>(() => {
    try { const saved = localStorage.getItem('clients-layout'); if (saved === 'cards' || saved === 'table') return saved; } catch { /* private window */ }
    return isMobileNow() ? 'cards' : 'table';
  });
  const setLayout = (next: 'cards' | 'table') => {
    setLayoutState(next); setCollOnlinePage(1);
    try { localStorage.setItem('clients-layout', next); } catch { /* private window */ }
  };
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
  // «فلتر بحالة العميل»: the status in the table's «الحالة» column.
  const [collOnlineStatusFilter, setCollOnlineStatusFilter] = useState('');
  // «المتابعات»: who is due to be called today / is overdue (lib/clientFollowUp.ts).
  const [collOnlineFollowFilter, setCollOnlineFollowFilter] = useState<FollowFilter>('');
  // Collection/online_manager — client sub-view tabs
  // The open tab lives in the URL rather than in component state, so the link
  // in the address bar names the view you are actually looking at: it can be
  // sent to a colleague, bookmarked, and the browser's back button steps
  // through tabs instead of leaving the page.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlView = searchParams.get('view') as OnlineViewTab | null;
  // A link from a notification («عندك 3 متابعات النهاردة») opens the table already filtered: ?follow=due|overdue|today.
  const urlFollow = searchParams.get('follow');
  useEffect(() => {
    if (urlFollow && FOLLOW_FILTERS.some(([key]) => key === urlFollow)) setCollOnlineFollowFilter(urlFollow as FollowFilter);
  }, [urlFollow]);
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
  // «مشترك جديد» is one form for the management, the collection accounts and the Dokki desk
  // (NewSubscriberModal). A collection officer's new customer is a booking the manager reviews, and
  // nothing is added until the transfer is confirmed. Their customers are online ones, so the booking
  // starts there, not at Daqqi.
  const isCollectionStaff = String(currentStaff?.role || '').toLowerCase() === 'collection';
  // A rep's «عملائي» is every client they sold, whichever branch studies:
  // «Sama Shosha … عملته حجز ومظهرش عندها في عملاءها» — a Tagamoa booking of
  // hers was left out with every other Dokki and Tagamoa one.
  const isSalesStaff = String(currentStaff?.role || '').toLowerCase() === 'sales';
  const newClientBranch = isCollectionStaff ? 'ONLINE_EGYPT' : physicalBranch.key;
  // Creating the customer and recording the money in one place, through the
  // endpoint that journals it. This screen used to post the payment itself and
  // the Daqqi desk wrote it onto the subscriber record — two spellings, one of
  // which never reached the books.
  const handleNewCollectionClient = async (draft: PaymentDraft) => {
    const result = await createClientWithPayment(draft, { branch: draft.branch || 'ONLINE_EGYPT', source: 'staff' });
    const housing = housingOutcome([result]);
    if (housing.changed) announceRoundsChanged();
    notify('info', (result.pendingReview
      ? `اتبعت حجز ${(draft.name || '').trim()} للمسئول — هيتضاف ويتسكّن بعد ما يراجع التحويل ويعتمده`
      : `✅ تم إضافة ${(draft.name || '').trim()}`) + housing.text);
  };
  const handleNewDaqqiClient = async (draft: PaymentDraft) => {
    const result = await createClientWithPayment(draft, { branch: draft.branch || physicalBranch.key, source: 'reception' });
    await reloadSubscribers();
    const housing = housingOutcome([result]);
    if (housing.changed) announceRoundsChanged();
    notify(result.approvalRequired || housing.warning ? 'info' : 'success',
      (result.approvalRequired
        ? `✅ تم إضافة ${(draft.name || '').trim()} والدفعة بانتظار اعتماد المالية`
        : `✅ تم إضافة ${(draft.name || '').trim()} بنجاح`) + housing.text);
  };
  // «مشترك جديد» from the management: a login account with its courses and first payment in one call.
  const submitNewAccount = async () => {
    const d = omNewSubDraft;
    if (!d.name.trim() || !d.email.trim() || !d.password.trim()) return;
    setOmNewSubSaving(true);
    try {
      const validCourses = d.courses.filter(c => c.courseId).map(c => ({
        courseId: c.courseId,
        accessType: c.accessType,
        ...(c.accessType === 'limited' && c.videoCount ? { videoCount: String(c.videoCount) } : {}),
        ...(c.customPrice ? { customPrice: Number(c.customPrice) } : {}),
        ...(c.discount ? { discount: Number(c.discount) } : {}),
      }));
      const firstCourse = validCourses[0];
      const firstPaymentAmount = Number(d.amount);
      const accountResult = await mysqlAdmin.createAccount({
        name: d.name.trim(),
        email: d.email.trim(),
        password: d.password,
        phone: d.phone.trim(),
        ...(validCourses.length > 0 ? { courses: validCourses } : {}),
        ...(d.referredBy.trim() ? { referredBy: d.referredBy.trim() } : {}),
        ...(firstPaymentAmount > 0 ? {
          firstPayment: {
            amount: firstPaymentAmount,
            currency: d.currency,
            paymentMethod: d.paymentMethod || undefined,
            date: d.date,
            transactionId: d.transactionId || undefined,
            note: d.note || undefined,
            courseId: firstCourse?.courseId || undefined,
            courseExpected: firstCourse?.customPrice ? Number(firstCourse.customPrice) : undefined,
          },
        } : {}),
      });
      setOmNewSubOpen(false);
      omNewSubReset();
      if (paged) void serverPage.reload();
      notify(
        'success',
        accountResult.approvalRequired
          ? `✅ تم إنشاء حساب ${d.name.trim()} والدفعة بانتظار اعتماد المالية`
          : `✅ تم إنشاء حساب ${d.name.trim()} بنجاح`
      );
    } catch (err: unknown) {
      notify('error', '❌ فشل إنشاء الحساب: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setOmNewSubSaving(false);
    }
  };
  // The same form from the collection accounts and the Dokki desk, without the login: the client and the
  // first booking go through the booking endpoint (a collection officer's customer still waits for the manager).
  const submitNewBooking = async () => {
    const d = omNewSubDraft;
    const first = d.courses[0];
    const lockedPrice = isCollectionStaff && !isDaqqiClientsTab;
    // The price the booking expects: the one typed, or the list price less the discount — never for a locked desk.
    let expected = 0;
    if (first?.courseId && !lockedPrice) {
      if (Number(first.customPrice) > 0) expected = Number(first.customPrice);
      else if (Number(first.discount) > 0) {
        const item = first.courseId.startsWith('bundle:')
          ? bundles.find(b => b.id === first.courseId.slice(7)) : courses.find(c => c.id === first.courseId);
        const list = Number(item?.price?.[d.currency]) || 0;
        if (!list) { notify('error', 'مفيش سعر للكورس ده بالعملة دي — اكتب السعر المخصص بدل الخصم.'); return; }
        expected = Math.round(list * (1 - Math.min(100, Number(first.discount)) / 100));
      }
    }
    const draft: PaymentDraft = {
      ...blankPaymentDraft({ branch: newClientBranch, currency: d.currency }),
      name: d.name.trim(), phone: d.phone.trim(),
      courseId: first?.courseId || '', customExpected: expected ? String(expected) : '',
      amount: d.amount, paymentMethod: d.paymentMethod, transactionId: d.transactionId, date: d.date,
      note: [d.note.trim(), d.referredBy.trim() ? `المحوِّل: ${d.referredBy.trim()}` : ''].filter(Boolean).join(' | '),
    };
    setOmNewSubSaving(true);
    try {
      if (isDaqqiClientsTab) await handleNewDaqqiClient(draft); else await handleNewCollectionClient(draft);
      setOmNewSubOpen(false);
      omNewSubReset();
    } catch (err: unknown) {
      notify('error', '❌ تعذر تسجيل المشترك: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setOmNewSubSaving(false);
    }
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
  const [omNewSubDraft, setOmNewSubDraft] = useState<NewSubscriberDraft>(blankNewSubscriber);
  const [omNewSubSaving, setOmNewSubSaving] = useState(false);
  const omNewSubReset = () => setOmNewSubDraft(blankNewSubscriber());
  // "تفاصيل" popup for online_clients table
  const [installmentsRow, setInstallmentsRow] = useState<SubscriberItem | null>(null);
  const [collectionSettingsOpen, setCollectionSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const COLL_PAGE_SIZE = layout === 'cards' ? 24 : 100;
  const clientsFilters = {
    view: collOnlineViewTab, q: collOnlineSearch, from: collOnlineDateFrom, to: collOnlineDateTo, course: collOnlineCourseFilter,
    collector: collOnlineCollectionFilter, status: collOnlineStatusFilter, cert: collOnlineCertFilter, remaining: collOnlineRemainingFilter,
    // The Dokki screen asks for its own physical branch (the schedule's), not a workspace link's.
    follow: collOnlineFollowFilter, branch: isDaqqiClientsTab ? physicalBranch.key : (branchFilter || ''),
    housing: daqqiHousingFilter, round: daqqiRoundFilter, reception: daqqiReceptionFilter,
  };
  const clientsSource = isDaqqiClientsTab ? 'dokki' : 'staff';
  const serverPage = useStaffClientsPage({ enabled: paged, filters: clientsFilters, page: collOnlinePage, pageSize: COLL_PAGE_SIZE, source: clientsSource });
  const serverData = paged ? serverPage.data : null;
  // The rows the person has on screen are the copy a save is compared against (useCrmCoreState.updateSubscriber sends only
  // the fields that changed, so a payment or another desk's edit made meanwhile is kept).
  const { setStaffScopedSubscribers } = useSiteData();
  useEffect(() => {
    if (paged && serverData) setStaffScopedSubscribers([...serverPage.seen.current.values()]);
  }, [paged, serverData, serverPage.seen, setStaffScopedSubscribers]);
  // The screen's own writes, as they reach the page: a row changed or removed shows at once, and the server is asked
  // again. The sections below take these in place of the dashboard's, which reload the whole list.
  // Only the paged screen holds rows of its own to patch; the others read the context's list, which the writes update.
  const setSalesOwnSubscribers: React.Dispatch<React.SetStateAction<SubscriberItem[]>> = paged ? serverPage.patchRows : () => undefined;
  const reloadSubscribers = paged ? async () => { await serverPage.reload(); } : reloadSubscribersProp;
  const updateSubscriber = paged ? async (row: SubscriberItem) => {
    const ok = await updateSubscriberProp(row);
    if (ok) serverPage.patchRows(rows => rows.map(existing => (existing.id === row.id ? row : existing)));
    return ok;
  } : updateSubscriberProp;
  const deleteSubscriber = paged ? async (id: string) => {
    const ok = await deleteSubscriberProp(id);
    if (ok) serverPage.patchRows(rows => rows.filter(existing => existing.id !== id));
    return ok;
  } : deleteSubscriberProp;
  // Every page of the matching clients, for the export (the table shows one).
  const loadMatchingForExport = async (only: Partial<typeof clientsFilters> = {}): Promise<SubscriberItem[]> => {
    const rows: SubscriberItem[] = [];
    for (let page = 1; ; page += 1) {
      const part = await staffClientsPageOf(clientsSource, staffClientsQuery({ ...clientsFilters, ...only }, page, 500, clientsSource));
      rows.push(...(part.rows as unknown as SubscriberItem[]));
      if (part.rows.length === 0 || rows.length >= part.total) return rows;
    }
  };
  // The tab or the filters left the page past the last one (a client deleted, a search narrowed): back to the last.
  const serverPages = serverData ? Math.max(1, Math.ceil(serverData.total / COLL_PAGE_SIZE)) : 1;
  useEffect(() => {
    if (paged && serverData && collOnlinePage > serverPages) setCollOnlinePage(serverPages);
  }, [paged, serverData, collOnlinePage, serverPages]);

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
              // Housing is per COURSE (daqqi/daqqiHousingNeeds.ts): a client seated in one course's
              // round still needs the others they hold. The map above keeps the one round the
              // client follows (the reception); this says which of their courses are seated.
              const housingNeeds = new Map<string, HousingNeed>();
              // For the rows on screen. Which clients the housing and round filters keep, the booking-year tabs and
              // their counts are the server's (api/lib/staffClientsView.js, buildView with `dokki`).
              if (isDaqqiClientsTab) {
                for (const subscriber of serverData?.rows ?? []) housingNeeds.set(subscriber.id, housingNeedOf(salesOwnDaqqiRounds ?? [], bundles, subscriber));
              }
              const isIntlSub = isInternationalSubscriber;
              // The context's list: the administration's online screen holds it; a screen that pages from the server holds none.
              // No list of clients is held here: both screens page from the server (useStaffClientsPage).
              const masterList: SubscriberItem[] = [];
              const shouldUseScopedSubscribers = paged;
              const actionSubscribers = [...serverPage.seen.current.values()];
              const branchScopedMasterList = branchFilter
                ? masterList.filter(s => branchMatchesFilter(s.branch, branchFilter))
                : masterList;
              // عملاء الدقي is the Daqqi desk and stays Daqqi-only; the online
              // screen holds online clients only — محلي، سعودي، دولي. It used to
              // list every branch, so Dokki and Tagamoa clients sat in it, and
              // «إجمالي العملاء» (1491) was more than its own three markets
              // added up to (1477).
              // A client split between branches (a course placed in another — lib/coursePlacement.ts) belongs to
              // both: a branch lists the clients it owns and the ones with a course placed in it.
              const isDokkiHere: BranchTest = branch => normBranchId(branch) === physicalBranch.key;
              const isOnlineHere: BranchTest = branch => !['DAQQI', 'TAGAMOA'].includes(normBranchId(branch) || '');
              const hereTest = isDaqqiClientsTab ? isDokkiHere : isOnlineHere;
              const allCombined = isSalesStaff ? branchScopedMasterList : branchScopedMasterList.filter(s => holdsIn(s, isOnlineHere));
              const hasBooking = (s: SubscriberItem) => (s.paymentHistory || [])
                .some(payment => Boolean(payment.courseId || payment.bundleId) && payment.status !== 'refunded' && payment.status !== 'failed');
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
                collOnlineViewTab === 'old_local' ? allCombined.filter(s => !isIntlSub(s)) :
                collOnlineViewTab === 'old_intl'  ? allCombined.filter(isIntlSub) :
                // The collOnlineSubTab branches that used to sit here (local /
                // intl / mine) were unreachable: nothing in the UI ever called
                // its setter, so the value stayed 'all' and only this last arm
                // could run. collOnlineViewTab above is the control that is
                // actually wired to the tab strip.
                allCombined;
              const matchesFilters = (s: SubscriberItem, withFollow: boolean): boolean => {
                // View tab filter — use clientStatus field (set by convert button)
                const clientSt = s.clientStatus || '';
                if (collOnlineViewTab === 'active') {
                  if (s.isActive === false) return false;
                  if (['finished','paused','refunded','refund_pending'].includes(clientSt)) return false;
                  // what is older has its own tab: at Dokki before 2024, online محلي قديم / سعودي قديم
                  if (['old_data', 'daqqi_old_local', 'daqqi_old_intl', ...(isDaqqiClientsTab ? [] : ['old_local', 'old_intl'])].includes(clientSt)) return false;
                } else if (viewMarket) {
                  // فعلي = active + has at least one enrolled course
                  if (s.isActive === false) return false;
                  if (['finished','paused','refunded','refund_pending'].includes(clientSt)) return false;
                  // A booking still waiting for the accounts' approval opens no
                  // course yet, and the client it made vanished from the tab.
                  if ((s.enrolledCourseIds||[]).length === 0 && !hasBooking(s)) return false;
                } else {
                  if (collOnlineViewTab === 'refunded') {
                    if (clientSt !== 'refunded' && clientSt !== 'refund_pending') return false;
                  } else {
                    if (clientSt !== collOnlineViewTab) return false;
                  }
                }
                // The same search as every other list (lib/clientSearch.ts) — the code included.
                if (!matchesSearch(collOnlineSearch, { name: s.name, phone: s.phone, email: s.email, code: s.clientCode, nationalId: s.nationalId })) return false;
                if (collOnlineDateFrom && cairoDay(s.createdAt) < collOnlineDateFrom) return false;
                if (collOnlineDateTo   && cairoDay(s.createdAt) > collOnlineDateTo)   return false;
                // A course or a track the client holds. A track never appears in
                // enrolledCourseIds, so choosing one showed nobody.
                if (collOnlineCourseFilter && !holdsItem(s, collOnlineCourseFilter)) return false;
                // فلتر مسئول التحصيل
                // «بدون مسئول تحصيل»: the clients nobody collects from yet.
                if (collOnlineCollectionFilter === NO_COLLECTOR) { if (s.assignedCsId) return false; }
                else if (collOnlineCollectionFilter && s.assignedCsId !== collOnlineCollectionFilter) return false;
                if (collOnlineStatusFilter && (s.status || 'active') !== collOnlineStatusFilter) return false;
                // فلتر الشهادات
                if (collOnlineCertFilter === 'has_cert' && (s.certificates||[]).length === 0) return false;
                if (collOnlineCertFilter === 'no_cert' && (s.certificates||[]).length > 0) return false;
                if (collOnlineRemainingFilter === 'has_remaining' && balanceOf(s).remainingEgp <= 0) return false;
                if (collOnlineRemainingFilter === 'paid' && !isFullyPaid(balanceOf(s))) return false;
                if (withFollow && !matchesFollowFilter(followUpOf(s), collOnlineFollowFilter)) return false;
                return true;
              };
              const filtered = tabFiltered.filter(s => matchesFilters(s, true));
              // The old-data distribution panel's: how many of the matching clients nobody holds.
              const unassignedMatching = paged ? serverData?.unassignedMatching ?? 0 : filtered.filter(s => !s.assignedCsId).length;
              // The counts above the table: everything the other filters let through, split by when it is due.
              const followCounts = serverData?.followCounts ?? { overdue: 0, today: 0, tomorrow: 0 };
              if (!paged) for (const s of tabFiltered) {
                if (!matchesFilters(s, false)) continue;
                const status = followUpOf(s).status;
                if (status === 'overdue' || status === 'today' || status === 'tomorrow') followCounts[status] += 1;
              }
              const todayOnlineStr = cairoDateOnly();
              // Collection financial stats
              const thisWeekStart = cairoWeekStart();
              const calcPaidEGP = calcSubscribersPaidEGP;
              const figures = serverData?.figures;
              const collTodayRev  = paged ? figures?.today ?? 0 : calcPaidEGP(allCombined, todayOnlineStr, todayOnlineStr);
              const collWeekRev   = paged ? figures?.week ?? 0 : calcPaidEGP(allCombined, thisWeekStart);
              const collMonthRev  = paged ? figures?.month ?? 0 : calcPaidEGP(allCombined, cairoMonthOnly()+'-01');
              const collTotalRem  = paged ? figures?.remaining ?? 0 : allCombined.reduce((sum, s) => sum + balanceOf(s).remainingEgp, 0);
              const fmtK = formatCompactNumber;
              const matchingCount = paged ? serverData?.total ?? 0 : filtered.length;
              const totalPages = paged ? serverPages : Math.max(1, Math.ceil(filtered.length / COLL_PAGE_SIZE));
              const safePage = Math.min(collOnlinePage, totalPages);
              const pageRows = paged ? serverData?.rows ?? [] : filtered.slice((safePage - 1) * COLL_PAGE_SIZE, safePage * COLL_PAGE_SIZE);
              const toggleCol = (col: string) => setCollOnlineVisibleCols(prev => ({ ...prev, [col]: !prev[col] }));
              const vc = collOnlineVisibleCols;
              const cw = collOnlineColWidths;
              const startColResize = (col: string, e: React.MouseEvent) => {
                e.preventDefault();
                const th = (e.currentTarget as HTMLElement).closest('th') as HTMLTableCellElement;
                collOnlineResizing.current = { col, startX: e.clientX, startW: th.offsetWidth };
                const onMove = (me: MouseEvent) => {
                  const drag = collOnlineResizing.current;
                  if (!drag) return;
                  const newW = Math.max(48, drag.startW + (me.clientX - drag.startX));
                  // The width is taken from `drag` now: the state updater below runs later,
                  // after the mouse may already be up and the ref cleared («reading 'col'»).
                  setCollOnlineColWidths(prev => {
                    const next = { ...prev, [drag.col]: newW };
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
                    counts={paged ? figures : undefined}
                  />

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
                    marketOf={s => (isOnlineClient(s) ? subscriberMarket(s) : null)}
                    collOnlineViewTab={collOnlineViewTab}
                    setCollOnlineViewTab={setCollOnlineViewTab}
                    setCollOnlinePage={setCollOnlinePage}
                    filtered={filtered}
                    tabCounts={paged ? serverData?.tabCounts ?? {} : undefined}
                    matchingCount={paged ? matchingCount : undefined}
                    unassignedTotal={paged ? figures?.unassigned ?? 0 : undefined}
                    loadForExport={paged ? () => loadMatchingForExport() : undefined}
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
                    collOnlineStatusFilter={collOnlineStatusFilter}
                    setCollOnlineStatusFilter={setCollOnlineStatusFilter}
                    collOnlineFollowFilter={collOnlineFollowFilter}
                    setCollOnlineFollowFilter={setCollOnlineFollowFilter}
                    followCounts={followCounts}
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
                    viewToggle={(
                      <div className="flex items-center gap-0.5 rounded-xl bg-gray-100 p-0.5" role="group" aria-label="طريقة العرض">
                        {([['cards', 'بطاقات', LayoutGrid], ['table', 'جدول', Table2]] as const).map(([key, label, Icon]) => (
                          <button key={key} type="button" aria-pressed={layout === key} onClick={() => setLayout(key)}
                            className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition ${layout === key ? 'bg-slate-800 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'}`}>
                            <Icon size={13} /> {label}
                          </button>
                        ))}
                      </div>
                    )}
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
                  {/* ── Distribution panel for محلي قديم / سعودي قديم ── */}
                  {((collOnlineViewTab === 'old_local' || collOnlineViewTab === 'old_intl') || (collOnlineViewTab === 'old_data' && isDaqqiClientsTab)) && (isAdmin || isDaqqiManager) && (isAdmin || isDaqqiClientsTab) && (
                    <div className="mb-4 bg-gradient-to-l from-indigo-50 to-violet-50 border border-indigo-200 rounded-2xl p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="text-base">📊</span>
                        <h4 className="font-extrabold text-indigo-800 text-sm">{isDaqqiClientsTab ? `توزيع العملاء على فريق ${physicalBranch.label}` : 'توزيع العملاء على مسئولي التحصيل'}</h4>
                        <span className="text-xs text-indigo-500">({unassignedMatching} غير موزع من أصل {matchingCount})</span>
                      </div>
                      <div className="space-y-2">
                        {daqqiOldDistribPlan.map((entry, idx) => {
                          const csMembers = isDaqqiClientsTab
                              ? staffMembers.filter(s => (physicalBranch.key === 'TAGAMOA'
                                ? s.role === 'tagamoa_manager' || s.role === 'reception_tagamoa'
                                : s.role === 'daqqi_manager' || s.role === 'reception_daqqi'))
                              : staffMembers.filter(s => (s.role||'').toLowerCase() === 'collection');
                          return (
                            <div key={idx} className="flex items-center gap-2 flex-wrap">
                              <select value={entry.staffId} onChange={e => setDaqqiOldDistribPlan(prev => prev.map((p,i) => i===idx ? {...p,staffId:e.target.value} : p))}
                                className="border border-indigo-200 rounded-xl px-3 py-1.5 text-xs bg-white focus:ring-2 focus:ring-indigo-200 focus:outline-none min-w-[160px]">
                                <option value="">{isDaqqiClientsTab ? `— اختر من فريق ${physicalBranch.label} —` : '— اختر مسئول تحصيل —'}</option>
                                {csMembers.map(s => <option key={s.id} value={s.id}>{s.name} ({serverData?.assignedCounts?.[s.id] ?? 0} موزع)</option>)}
                              </select>
                              <input type="number" min="1" max={unassignedMatching} placeholder="عدد العملاء"
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
                              let offset = 0; let totalDone = 0; let totalFailed = 0;
                              setDaqqiOldDistributing(true);
                              try {
                                // The matching clients nobody holds: on the server's pages, the ones the person's filters keep.
                                const unassigned = paged ? await loadMatchingForExport({ collector: NO_COLLECTOR }) : filtered.filter(s => !s.assignedCsId);
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
                                    : `✅ تم توزيع ${totalDone} عميل على ${isDaqqiClientsTab ? `فريق ${physicalBranch.label}` : 'مسئولي التحصيل'}`
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
                  {paged && !serverData ? (
                    <p className="py-10 text-center text-sm text-gray-500" role="status">
                      {serverPage.failed ? <>تعذر تحميل العملاء. <button type="button" onClick={() => { void serverPage.reload(); }} className="font-bold text-teal-700 underline">إعادة المحاولة</button></> : 'جاري تحميل العملاء…'}
                    </p>
                  ) : (
                  <div className={paged && serverPage.loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
                  <ClientsTable
                    layout={layout}
                    itemVisible={(client, item) => itemShowsIn(client, item, hereTest)}
                    canDeleteSubscriber={canDeleteSubscriber}
                    pageRows={pageRows}
                    vc={vc}
                    cw={cw}
                    startColResize={startColResize}
                    isDaqqiClientsTab={isDaqqiClientsTab}
                    collOnlineSelected={collOnlineSelected}
                    setCollOnlineSelected={setCollOnlineSelected}
                    housingMap={housingMap}
                    housingNeeds={housingNeeds}
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
                    filteredLength={matchingCount}
                    notify={notify}
                  />
                  </div>
                  )}
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
                      notify={notify}
                      onClose={() => setDaqqiHousingModal(null)}
                    />
                  )}

                  {/* ===== مشترك جديد popup ===== */}
                  {omNewSubOpen && (
                    <NewSubscriberModal
                      variant={isCollectionStaff || isDaqqiClientsTab ? 'booking' : 'account'}
                      branchLabel={isDaqqiClientsTab ? physicalBranch.label : 'أونلاين'}
                      draft={omNewSubDraft}
                      setDraft={setOmNewSubDraft}
                      courses={courses}
                      bundles={bundles}
                      paymentBoxes={paymentBoxes}
                      saving={omNewSubSaving}
                      lockPrice={isCollectionStaff && !isDaqqiClientsTab}
                      onSubmit={() => { void (isCollectionStaff || isDaqqiClientsTab ? submitNewBooking() : submitNewAccount()); }}
                      onClose={() => { setOmNewSubOpen(false); omNewSubReset(); }}
                    />
                  )}

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
                      notify={notify}
                      onPlacementsChanged={reloadSubscribers}
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
                                        ...(convertType === 'daqqi' ? { branch: physicalBranch.key } : {}),
                                      };
                                      if (!await updateSubscriber(updated)) throw new Error('فشل حفظ حالة العميل');
                                      setSalesOwnSubscribers(prev => prev.map(s => s.id === updated.id ? updated : s));
                                       setConvertRow(null);
                                       const typeLabel = convertType === 'active' ? 'نشط' : convertType === 'finished' ? 'منتهي' : convertType === 'paused' ? 'متوقف' : `فرع ${physicalBranch.label}`;
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
                      subscribers={[]}
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
