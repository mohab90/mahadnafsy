import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Calendar, Download, ExternalLink, Eye, MessageSquareText,
  Phone, Plus, Receipt, RefreshCw, Search, Trash2, Users, Wallet, X,
} from 'lucide-react';
import type {
  BranchType, Bundle, CommunicationRecord, Course,
  DaqqiRound, DaqqiRoundAttendee, LeadItem, LeadStatus,
  PaymentHistoryEntry, StaffMember, SubscriberItem,
} from '../../../types';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { SUB_STATUS_CFG, normBranchId, type SubStatus } from '../dashboardShared';
import { type PaymentDraft, blankPaymentDraft } from '../../../components/PaymentModal';
import AddSubscriberModal from '../../../components/AddSubscriberModal';
import OnlineSubscriberModal from '../../../components/OnlineSubscriberModal';

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
  setSubInstRow: (row: SubscriberItem | null) => void;
  setSubInstDraft: React.Dispatch<React.SetStateAction<SubInstDraft>>;
  setSubWaRow: (row: SubscriberItem | null) => void;
}

export default function OnlineClientsTab({
  activeTab, subscribers, salesOwnSubscribers, setSalesOwnSubscribers,
  courses, bundles, staffMembers, content, salesOwnDaqqiRounds, setSalesOwnDaqqiRounds,
  salesOwnLeads, updateSubscriber, addSubscriber, addLead, deleteSubscriber, notify,
  isDaqqiManager, isReceptionDaqqi, isAdmin, isOnlineManager, isNonAdminStaff, currentStaff,
  staffSelf, onlineTeamMembers, subCsDistributing, setSubCsDistributing,
  daqqiOldDistribPlan, setDaqqiOldDistribPlan, daqqiOldDistributing, setDaqqiOldDistributing,
  setSubPayRow, setSubPayDraft, setSubContactRow, setSubContactDraft,
  setSubInstRow, setSubInstDraft, setSubWaRow,
}: Props) {
  const navigate = useNavigate();
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
  const [daqqiOldDataParsed, setDaqqiOldDataParsed] = useState<{_id:string;_name:string;_phone:string;_email:string;_notes:string;_course:string;_paid:string;_expected:string;_cert:string;_attendance:string}[]>([]);
  const [daqqiOldDataSelected, setDaqqiOldDataSelected] = useState<Set<string>>(new Set());
  const [daqqiOldDataImporting, setDaqqiOldDataImporting] = useState(false);
  const [daqqiOldDataResult, setDaqqiOldDataResult] = useState<{created:number;dupes:number;errors:number}|null>(null);
  const [daqqiOldDataSource, setDaqqiOldDataSource] = useState('داتا قديمة دقي');
  // Online old data import state
  const [onlineOldDataSource, setOnlineOldDataSource] = useState('داتا قديمة أونلاين');
  const [onlineOldDataParsed, setOnlineOldDataParsed] = useState<{_id:string;_name:string;_phone:string;_email:string;_notes:string;_course:string;_paid:string;_expected:string;_cert:string;_attendance:string}[]>([]);
  const [onlineOldDataSelected, setOnlineOldDataSelected] = useState<Set<string>>(new Set());
  const [onlineOldDataImporting, setOnlineOldDataImporting] = useState(false);
  const [onlineOldDataResult, setOnlineOldDataResult] = useState<{created:number;dupes:number;errors:number}|null>(null);
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
              const in3daysOnlineStr = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
              const currFmt = (c: string) => c === 'SAR' ? 'ر.س' : c === 'USD' ? '$' : 'ج.م';
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
                  {/* Collection KPI row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2 mb-4">
                    {(isDaqqiClientsTab ? [
                      { label: 'إجمالي عملاء الدقي', value: allCombined.length,                  color: 'bg-indigo-50 text-indigo-700 border-indigo-200', icon: '🏢' },
                      { label: 'نشطين',               value: allCombined.filter(s=>!['finished','paused','refunded','refund_pending'].includes(s.clientStatus||'')).length, color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: '✅' },
                      { label: 'منتهين',              value: allCombined.filter(s=>s.clientStatus==='finished').length, color: 'bg-green-50 text-green-700 border-green-200', icon: '🎓' },
                      { label: 'متوقفين',             value: allCombined.filter(s=>s.clientStatus==='paused').length,   color: 'bg-amber-50 text-amber-700 border-amber-200',  icon: '⏸️' },
                      { label: 'تحصيل اليوم',         value: `${fmtK(collTodayRev)} ج`, color: 'bg-sky-50 text-sky-700 border-sky-200', icon: '📅' },
                      { label: 'تحصيل الأسبوع',      value: `${fmtK(collWeekRev)} ج`,  color: 'bg-blue-50 text-blue-700 border-blue-200', icon: '📆' },
                      { label: 'تحصيل الشهر',        value: `${fmtK(collMonthRev)} ج`, color: 'bg-violet-50 text-violet-700 border-violet-200', icon: '💰' },
                      { label: 'متبقي في الشيت',     value: `${fmtK(collTotalRem)} ج`, color: 'bg-red-50 text-red-700 border-red-200', icon: '⏳' },
                    ] : [
                      { label: 'إجمالي العملاء',  value: allCombined.length,                     color: 'bg-slate-50 text-slate-700 border-slate-200',    icon: '👥' },
                      { label: 'عملاء محلي',       value: allCombined.filter(s=>!isIntlSub(s)).length, color: 'bg-purple-50 text-purple-700 border-purple-200', icon: '🇪🇬' },
                      { label: 'عملاء دولي',       value: allCombined.filter(isIntlSub).length, color: 'bg-cyan-50 text-cyan-700 border-cyan-200', icon: '🌍' },
                      { label: 'عملائي',           value: mineSubsAll.length,                     color: 'bg-amber-50 text-amber-700 border-amber-200',    icon: '⭐' },
                      { label: 'تحصيل اليوم',      value: `${fmtK(collTodayRev)} ج`, color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: '📅' },
                      { label: 'تحصيل الأسبوع',   value: `${fmtK(collWeekRev)} ج`,  color: 'bg-green-50 text-green-700 border-green-200',     icon: '📆' },
                      { label: 'تحصيل الشهر',     value: `${fmtK(collMonthRev)} ج`, color: 'bg-blue-50 text-blue-700 border-blue-200',       icon: '💰' },
                      { label: 'متبقي في الشيت',  value: `${fmtK(collTotalRem)} ج`, color: 'bg-red-50 text-red-700 border-red-200',          icon: '⏳' },
                    ]).map(stat => (
                      <div key={stat.label} className={`border rounded-xl px-2 py-2 text-center ${stat.color}`}>
                        <div className="text-xs mb-0.5">{stat.icon}</div>
                        <div className="text-lg font-extrabold leading-tight">{stat.value}</div>
                        <div className="text-[10px] mt-0.5 font-medium leading-tight">{stat.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* === Tabs row === */}
                  <div className="mb-3 border border-gray-200 rounded-2xl bg-gray-50 p-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {([
                        { key: 'active'          as const, label: 'الكل',               color: 'blue'   },
                        { key: 'real-local'       as const, label: '🇪🇬 فعلي محلي',       color: 'teal'   },
                        { key: 'real-intl'        as const, label: '🌍 فعلي دولي',        color: 'cyan'   },
                        { key: 'finished'         as const, label: 'المنتهين',           color: 'green'  },
                        { key: 'paused'           as const, label: 'المتوقفين',          color: 'amber'  },
                        { key: 'refunded'         as const, label: 'المستردين',          color: 'red'    },
                        ...(isDaqqiClientsTab ? [
                          { key: 'old_data'  as const, label: '📥 استيراد',      color: 'slate'  },
                        ] : [
                          { key: 'old_local' as const, label: '🏠 محلي قديم',   color: 'indigo' },
                          { key: 'old_intl'  as const, label: '🌐 دولي قديم',   color: 'violet' },
                        ]),
                      ] as {key:'active'|'real-local'|'real-intl'|'finished'|'paused'|'refunded'|'old_data'|'old_local'|'old_intl';label:string;color:string}[]).filter(vt => !isDaqqiClientsTab || (vt.key !== 'real-local' && vt.key !== 'real-intl')).map(vt => {
                        const base = vt.key === 'real-local' ? allCombined.filter(s => !isIntlSub(s)) : vt.key === 'real-intl' ? allCombined.filter(isIntlSub) : vt.key === 'old_local' ? allCombined.filter(s => !isIntlSub(s)) : vt.key === 'old_intl' ? allCombined.filter(isIntlSub) : allCombined;
                        const cnt = vt.key === 'active'
                          ? allCombined.filter(s => !['finished','paused','refunded','refund_pending'].includes(s.clientStatus||'')).length
                          : (vt.key === 'real-local' || vt.key === 'real-intl')
                          ? base.filter(s => !['finished','paused','refunded','refund_pending'].includes(s.clientStatus||'') && (s.enrolledCourseIds||[]).length > 0).length
                          : vt.key === 'old_data' ? allCombined.filter(s => ['old_data','daqqi_old_local','daqqi_old_intl'].includes(s.clientStatus||'')).length
                          : (vt.key === 'old_local' || vt.key === 'old_intl') ? base.filter(s => s.clientStatus === vt.key).length
                          : vt.key === 'refunded' ? allCombined.filter(s => s.clientStatus === 'refunded' || s.clientStatus === 'refund_pending').length
                          : allCombined.filter(s => s.clientStatus === vt.key).length;
                        const active = collOnlineViewTab === vt.key;
                        const colorMap: Record<string,string> = {
                          blue:   active ? 'bg-blue-600 text-white border-blue-600'    : 'border-blue-200 text-blue-700 hover:bg-blue-100',
                          teal:   active ? 'bg-teal-600 text-white border-teal-600'    : 'border-teal-200 text-teal-700 hover:bg-teal-100',
                          cyan:   active ? 'bg-cyan-600 text-white border-cyan-600'    : 'border-cyan-200 text-cyan-700 hover:bg-cyan-100',
                          green:  active ? 'bg-green-600 text-white border-green-600'  : 'border-green-200 text-green-700 hover:bg-green-100',
                          amber:  active ? 'bg-amber-500 text-white border-amber-500'  : 'border-amber-200 text-amber-700 hover:bg-amber-100',
                          red:    active ? 'bg-red-600 text-white border-red-600'      : 'border-red-200 text-red-700 hover:bg-red-100',
                          purple: active ? 'bg-purple-600 text-white border-purple-600': 'border-purple-200 text-purple-700 hover:bg-purple-100',
                          slate:  active ? 'bg-slate-600 text-white border-slate-600'  : 'border-slate-200 text-slate-700 hover:bg-slate-100',
                          indigo: active ? 'bg-indigo-600 text-white border-indigo-600': 'border-indigo-200 text-indigo-700 hover:bg-indigo-100',
                          violet: active ? 'bg-violet-600 text-white border-violet-600': 'border-violet-200 text-violet-700 hover:bg-violet-100',
                        };
                        return (
                          <button key={vt.key} onClick={() => { setCollOnlineViewTab(vt.key); setCollOnlinePage(1); }}
                            className={`border rounded-xl px-3 py-1.5 text-xs font-bold transition flex items-center gap-1.5 ${colorMap[vt.color]}`}>
                          {vt.label} <span className={`inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] rounded-full text-[10px] font-extrabold ${active?'bg-white/30':'bg-gray-200 text-gray-600'}`}>{cnt}</span>
                          </button>
                        );
                      })}
                      <span className="flex-1"/>
                      <span className="text-[10px] text-gray-400">{filtered.length} مطابق</span>
                      {(isOnlineManager || isDaqqiManager || isAdmin) && (
                        <button onClick={() => setOmNewSubOpen(true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition shadow-sm">
                          <Plus size={12} /> مشترك جديد
                        </button>
                      )}
                      {isDaqqiClientsTab && (
                        <div className="relative">
                          <button onClick={() => setDaqqiSettingsOpen(p => !p)}
                            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-xl text-xs font-bold transition">
                            ⚙️ الإعدادات
                          </button>
                          {daqqiSettingsOpen && (
                            <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-30 min-w-[160px] py-1">
                              <button onClick={() => {
                                const toExport = collOnlineSelected.size > 0 ? filtered.filter(s => collOnlineSelected.has(s.id)) : filtered;
                                const toEGP = (p: {amount?:number|string;currency?:string}) => { const n=Number(p.amount)||0; return p.currency==='SAR'?n*13:p.currency==='USD'?n*50:n; };
                                const header = 'الاسم,الهاتف,الإيميل,الفرع,الكورسات,الحالة,المدفوع (ج.م),المتبقي (ج.م),الروند,الرسيبشن,تاريخ الاشتراك,الكود\n';
                                const rows = toExport.map(s => {
                                  const paid = (s.paymentHistory||[]).reduce((a,p)=>a+toEGP(p),0);
                                  const total = Number(s.totalValue)||0;
                                  const crs = (s.enrolledCourseIds||[]).map(id=>courses.find(c=>c.id===id)?.title||bundles.find(b=>`bundle:${b.id}`===id)?.title||id).join(' | ');
                                  const hInfo = housingMap.get(s.id);
                                  return [s.name,s.phone,s.email,s.branch||'',crs,s.clientStatus||s.status||'',paid,Math.max(0,total-paid),hInfo?.roundCode||'',hInfo?.receptionName||'',(s.createdAt||'').slice(0,10),s.clientCode||''].map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',');
                                }).join('\n');
                                const blob = new Blob(['\uFEFF'+header+rows],{type:'text/csv;charset=utf-8;'});
                                const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`daqqi-clients-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(a.href);
                                setDaqqiSettingsOpen(false);
                              }} className="w-full text-right px-4 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                                <Download size={12}/> تصدير CSV
                              </button>
                              <button onClick={() => { setCollOnlineViewTab('old_data'); setDaqqiSettingsOpen(false); }}
                                className="w-full text-right px-4 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                                📂 استيراد داتا قديمة
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      {(!isDaqqiClientsTab && (isOnlineManager || isAdmin)) && (
                        <button
                          disabled={subCsDistributing}
                          onClick={async () => {
                            const unassigned = (isAdmin ? subscribers : salesOwnSubscribers).filter(s => !s.assignedCsId);
                            if (!confirm(`توزيع ${unassigned.length} مشترك غير مُسند على موظفي التحصيل؟`)) return;
                            setSubCsDistributing(true);
                            try {
                              const result = await mysqlAdmin.bulkAssignCollection() as any;
                              notify('success', `\u2705 تم توزيع ${result.assigned} مشترك على ${result.staffCount} موظف`);
                              const fresh = (await mysqlAdmin.listAllSubscribers()) as unknown as SubscriberItem[];
                              fresh.forEach(s => updateSubscriber(s));
                            } catch (e: any) {
                              notify('error', `\u274c فشل التوزيع: ${e.message}`);
                            } finally { setSubCsDistributing(false); }
                          }}
                          className="relative flex items-center justify-center w-7 h-7 border border-teal-300 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-lg transition disabled:opacity-60"
                          title={`توزيع غير المُسندين (${allCombined.filter(s => !s.assignedCsId).length})`}>
                          {subCsDistributing ? <span className="w-3 h-3 border-2 border-teal-400 border-t-teal-700 rounded-full animate-spin"/> : <Users size={13}/>}
                          {allCombined.filter(s => !s.assignedCsId).length > 0 && !subCsDistributing && (
                            <span className="absolute -top-1.5 -right-1.5 min-w-[1rem] h-4 bg-teal-600 text-white text-[9px] font-extrabold rounded-full flex items-center justify-center px-0.5">{allCombined.filter(s => !s.assignedCsId).length}</span>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Filters row */}
                  <div className="flex flex-wrap gap-2 mb-3 items-center">
                    <div className="relative min-w-0 w-[120px]">
                      <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input value={collOnlineSearch} onChange={e=>{setCollOnlineSearch(e.target.value);setCollOnlinePage(1);}}
                        placeholder="بحث اسم / هاتف..."
                        className="w-full border border-gray-200 rounded-lg pr-7 pl-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-teal-200" />
                    </div>
                    {isDaqqiClientsTab && (
                      <>
                        <select value={daqqiHousingFilter} onChange={e=>{setDaqqiHousingFilter(e.target.value as 'all'|'housed'|'unhoused');setCollOnlinePage(1);}}
                          className="border border-indigo-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none">
                          <option value="all">كل التسكين</option>
                          <option value="housed">مسكنين ✅</option>
                          <option value="unhoused">غير مسكنين ❌</option>
                        </select>
                        <select value={daqqiRoundFilter} onChange={e=>{setDaqqiRoundFilter(e.target.value);setCollOnlinePage(1);}}
                          className="border border-indigo-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none max-w-[180px]">
                          <option value="">كل الروندات</option>
                          {(salesOwnDaqqiRounds ?? []).map((r: DaqqiRound) => (
                            <option key={r.id} value={r.id}>{r.code} — {r.receptionName}</option>
                          ))}
                        </select>
                        {/* فلتر رسيبشن الدقي */}
                        {(() => {
                          const uniqueReceptions = Array.from(
                            new Map([...housingMap.values()].map(h => [h.receptionId, { id: h.receptionId, name: h.receptionName }])).values()
                          );
                          return uniqueReceptions.length > 0 ? (
                            <select value={daqqiReceptionFilter} onChange={e=>{setDaqqiReceptionFilter(e.target.value);setCollOnlinePage(1);}}
                              className="border border-indigo-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none max-w-[160px]">
                              <option value="">كل الريسبشن</option>
                              {uniqueReceptions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                            </select>
                          ) : null;
                        })()}
                      </>
                    )}
                    <select value={collOnlineStatusFilter} onChange={e=>{setCollOnlineStatusFilter(e.target.value);setCollOnlinePage(1);}}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none">
                      <option value="">كل الحالات</option>
                      <option value="active">نشط</option>
                      <option value="active_new">نشط جديد</option>
                      <option value="active_paid">مكتمل الدفع</option>
                      <option value="active_late">متأخر</option>
                      <option value="paused">موقوف</option>
                      <option value="blocked">محظور</option>
                    </select>
                    <select value={collOnlineRemainingFilter} onChange={e=>{setCollOnlineRemainingFilter(e.target.value as 'all'|'has_remaining'|'paid');setCollOnlinePage(1);}}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none">
                      <option value="all">كل المدفوعات</option>
                      <option value="has_remaining">لديه متبقي</option>
                      <option value="paid">مكتمل الدفع</option>
                    </select>
                    {/* فلتر مسئول التحصيل — للأونلاين فقط */}
                    {!isDaqqiClientsTab && (
                      <select value={collOnlineCollectionFilter} onChange={e=>{setCollOnlineCollectionFilter(e.target.value);setCollOnlinePage(1);}}
                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none max-w-[150px]">
                        <option value="">كل مسئولي التحصيل</option>
                        {(isOnlineManager ? onlineTeamMembers : isAdmin ? staffMembers : staffMembers).filter(s => (s.role||'').toLowerCase() === 'collection').map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    )}
                    {/* فلتر الشهادات */}
                    <select value={collOnlineCertFilter} onChange={e=>{setCollOnlineCertFilter(e.target.value as 'all'|'has_cert'|'no_cert');setCollOnlinePage(1);}}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none">
                      <option value="all">كل الشهادات</option>
                      <option value="has_cert">لديه شهادة</option>
                      <option value="no_cert">بدون شهادة</option>
                    </select>
                    <select value={collOnlineCourseFilter} onChange={e=>{setCollOnlineCourseFilter(e.target.value);setCollOnlinePage(1);}}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none max-w-[160px]">
                      <option value="">كل الكورسات</option>
                      {courses.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}
                      {bundles.map(b=><option key={`bundle:${b.id}`} value={`bundle:${b.id}`}>📦 {b.title}</option>)}
                    </select>
                    <input type="date" value={collOnlineDateFrom} onChange={e=>{setCollOnlineDateFrom(e.target.value);setCollOnlinePage(1);}}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none" title="من تاريخ" />
                    <input type="date" value={collOnlineDateTo} onChange={e=>{setCollOnlineDateTo(e.target.value);setCollOnlinePage(1);}}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none" title="إلى تاريخ" />
                    {(collOnlineSearch||collOnlineStatusFilter||collOnlineRemainingFilter!=='all'||collOnlineCourseFilter||collOnlineDateFrom||collOnlineDateTo||collOnlineCollectionFilter||collOnlineCertFilter!=='all'||daqqiHousingFilter!=='all'||daqqiRoundFilter||daqqiReceptionFilter) && (
                      <button onClick={()=>{setCollOnlineSearch('');setCollOnlineStatusFilter('');setCollOnlineRemainingFilter('all');setCollOnlineCourseFilter('');setCollOnlineDateFrom('');setCollOnlineDateTo('');setCollOnlineCollectionFilter('');setCollOnlineCertFilter('all');setDaqqiHousingFilter('all');setDaqqiRoundFilter('');setDaqqiReceptionFilter('');setCollOnlinePage(1);}}
                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-gray-50 text-gray-500 hover:bg-gray-100">مسح الفلاتر</button>
                    )}
                    {/* ── Export CSV (للأونلاين فقط — الدقي في الإعدادات) ── */}
                    {!isDaqqiClientsTab && (
                      <button onClick={() => {
                        const toExport = collOnlineSelected.size > 0 ? filtered.filter(s => collOnlineSelected.has(s.id)) : filtered;
                        const toEGP = (p: {amount?:number|string;currency?:string}) => { const n=Number(p.amount)||0; return p.currency==='SAR'?n*13:p.currency==='USD'?n*50:n; };
                        const header = 'الاسم,الهاتف,الإيميل,الفرع,الكورسات,الحالة,المدفوع (ج.م),المتبقي (ج.م),مسئول التحصيل,تاريخ الاشتراك,الكود\n';
                        const rows = toExport.map(s => {
                          const paid = (s.paymentHistory||[]).reduce((a,p)=>a+toEGP(p),0);
                          const total = Number(s.totalValue)||0;
                          const crs = (s.enrolledCourseIds||[]).map(id=>courses.find(c=>c.id===id)?.title||bundles.find(b=>`bundle:${b.id}`===id)?.title||id).join(' | ');
                          const agent = staffMembers.find(st=>st.id===s.assignedCsId)?.name || '';
                          return [s.name,s.phone,s.email,s.branch||'',crs,s.clientStatus||s.status||'',paid,Math.max(0,total-paid),agent,(s.createdAt||'').slice(0,10),s.clientCode||''].map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',');
                        }).join('\n');
                        const blob = new Blob(['\uFEFF'+header+rows],{type:'text/csv;charset=utf-8;'});
                        const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`online-clients-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(a.href);
                      }} className="flex items-center gap-1.5 border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition" title={collOnlineSelected.size>0?`تصدير ${collOnlineSelected.size} محدد`:'تصدير كل النتائج'}>
                        <Download size={13}/> {collOnlineSelected.size>0?`تصدير (${collOnlineSelected.size})`:'تصدير CSV'}
                      </button>
                    )}
                  </div>

                  {/* Column visibility toggles */}
                  <details className="mb-3 group">
                    <summary className="cursor-pointer text-xs text-gray-500 flex items-center gap-1 select-none w-fit">
                      <Eye size={12} />تحكم في الأعمدة <span className="text-gray-300 group-open:rotate-180 inline-block transition-transform">▼</span>
                    </summary>
                    <div className="flex flex-wrap gap-2 mt-2 pr-1">
                      {([
                        ['courses','الكورسات'],['value','القيمة'],['paid','المدفوع'],['remaining','المتبقي'],
                        ['installments','الأقساط'],['status','الحالة'],['sales','المسئول'],['followup','موعد المتابعة'],
                        ['contact','ملاحظات التواصل'],['createdAt','تاريخ الاشتراك'],['certificates','الشهادات'],
                      ] as [string,string][]).map(([col,label]) => (
                        <label key={col} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                          <input type="checkbox" checked={vc[col]!==false} onChange={()=>toggleCol(col)} className="accent-teal-500" />
                          {label}
                        </label>
                      ))}
                    </div>
                  </details>
                  {/* Bulk action bar */}
                  {collOnlineSelected.size > 0 && (
                    <div className="flex flex-wrap items-center gap-2 mb-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2" dir="rtl">
                      <span className="text-xs font-bold text-blue-700">✔ تم تحديد {collOnlineSelected.size} عميل</span>
                      <span className="flex-1"/>
                      <button onClick={() => setCollOnlineBulkConfirm('pause')} className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-bold hover:bg-amber-600 transition">⏸ وقف</button>
                      <button onClick={() => setCollOnlineBulkConfirm('finish')} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700 transition">✅ إنهاء</button>
                      <button onClick={() => setCollOnlineBulkConfirm('refund')} className="px-3 py-1.5 bg-orange-500 text-white rounded-lg text-xs font-bold hover:bg-orange-600 transition">↩ استرداد</button>
                      {isAdmin && <button onClick={() => setCollOnlineBulkConfirm('assign')} className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-bold hover:bg-purple-700 transition">👤 تعيين مسئول</button>}
                      {isAdmin && <button onClick={() => setCollOnlineBulkConfirm('delete')} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold hover:bg-red-700 transition">🗑 حذف</button>}
                      <button onClick={() => {
                        const toExport = filtered.filter(s => collOnlineSelected.has(s.id));
                        const toEGP = (p: {amount?:number|string;currency?:string}) => { const n=Number(p.amount)||0; return p.currency==='SAR'?n*13:p.currency==='USD'?n*50:n; };
                        const header = 'الاسم,الهاتف,الإيميل,الفرع,الكورسات,الحالة,المدفوع (ج.م),المتبقي,الكود\n';
                        const csvRows = toExport.map(s => {
                          const paid = (s.paymentHistory||[]).reduce((a,p)=>a+toEGP(p),0);
                          const crs = (s.enrolledCourseIds||[]).map(id=>courses.find(c=>c.id===id)?.title||id).join(' | ');
                          return [s.name,s.phone,s.email,s.branch||'',crs,s.clientStatus||s.status||'',paid,Math.max(0,(Number(s.totalValue)||0)-paid),s.clientCode||''].map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',');
                        }).join('\n');
                        const blob = new Blob(['\uFEFF'+header+csvRows],{type:'text/csv;charset=utf-8;'});
                        const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`selected-clients-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(a.href);
                      }} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition">📥 تصدير CSV</button>
                      <button onClick={() => setCollOnlineSelected(new Set())} className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-xs font-bold hover:bg-gray-300 transition">✕ إلغاء</button>
                    </div>
                  )}
                  {/* Bulk confirm dialog */}
                  {collOnlineBulkConfirm && (
                    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" dir="rtl">
                      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
                        <div className="text-lg font-bold mb-3 text-gray-800">
                          {collOnlineBulkConfirm === 'delete' ? '🗑 حذف العملاء المحددين'
                            : collOnlineBulkConfirm === 'pause' ? '⏸ وقف العملاء المحددين'
                            : collOnlineBulkConfirm === 'refund' ? '↩ استرداد العملاء المحددين'
                            : collOnlineBulkConfirm === 'assign' ? '👤 تعيين مسئول تحصيل'
                            : '✅ إنهاء العملاء المحددين'}
                        </div>
                        <p className="text-sm text-gray-600 mb-4">
                          {collOnlineBulkConfirm === 'delete'
                            ? `هل أنت متأكد من حذف ${collOnlineSelected.size} عميل؟ هذا الإجراء لا يمكن التراجع عنه.`
                            : collOnlineBulkConfirm === 'assign'
                            ? `اختر مسئول التحصيل الجديد لـ ${collOnlineSelected.size} عميل:`
                            : `هل تريد تغيير حالة ${collOnlineSelected.size} عميل إلى "${collOnlineBulkConfirm === 'pause' ? 'متوقف' : collOnlineBulkConfirm === 'refund' ? 'مسترد' : 'منتهي'}"؟`}
                        </p>
                        {collOnlineBulkConfirm === 'assign' && (
                          <select value={collOnlineBulkAssignTo} onChange={e=>setCollOnlineBulkAssignTo(e.target.value)}
                            className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-purple-300">
                            <option value="">-- اختر مسئول --</option>
                            {staffMembers.filter(s=>(s.role||'').toLowerCase()==='collection').map(s=>(
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        )}
                        <div className="flex gap-3 justify-end">
                          <button onClick={() => { setCollOnlineBulkConfirm(null); setCollOnlineBulkAssignTo(''); }} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200">إلغاء</button>
                          <button onClick={async () => {
                            const ids = [...collOnlineSelected];
                            if (collOnlineBulkConfirm === 'delete') {
                              for (const id of ids) {
                                if (isAdmin) deleteSubscriber(id);
                                else await mysqlAdmin.deleteSubscriber(id).catch(()=>{});
                              }
                              if (!isAdmin) setSalesOwnSubscribers(prev => prev.filter(s => !collOnlineSelected.has(s.id)));
                            } else if (collOnlineBulkConfirm === 'assign') {
                              if (!collOnlineBulkAssignTo) return;
                              for (const id of ids) {
                                const sub = (isAdmin ? subscribers : salesOwnSubscribers).find(s=>s.id===id);
                                if (sub) updateSubscriber({ ...sub, collectionStaffId: collOnlineBulkAssignTo });
                              }
                              if (!isAdmin) setSalesOwnSubscribers(prev=>prev.map(s=>collOnlineSelected.has(s.id)?{...s,collectionStaffId:collOnlineBulkAssignTo}:s));
                            } else {
                              const newStatus = collOnlineBulkConfirm === 'pause' ? 'paused' : collOnlineBulkConfirm === 'refund' ? 'refunded' : 'finished';
                              for (const id of ids) {
                                const sub = (isAdmin ? subscribers : salesOwnSubscribers).find(s=>s.id===id);
                                if (sub) updateSubscriber({ ...sub, clientStatus: newStatus });
                              }
                              if (!isAdmin) setSalesOwnSubscribers(prev=>prev.map(s=>collOnlineSelected.has(s.id)?{...s,clientStatus:newStatus}:s));
                            }
                            setCollOnlineSelected(new Set());
                            setCollOnlineBulkConfirm(null);
                            setCollOnlineBulkAssignTo('');
                            notify('success', `✅ تم تنفيذ الإجراء على ${ids.length} عميل`);
                          }} disabled={collOnlineBulkConfirm==='assign'&&!collOnlineBulkAssignTo}
                            className={`px-4 py-2 text-white rounded-lg text-sm font-bold disabled:opacity-40 ${
                              collOnlineBulkConfirm==='delete'?'bg-red-600 hover:bg-red-700':
                              collOnlineBulkConfirm==='assign'?'bg-purple-600 hover:bg-purple-700':
                              collOnlineBulkConfirm==='refund'?'bg-orange-500 hover:bg-orange-600':
                              'bg-blue-600 hover:bg-blue-700'}`}>تأكيد</button>
                        </div>
                      </div>
                    </div>
                  )}
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
                              let offset = 0; let totalDone = 0;
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
                                      await mysqlAdmin.saveSubscriber({ ...sub, assignedCsId: entry.staffId, assignedCsName: staffMember?.name || '' } as any);
                                      setSalesOwnSubscribers(prev => prev.map(s => s.id === sub.id ? {...s, assignedCsId: entry.staffId, assignedCsName: staffMember?.name||''} as any : s));
                                      totalDone++;
                                    } catch {}
                                  }
                                }
                                notify('success', `✅ تم توزيع ${totalDone} عميل على ${isDaqqiClientsTab ? 'فريق الدقي' : 'مسئولي التحصيل'}`);
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
                  {collOnlineViewTab === 'old_data' && isDaqqiClientsTab ? (
                    /* داتا قديمة — استيراد عملاء الدقي القدامى */
                    <div className="space-y-5">
                      <div className="flex items-center gap-2">
                        <span className="text-base">📂</span>
                        <h3 className="font-extrabold text-gray-800 text-base">داتا قديمة — استيراد عملاء دقي</h3>
                      </div>
                      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
                        <h4 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
                          ⬆️ استيراد ملف CSV / Excel
                        </h4>
                        <div className="flex flex-wrap gap-3 items-end">
                          <div>
                            <label className="text-xs font-bold text-gray-600 mb-1 block">مصدر البيانات</label>
                            <input value={daqqiOldDataSource} onChange={e => setDaqqiOldDataSource(e.target.value)}
                              placeholder="مثال: داتا دقي 2024"
                              className="border border-gray-200 rounded-xl px-3 py-2 text-sm w-48" />
                          </div>
                          <div>
                            <label className="text-xs font-bold text-gray-600 mb-1 block">ملف CSV أو TSV</label>
                            <input type="file" accept=".csv,.tsv,.txt"
                              onChange={e => {
                                const f = e.target.files?.[0];
                                if (!f) return;
                                const reader = new FileReader();
                                reader.onload = ev => {
                                  const text = ev.target?.result as string;
                                  const lines = text.split(/\r?\n/).filter(Boolean);
                                  const sep = lines[0]?.includes('\t') ? '\t' : ',';
                                  const hdrs = lines[0]?.split(sep).map(h => h.replace(/^"|"$/g,'').trim().toLowerCase());
                                  const nameCol = hdrs.findIndex(h => h.includes('name') || h.includes('اسم'));
                                  const phoneCol = hdrs.findIndex(h => h.includes('phone') || h.includes('هاتف'));
                                  const emailCol = hdrs.findIndex(h => h.includes('email') || h.includes('إيميل'));
                                  const notesCol = hdrs.findIndex(h => h.includes('note') || h.includes('ملاحظ'));
                                  const courseCol = hdrs.findIndex(h => h.includes('course') || h.includes('كورس'));
                                  const paidCol = hdrs.findIndex(h => h.includes('paid') || h.includes('مدفوع'));
                                  const expectedCol = hdrs.findIndex(h => h.includes('expected') || h.includes('متوقع'));
                                  const certCol = hdrs.findIndex(h => h.includes('cert') || h.includes('شهاد'));
                                  const attendanceCol = hdrs.findIndex(h => h.includes('attend') || h.includes('حضور'));
                                  const parsed = lines.slice(1).map((line, i) => {
                                    const cols = line.split(sep).map(c => c.replace(/^"|"$/g,'').trim());
                                    return { _id: `r${i}`, _name: cols[nameCol]||'', _phone: cols[phoneCol]||'', _email: cols[emailCol]||'', _notes: cols[notesCol]||'', _course: cols[courseCol]||'', _paid: cols[paidCol]||'', _expected: cols[expectedCol]||'', _cert: cols[certCol]||'', _attendance: cols[attendanceCol]||'' };
                                  }).filter(r => r._name || r._phone);
                                  setDaqqiOldDataParsed(parsed);
                                  setDaqqiOldDataSelected(new Set(parsed.filter(r=>r._name&&r._phone).map(r=>r._id)));
                                  setDaqqiOldDataResult(null);
                                };
                                reader.readAsText(f, 'UTF-8');
                              }}
                              className="text-sm text-gray-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer" />
                          </div>
                        </div>
                        <p className="text-[11px] text-gray-400">
                          الأعمدة المدعومة: <code className="bg-gray-100 px-1 rounded">name / الاسم</code> &nbsp; <code className="bg-gray-100 px-1 rounded">phone / هاتف</code> &nbsp; <code className="bg-gray-100 px-1 rounded">email</code> &nbsp; <code className="bg-gray-100 px-1 rounded">course / كورس</code> &nbsp; <code className="bg-gray-100 px-1 rounded">paid / مدفوع</code> &nbsp; <code className="bg-gray-100 px-1 rounded">expected / متوقع</code> &nbsp; <code className="bg-gray-100 px-1 rounded">cert / شهادة</code> &nbsp; <code className="bg-gray-100 px-1 rounded">attendance / حضور</code> &nbsp; <code className="bg-gray-100 px-1 rounded">notes / ملاحظات</code>
                        </p>
                        {daqqiOldDataParsed.length > 0 && (
                          <>
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <span className="text-sm font-bold text-gray-700">{daqqiOldDataParsed.length} صف — محدد: {daqqiOldDataSelected.size}</span>
                              <div className="flex gap-2">
                                <button onClick={() => setDaqqiOldDataSelected(new Set(daqqiOldDataParsed.map(r => r._id)))} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 font-bold">تحديد الكل</button>
                                <button onClick={() => setDaqqiOldDataSelected(new Set())} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 font-bold">إلغاء الكل</button>
                              </div>
                            </div>
                            <div className="max-h-64 overflow-auto border border-gray-200 rounded-xl">
                              <table className="w-full text-xs">
                                <thead className="bg-gray-50 sticky top-0">
                                  <tr>
                                    <th className="py-2 px-3 text-right font-bold text-gray-600 w-8"><input type="checkbox" checked={daqqiOldDataSelected.size === daqqiOldDataParsed.length} onChange={e => setDaqqiOldDataSelected(e.target.checked ? new Set(daqqiOldDataParsed.map(r => r._id)) : new Set())} className="w-3.5 h-3.5" /></th>
                                    <th className="py-2 px-3 text-right font-bold text-gray-600">الاسم</th>
                                    <th className="py-2 px-3 text-right font-bold text-gray-600">الهاتف</th>
                                    <th className="py-2 px-3 text-right font-bold text-gray-600">الكورس</th>
                                    <th className="py-2 px-3 text-right font-bold text-gray-600">مدفوع</th>
                                    <th className="py-2 px-3 text-right font-bold text-gray-600">متوقع</th>
                                    <th className="py-2 px-3 text-right font-bold text-gray-600">شهادة</th>
                                    <th className="py-2 px-3 text-right font-bold text-gray-600">حضور</th>
                                    <th className="py-2 px-3 text-right font-bold text-gray-600">ملاحظة</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {daqqiOldDataParsed.slice(0,200).map(r => {
                                    const ok = !!(r._name && r._phone);
                                    return (
                                      <tr key={r._id} className={`border-b border-gray-50 hover:bg-gray-50/50 ${!ok?'opacity-50':''}`}>
                                        <td className="py-1.5 px-3"><input type="checkbox" checked={daqqiOldDataSelected.has(r._id)} disabled={!ok} onChange={e => { const next = new Set(daqqiOldDataSelected); e.target.checked ? next.add(r._id) : next.delete(r._id); setDaqqiOldDataSelected(next); }} className="w-3.5 h-3.5" /></td>
                                        <td className="py-1.5 px-3 font-bold text-gray-900">{r._name || <span className="text-red-400">مطلوب</span>}</td>
                                        <td className="py-1.5 px-3 font-mono text-gray-600">{r._phone || <span className="text-red-400">مطلوب</span>}</td>
                                        <td className="py-1.5 px-3 text-gray-500 max-w-[120px] truncate">{r._course || <span className="text-gray-300">—</span>}</td>
                                        <td className="py-1.5 px-3 text-emerald-700 font-semibold">{r._paid || <span className="text-gray-300">—</span>}</td>
                                        <td className="py-1.5 px-3 text-gray-500">{r._expected || <span className="text-gray-300">—</span>}</td>
                                        <td className="py-1.5 px-3 text-amber-700">{r._cert || <span className="text-gray-300">—</span>}</td>
                                        <td className="py-1.5 px-3 text-blue-600">{r._attendance || <span className="text-gray-300">—</span>}</td>
                                        <td className="py-1.5 px-3 text-gray-500 max-w-[100px] truncate">{r._notes || <span className="text-gray-300">—</span>}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                              {daqqiOldDataParsed.length > 200 && <p className="text-center py-2 text-xs text-gray-400">عرض أول 200 صف من {daqqiOldDataParsed.length}</p>}
                            </div>
                            <button disabled={daqqiOldDataImporting || daqqiOldDataSelected.size === 0}
                              onClick={async () => {
                                setDaqqiOldDataImporting(true);
                                let created = 0, dupes = 0, errors = 0;
                                const rows = daqqiOldDataParsed.filter(r => daqqiOldDataSelected.has(r._id) && r._name && r._phone);
                                for (const row of rows) {
                                  try {
                                    // Try to match course by title
                                    const matchedCourse = row._course ? courses.find(c => (c.titleAr||c.title||'').includes(row._course) || row._course.includes(c.titleAr||c.title||'')) : null;
                                    const enrolledCourseIds = matchedCourse ? [matchedCourse.id] : [];
                                    const paid = Number(row._paid) || 0;
                                    const expected = Number(row._expected) || 0;
                                    const extraNotes = [row._notes, row._cert ? `شهادة: ${row._cert}` : '', row._attendance ? `حضور: ${row._attendance}` : ''].filter(Boolean).join(' | ');
                                    const payHistory: PaymentHistoryEntry[] = [];
                                    if (paid > 0 && matchedCourse) {
                                      payHistory.push({ id:`csv-pay-${Date.now()}-${Math.random()}`, amount:paid, currency:'EGP', paymentType:'course', isInstallment:false, courseId:matchedCourse.id, courseExpected:expected||undefined, at:new Date().toISOString().slice(0,10) });
                                    }
                                    await mysqlAdmin.saveSubscriber({ name: row._name, phone: row._phone, email: row._email || '', branch: 'DAQQI', status: 'active', notes: extraNotes, enrolledCourseIds, source: daqqiOldDataSource || 'داتا قديمة دقي' } as any);
                                    created++;
                                  } catch (e: any) {
                                    if (e.message?.includes('duplicate') || e.message?.includes('مكرر')) dupes++;
                                    else errors++;
                                  }
                                }
                                setDaqqiOldDataImporting(false);
                                setDaqqiOldDataResult({ created, dupes, errors });
                                if (created > 0) {
                                  notify('success', `✅ تم استيراد ${created} عميل`);
                                  try { const fresh = (await mysqlAdmin.listMyDaqqiClients()) as unknown as SubscriberItem[]; setSalesOwnSubscribers(prev => { const ids = new Set(prev.map(s=>s.id)); return [...prev, ...fresh.filter(s=>!ids.has(s.id))]; }); } catch {}
                                }
                              }}
                              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700 disabled:opacity-60 transition">
                              {daqqiOldDataImporting ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> جارٍ الاستيراد...</> : <>⬆️ استيراد {daqqiOldDataSelected.size} عميل</>}
                            </button>
                          </>
                        )}
                        {daqqiOldDataResult && (
                          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm space-y-1">
                            <p className="font-bold text-emerald-800">✅ انتهى الاستيراد</p>
                            <p className="text-emerald-700">تم إنشاء: <strong>{daqqiOldDataResult.created}</strong> عميل جديد</p>
                            {daqqiOldDataResult.dupes > 0 && <p className="text-amber-700">مكرر (تم تجاهله): <strong>{daqqiOldDataResult.dupes}</strong></p>}
                            {daqqiOldDataResult.errors > 0 && <p className="text-red-700">أخطاء: <strong>{daqqiOldDataResult.errors}</strong></p>}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                  <>
                  {/* ── استيراد بيانات قديمة للأونلاين (old_local / old_intl) ── */}
                  {(collOnlineViewTab === 'old_local' || collOnlineViewTab === 'old_intl') && !isDaqqiClientsTab && (
                    <details className="mb-4 group" open={onlineOldDataParsed.length > 0}>
                      <summary className="cursor-pointer flex items-center gap-2 bg-violet-50 border border-violet-200 rounded-2xl px-4 py-2.5 text-sm font-bold text-violet-800 hover:bg-violet-100 transition select-none list-none">
                        <span>⬆️</span>
                        <span>استيراد بيانات {collOnlineViewTab === 'old_local' ? 'محلي قديم' : 'دولي قديم'}</span>
                        <span className="text-xs font-normal text-violet-500 mr-auto group-open:hidden">انقر للفتح</span>
                        <span className="text-xs font-normal text-violet-500 mr-auto hidden group-open:inline">▲ إخفاء</span>
                      </summary>
                      <div className="mt-2 bg-white border border-violet-200 rounded-2xl p-5 shadow-sm space-y-4">
                        <div className="flex flex-wrap gap-3 items-end">
                          <div>
                            <label className="text-xs font-bold text-gray-600 mb-1 block">مصدر البيانات</label>
                            <input value={onlineOldDataSource} onChange={e => setOnlineOldDataSource(e.target.value)}
                              placeholder="مثال: داتا أونلاين 2024"
                              className="border border-gray-200 rounded-xl px-3 py-2 text-sm w-48" />
                          </div>
                          <div>
                            <label className="text-xs font-bold text-gray-600 mb-1 block">ملف CSV أو TSV</label>
                            <input type="file" accept=".csv,.tsv,.txt"
                              onChange={e => {
                                const f = e.target.files?.[0];
                                if (!f) return;
                                const reader = new FileReader();
                                reader.onload = ev => {
                                  const text = ev.target?.result as string;
                                  const lines = text.split(/\r?\n/).filter(Boolean);
                                  const sep = lines[0]?.includes('\t') ? '\t' : ',';
                                  const hdrs = lines[0]?.split(sep).map(h => h.replace(/^"|"$/g,'').trim().toLowerCase());
                                  const nameCol = hdrs.findIndex(h => h.includes('name') || h.includes('اسم'));
                                  const phoneCol = hdrs.findIndex(h => h.includes('phone') || h.includes('هاتف'));
                                  const emailCol = hdrs.findIndex(h => h.includes('email') || h.includes('إيميل'));
                                  const notesCol = hdrs.findIndex(h => h.includes('note') || h.includes('ملاحظ'));
                                  const courseCol = hdrs.findIndex(h => h.includes('course') || h.includes('كورس'));
                                  const paidCol = hdrs.findIndex(h => h.includes('paid') || h.includes('مدفوع'));
                                  const expectedCol = hdrs.findIndex(h => h.includes('expected') || h.includes('متوقع'));
                                  const certCol = hdrs.findIndex(h => h.includes('cert') || h.includes('شهاد'));
                                  const attendanceCol = hdrs.findIndex(h => h.includes('attend') || h.includes('حضور'));
                                  const parsed = lines.slice(1).map((line, i) => {
                                    const cols = line.split(sep).map(c => c.replace(/^"|"$/g,'').trim());
                                    return { _id: `r${i}`, _name: cols[nameCol]||'', _phone: cols[phoneCol]||'', _email: cols[emailCol]||'', _notes: cols[notesCol]||'', _course: cols[courseCol]||'', _paid: cols[paidCol]||'', _expected: cols[expectedCol]||'', _cert: cols[certCol]||'', _attendance: cols[attendanceCol]||'' };
                                  }).filter(r => r._name || r._phone);
                                  setOnlineOldDataParsed(parsed);
                                  setOnlineOldDataSelected(new Set(parsed.filter(r=>r._name&&r._phone).map(r=>r._id)));
                                  setOnlineOldDataResult(null);
                                };
                                reader.readAsText(f, 'UTF-8');
                              }}
                              className="text-sm text-gray-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100 cursor-pointer" />
                          </div>
                        </div>
                        <p className="text-[11px] text-gray-400">
                          الأعمدة المدعومة: <code className="bg-gray-100 px-1 rounded">name / الاسم</code> &nbsp; <code className="bg-gray-100 px-1 rounded">phone / هاتف</code> &nbsp; <code className="bg-gray-100 px-1 rounded">email</code> &nbsp; <code className="bg-gray-100 px-1 rounded">course / كورس</code> &nbsp; <code className="bg-gray-100 px-1 rounded">paid / مدفوع</code> &nbsp; <code className="bg-gray-100 px-1 rounded">expected / متوقع</code> &nbsp; <code className="bg-gray-100 px-1 rounded">cert / شهادة</code> &nbsp; <code className="bg-gray-100 px-1 rounded">notes / ملاحظات</code>
                        </p>
                        {onlineOldDataParsed.length > 0 && (
                          <>
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <span className="text-sm font-bold text-gray-700">{onlineOldDataParsed.length} صف — محدد: {onlineOldDataSelected.size}</span>
                              <div className="flex gap-2">
                                <button onClick={() => setOnlineOldDataSelected(new Set(onlineOldDataParsed.map(r => r._id)))} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 font-bold">تحديد الكل</button>
                                <button onClick={() => setOnlineOldDataSelected(new Set())} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 font-bold">إلغاء الكل</button>
                              </div>
                            </div>
                            <div className="max-h-64 overflow-auto border border-gray-200 rounded-xl">
                              <table className="w-full text-xs">
                                <thead className="bg-gray-50 sticky top-0">
                                  <tr>
                                    <th className="py-2 px-3 text-right font-bold text-gray-600 w-8"><input type="checkbox" checked={onlineOldDataSelected.size === onlineOldDataParsed.length} onChange={e => setOnlineOldDataSelected(e.target.checked ? new Set(onlineOldDataParsed.map(r => r._id)) : new Set())} className="w-3.5 h-3.5" /></th>
                                    <th className="py-2 px-3 text-right font-bold text-gray-600">الاسم</th>
                                    <th className="py-2 px-3 text-right font-bold text-gray-600">الهاتف</th>
                                    <th className="py-2 px-3 text-right font-bold text-gray-600">الكورس</th>
                                    <th className="py-2 px-3 text-right font-bold text-gray-600">مدفوع</th>
                                    <th className="py-2 px-3 text-right font-bold text-gray-600">متوقع</th>
                                    <th className="py-2 px-3 text-right font-bold text-gray-600">شهادة</th>
                                    <th className="py-2 px-3 text-right font-bold text-gray-600">ملاحظة</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {onlineOldDataParsed.slice(0,200).map(r => {
                                    const ok = !!(r._name && r._phone);
                                    return (
                                      <tr key={r._id} className={`border-b border-gray-50 hover:bg-gray-50/50 ${!ok?'opacity-50':''}`}>
                                        <td className="py-1.5 px-3"><input type="checkbox" checked={onlineOldDataSelected.has(r._id)} disabled={!ok} onChange={e => { const next = new Set(onlineOldDataSelected); e.target.checked ? next.add(r._id) : next.delete(r._id); setOnlineOldDataSelected(next); }} className="w-3.5 h-3.5" /></td>
                                        <td className="py-1.5 px-3 font-bold text-gray-900">{r._name || <span className="text-red-400">مطلوب</span>}</td>
                                        <td className="py-1.5 px-3 font-mono text-gray-600">{r._phone || <span className="text-red-400">مطلوب</span>}</td>
                                        <td className="py-1.5 px-3 text-gray-500 max-w-[120px] truncate">{r._course || <span className="text-gray-300">—</span>}</td>
                                        <td className="py-1.5 px-3 text-emerald-700 font-semibold">{r._paid || <span className="text-gray-300">—</span>}</td>
                                        <td className="py-1.5 px-3 text-gray-500">{r._expected || <span className="text-gray-300">—</span>}</td>
                                        <td className="py-1.5 px-3 text-amber-700">{r._cert || <span className="text-gray-300">—</span>}</td>
                                        <td className="py-1.5 px-3 text-gray-500 max-w-[100px] truncate">{r._notes || <span className="text-gray-300">—</span>}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                              {onlineOldDataParsed.length > 200 && <p className="text-center py-2 text-xs text-gray-400">عرض أول 200 صف من {onlineOldDataParsed.length}</p>}
                            </div>
                            <button disabled={onlineOldDataImporting || onlineOldDataSelected.size === 0}
                              onClick={async () => {
                                setOnlineOldDataImporting(true);
                                let created = 0, dupes = 0, errors = 0;
                                const rows = onlineOldDataParsed.filter(r => onlineOldDataSelected.has(r._id) && r._name && r._phone);
                                const subBranch = collOnlineViewTab === 'old_local' ? 'ONLINE_EGYPT' : 'ONLINE_ABROAD';
                                const subCurrency = collOnlineViewTab === 'old_local' ? 'EGP' : 'USD';
                                for (const row of rows) {
                                  try {
                                    const matchedCourse = row._course ? courses.find(c => (c.titleAr||c.title||'').includes(row._course) || row._course.includes(c.titleAr||c.title||'')) : null;
                                    const enrolledCourseIds = matchedCourse ? [matchedCourse.id] : [];
                                    const paid = Number(row._paid) || 0;
                                    const expected = Number(row._expected) || 0;
                                    const extraNotes = [row._notes, row._cert ? `شهادة: ${row._cert}` : '', row._attendance ? `حضور: ${row._attendance}` : ''].filter(Boolean).join(' | ');
                                    const payHistory: PaymentHistoryEntry[] = [];
                                    if (paid > 0 && matchedCourse) {
                                      payHistory.push({ id:`csv-pay-${Date.now()}-${Math.random()}`, amount:paid, currency:subCurrency as 'EGP'|'USD', paymentType:'course', isInstallment:false, courseId:matchedCourse.id, courseExpected:expected||undefined, at:new Date().toISOString().slice(0,10) });
                                    }
                                    await mysqlAdmin.saveSubscriber({ name: row._name, phone: row._phone, email: row._email || '', branch: subBranch, status: 'active', clientStatus: collOnlineViewTab, notes: extraNotes, enrolledCourseIds, source: onlineOldDataSource || 'داتا قديمة أونلاين', paymentHistory: payHistory } as any);
                                    created++;
                                  } catch (e: any) {
                                    if (e.message?.includes('duplicate') || e.message?.includes('مكرر')) dupes++;
                                    else errors++;
                                  }
                                }
                                setOnlineOldDataImporting(false);
                                setOnlineOldDataResult({ created, dupes, errors });
                                if (created > 0) {
                                  notify('success', `✅ تم استيراد ${created} عميل`);
                                  try { const fresh = await mysqlAdmin.listStaffSubscribers() as unknown as SubscriberItem[]; setSalesOwnSubscribers(prev => { const ids = new Set(prev.map(s=>s.id)); return [...prev, ...fresh.filter(s=>!ids.has(s.id))]; }); } catch {}
                                }
                              }}
                              className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white rounded-xl font-bold text-sm hover:bg-violet-700 disabled:opacity-60 transition">
                              {onlineOldDataImporting ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> جارٍ الاستيراد...</> : <>⬆️ استيراد {onlineOldDataSelected.size} عميل</>}
                            </button>
                          </>
                        )}
                        {onlineOldDataResult && (
                          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm space-y-1">
                            <p className="font-bold text-emerald-800">✅ انتهى الاستيراد</p>
                            <p className="text-emerald-700">تم إنشاء: <strong>{onlineOldDataResult.created}</strong> عميل جديد</p>
                            {onlineOldDataResult.dupes > 0 && <p className="text-amber-700">مكرر (تم تجاهله): <strong>{onlineOldDataResult.dupes}</strong></p>}
                            {onlineOldDataResult.errors > 0 && <p className="text-red-700">أخطاء: <strong>{onlineOldDataResult.errors}</strong></p>}
                          </div>
                        )}
                      </div>
                    </details>
                  )}
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
                          const customPrices: Record<string,number> = (row as any).customPrices || {};
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
                                const lbl = '\u0628\u0627\u0642\u0629: ' + partialCids.map(cid => courses.find(c=>c.id===cid)?.title || cid).join(' + ');
                                return [{ cid: multiCourseKey, label: lbl, expected: exp, paid: totalPaid, remaining: Math.max(0, exp - totalPaid), cur: detCur(payments[0]) }];
                              })()
                            : [
                            ...completeBundles.map(b => {
                              const bCids = b.courses.map(co => co.id);
                              const bundleCid = `bundle:${b.id}`;
                              const bPay = payments.filter(p => ((p.courseId && bCids.includes(p.courseId)) || (p.bundleId === b.id) || (!p.courseId && !p.bundleId && (p.paymentType === 'course' || !p.paymentType))) && p.paymentType !== 'certificate' && p.paymentType !== 'book');
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
                          const branchBadge = branchId === 'ONLINE_EGYPT' ? { text:'أونلاين مصر', cls:'bg-purple-50 text-purple-700 border-purple-200' }
                            : branchId === 'ONLINE_SAUDI' ? { text:'السعودية', cls:'bg-cyan-50 text-cyan-700 border-cyan-200' }
                            : branchId === 'ONLINE_ABROAD' ? { text:'خارج مصر', cls:'bg-teal-50 text-teal-700 border-teal-200' }
                            : { text: row.branch||'—', cls:'bg-gray-50 text-gray-600 border-gray-200' };
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
                            <select value={row.status||'active'} onChange={e => updateSubscriber({...row, status: e.target.value as SubscriberItem['status']})}
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
                                    if(!isAdmin) setSalesOwnSubscribers(prev=>prev.map(s=>s.id===row.id?updated:s));
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
                                  setSubPayDraft(blankPaymentDraft({
                                    currency: (branchId==='ONLINE_ABROAD'||branchId==='ONLINE_SAUDI')?'SAR':'EGP',
                                    courseId: completeBundles.length > 0 ? `bundle:${completeBundles[0].id}` : (row.enrolledCourseIds?.[0] || ''),
                                  }));
                                  setSubPayDraft(prev => ({ ...prev, bookingType: (row.enrolledCourseIds||[]).length > 0 ? 'installment' : 'new_booking' }));
                                }} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-emerald-50 hover:text-emerald-600 flex items-center justify-center transition"><Wallet size={12}/></button>
                                <button title="تواصل" onClick={()=>{setSubContactRow(row);setSubContactDraft({type:'call',date:new Date().toISOString().slice(0,16),notes:'',outcome:'',nextFollowUp:''}); }} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-blue-50 hover:text-blue-600 flex items-center justify-center transition"><Phone size={12}/></button>
                                <button title="خطة أقساط" onClick={()=>{setSubInstRow(row);setSubInstDraft({courseId:'',currency:'EGP',amountPerInst:'',numInstallments:'3',inputMode:'count',startDate:new Date().toISOString().slice(0,10),intervalDays:'30',notes:'',overrideExpected:''}); }} className="h-7 rounded bg-gray-50 text-gray-500 hover:bg-purple-50 hover:text-purple-600 flex items-center justify-center transition"><Calendar size={12}/></button>
                              </div>
                              <div className={`grid gap-0.5 ${(isAdmin||isOnlineManager||isDaqqiClientsTab)?'grid-cols-4':'grid-cols-3'}`}>
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
                                {(isAdmin||isOnlineManager||isDaqqiClientsTab) && <button title="حذف العميل" onClick={()=>{if(confirm(`حذف "${row.name}"؟ لا يمكن التراجع.`)){deleteSubscriber(row.id);if(!isAdmin) setSalesOwnSubscribers(prev=>prev.filter(s=>s.id!==row.id));
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
                    {filtered.length === 0 && <p className="text-sm text-gray-500 mt-3">لا يوجد عملاء مطابقين للبحث.</p>}
                  </div>
                  </> )} {/* end of old_data ternary */}
                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-1 mt-4 flex-wrap">
                      <button onClick={()=>setCollOnlinePage(1)} disabled={safePage===1} className="px-2 py-1 rounded-lg text-xs border disabled:opacity-40 hover:bg-gray-50">«</button>
                      <button onClick={()=>setCollOnlinePage(p=>Math.max(1,p-1))} disabled={safePage===1} className="px-2 py-1 rounded-lg text-xs border disabled:opacity-40 hover:bg-gray-50">‹</button>
                      {Array.from({length:totalPages},(_,i)=>i+1)
                        .filter(p=>p===1||p===totalPages||Math.abs(p-safePage)<=2)
                        .reduce<(number|'...')[]>((acc,p,idx,arr)=>{ if(idx>0&&(p as number)-(arr[idx-1] as number)>1)acc.push('...'); acc.push(p); return acc; },[])
                        .map((p,i)=>p==='...'?<span key={`e${i}`} className="px-2 text-gray-400 text-xs">…</span>:
                          <button key={p} onClick={()=>setCollOnlinePage(p as number)} className={`px-3 py-1 rounded-lg text-xs border font-bold transition ${safePage===p?'bg-teal-600 text-white border-teal-600':'hover:bg-gray-50'}`}>{p}</button>
                        )}
                      <button onClick={()=>setCollOnlinePage(p=>Math.min(totalPages,p+1))} disabled={safePage===totalPages} className="px-2 py-1 rounded-lg text-xs border disabled:opacity-40 hover:bg-gray-50">›</button>
                      <button onClick={()=>setCollOnlinePage(totalPages)} disabled={safePage===totalPages} className="px-2 py-1 rounded-lg text-xs border disabled:opacity-40 hover:bg-gray-50">»</button>
                    </div>
                  )}


                  {/* ===== تسكين في روند (daqqi) ===== */}
                  {daqqiHousingModal && isDaqqiClientsTab && (
                    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" dir="rtl" onClick={e=>{if(e.target===e.currentTarget)setDaqqiHousingModal(null);}}>
                      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-bold text-gray-800">🏠 تسكين العميل في روند</h3>
                          <button onClick={()=>setDaqqiHousingModal(null)} className="text-gray-400 hover:text-gray-700"><X size={18}/></button>
                        </div>
                        <p className="text-sm text-gray-600 mb-4">العميل: <strong>{daqqiHousingModal.name}</strong></p>
                        <select value={daqqiHousingRoundId} onChange={e=>setDaqqiHousingRoundId(e.target.value)}
                          className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                          <option value="">— اختر الروند —</option>
                          {(salesOwnDaqqiRounds??[]).map((r:DaqqiRound)=>(
                            <option key={r.id} value={r.id}>{r.code} — {r.receptionName} — {r.dayOfWeek} {r.timeSlot}</option>
                          ))}
                        </select>
                        {daqqiHousingRoundId && housingMap.has(daqqiHousingModal.id) && (
                          <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-3">⚠️ هذا العميل مسكن بالفعل — سيتم تغيير الروند.</p>
                        )}
                        <div className="flex gap-3 justify-end">
                          <button onClick={()=>setDaqqiHousingModal(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200">إلغاء</button>
                          <button disabled={!daqqiHousingRoundId} onClick={async()=>{
                            const round=(salesOwnDaqqiRounds??[]).find((r:DaqqiRound)=>r.id===daqqiHousingRoundId);
                            if(!round||!daqqiHousingModal)return;
                            const newAttendee:DaqqiRoundAttendee={
                              subscriberId:daqqiHousingModal.id,
                              name:daqqiHousingModal.name,
                              phone:daqqiHousingModal.phone||'',
                              bookedAt:new Date().toISOString(),
                              amountPaid:0,
                            };
                            // Remove from old round if already housed
                            let updatedRounds=(salesOwnDaqqiRounds??[]).map((r:DaqqiRound)=>{
                              if(r.id===round.id){
                                const filtered=(r.attendees??[]).filter((a:DaqqiRoundAttendee)=>a.subscriberId!==daqqiHousingModal.id);
                                return{...r,attendees:[...filtered,newAttendee]};
                              }
                              // Remove from other rounds
                              return{...r,attendees:(r.attendees??[]).filter((a:DaqqiRoundAttendee)=>a.subscriberId!==daqqiHousingModal.id)};
                            });
                            await mysqlAdmin.saveDaqqiRound(updatedRounds.find((r:DaqqiRound)=>r.id===round.id) as unknown as Record<string,unknown>);
                            setSalesOwnDaqqiRounds(updatedRounds);
                            notify('success',`✅ تم تسكين ${daqqiHousingModal.name} في روند ${round.code}`);
                            setDaqqiHousingModal(null);
                            setDaqqiHousingRoundId('');
                          }} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:opacity-40">تأكيد التسكين</button>
                        </div>
                      </div>
                    </div>
                  )}

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

                  {/* ===== تحويل popup ===== */}
                  {convertRow && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl" onClick={e=>{if(e.target===e.currentTarget)setConvertRow(null);}}>
                      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-orange-50">
                          <div>
                            <h3 className="font-extrabold text-gray-900">🔄 تحويل العميل</h3>
                            <p className="text-xs text-gray-500 mt-0.5">{convertRow.name}</p>
                          </div>
                          <button onClick={()=>setConvertRow(null)} className="text-gray-400 hover:text-gray-700"><X size={20}/></button>
                        </div>
                        <div className="p-5">
                          {!convertType ? (
                            <div className="space-y-2">
                              <p className="text-sm font-bold text-gray-700 mb-3">اختر نوع التحويل:</p>
                              {([
                                {key:'finished' as const, label:'✅ منتهي',            cls:'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'},
                                {key:'paused'   as const, label:'⏸ متوقف',             cls:'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'},
                                {key:'refunded' as const, label:'↩️ استرداد',          cls:'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'},
                                {key:'leads'    as const, label:'👥 عملاء محتملين',    cls:'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100'},
                                isDaqqiClientsTab
                                  ? {key:'online' as const, label:'🌐 تحويل لأونلاين', cls:'bg-teal-50 border-teal-200 text-teal-700 hover:bg-teal-100'}
                                  : {key:'daqqi'  as const, label:'🏢 فرع الدقي',      cls:'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'},
                              ] as {key:'finished'|'paused'|'refunded'|'leads'|'daqqi'|'online';label:string;cls:string}[]).map(opt => (
                                <button key={opt.key} onClick={()=>setConvertType(opt.key)}
                                  className={`w-full border rounded-xl px-4 py-2.5 text-sm font-bold transition ${opt.cls}`}>
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {convertType === 'finished' && (
                                <>
                                  <p className="text-sm font-bold text-gray-700 mb-1">هل حضر العميل اللايف؟</p>
                                  <div className="flex gap-2">
                                    <button onClick={()=>setConvertAttendedLive(true)} className={`flex-1 border rounded-xl px-3 py-2 text-sm font-bold transition ${convertAttendedLive ? 'bg-green-600 text-white border-green-600' : 'border-gray-200 hover:bg-gray-50'}`}>✅ نعم</button>
                                    <button onClick={()=>setConvertAttendedLive(false)} className={`flex-1 border rounded-xl px-3 py-2 text-sm font-bold transition ${!convertAttendedLive ? 'bg-gray-600 text-white border-gray-600' : 'border-gray-200 hover:bg-gray-50'}`}>❌ لا</button>
                                  </div>
                                  <p className="text-sm font-bold text-gray-700 mb-1">هل استلم العميل شهادته؟</p>
                                  <div className="flex gap-2">
                                    <button onClick={()=>setConvertGotCert(true)} className={`flex-1 border rounded-xl px-3 py-2 text-sm font-bold transition ${convertGotCert ? 'bg-green-600 text-white border-green-600' : 'border-gray-200 hover:bg-gray-50'}`}>✅ نعم</button>
                                    <button onClick={()=>setConvertGotCert(false)} className={`flex-1 border rounded-xl px-3 py-2 text-sm font-bold transition ${!convertGotCert ? 'bg-gray-600 text-white border-gray-600' : 'border-gray-200 hover:bg-gray-50'}`}>❌ لا</button>
                                  </div>
                                </>
                              )}
                              {convertType === 'paused' && (
                                <>
                                  <label className="block text-sm font-bold text-gray-700 mb-1">سبب التوقف:</label>
                                  <textarea value={convertPauseReason} onChange={e=>setConvertPauseReason(e.target.value)}
                                    rows={3} placeholder="اكتب سبب التوقف..."
                                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200 resize-none" />
                                </>
                              )}
                              {convertType === 'refunded' && (
                                <>
                                  <label className="block text-sm font-bold text-gray-700 mb-1">سبب الاسترداد: <span className="text-red-500">*</span></label>
                                  <textarea value={convertRefundReason} onChange={e=>setConvertRefundReason(e.target.value)}
                                    rows={3} placeholder="اكتب سبب الاسترداد..."
                                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 resize-none" />
                                  <label className="block text-sm font-bold text-gray-700 mb-1 mt-2">المبلغ المطلوب للاسترداد (ج.م):</label>
                                  <input type="number" min="0" value={convertRefundAmount} onChange={e=>setConvertRefundAmount(e.target.value)}
                                    placeholder="0"
                                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200" />
                                  <label className="block text-sm font-bold text-gray-700 mb-1 mt-2">طريقة تحويل الاسترداد:</label>
                                  <select value={convertRefundMethod} onChange={e=>setConvertRefundMethod(e.target.value)}
                                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 bg-white">
                                    <option value="">اختر الطريقة (اختياري)</option>
                                    <option value="bank">تحويل بنكي</option>
                                    <option value="vodafone">فودافون كاش</option>
                                    <option value="instapay">إنستاباي</option>
                                    <option value="cash">كاش</option>
                                    <option value="other">أخرى</option>
                                  </select>
                                </>
                              )}
                              {convertType === 'leads' && (
                                <p className="text-sm text-gray-600 bg-purple-50 border border-purple-200 rounded-xl px-3 py-2">
                                  سيتم نقل هذا العميل بشكل مباشر إلى صفحة العملاء المحتملين وحذفه من عملاء الأونلاين. هل أنت متأكد؟
                                </p>
                              )}
                              {convertType === 'daqqi' && (
                                <p className="text-sm text-gray-600 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
                                  سيتم تحويل هذا العميل إلى فرع الدقي. هل أنت متأكد؟
                                </p>
                              )}
                              {convertType === 'online' && (
                                <p className="text-sm text-gray-600 bg-teal-50 border border-teal-200 rounded-xl px-3 py-2">
                                  سيتم تحويل هذا العميل من فرع الدقي إلى الأونلاين. هل أنت متأكد؟
                                </p>
                              )}
                              <div className="flex items-center gap-2 mt-2">
                                <button onClick={()=>setConvertType('')} className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm hover:bg-gray-50">رجوع</button>
                                <button disabled={convertSaving || (convertType==='paused' && !convertPauseReason.trim()) || (convertType==='refunded' && !convertRefundReason.trim()) || (convertType as string)===''}
                                  onClick={async()=>{
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
                                        updateSubscriber(onlineUpdated);
                                        setSalesOwnSubscribers(prev => prev.map(s => s.id === onlineUpdated.id ? onlineUpdated : s));
                                        await mysqlAdmin.saveSubscriber(onlineUpdated as unknown as Record<string,unknown>);
                                        setConvertRow(null);
                                        notify('success', `✅ تم تحويل ${convertRow.name} إلى الأونلاين`);
                                        setConvertSaving(false);
                                        return;
                                      }
                                      if (convertType === 'leads') {
                                        // Create a real lead from this subscriber
                                        const subAsLead: LeadItem = {
                                          id: `lead-${convertRow.id}-${Date.now()}`,
                                          name: convertRow.name || '',
                                          email: convertRow.email || '',
                                          phone: convertRow.phone || '',
                                          source: isDaqqiClientsTab ? 'محول من الدقي' : 'محول من أونلاين',
                                          status: 'new' as LeadStatus,
                                          leadType: 'course',
                                          enrolledCourseId: (convertRow.enrolledCourseIds||[])[0] || '',
                                          branch: (convertRow.branch || 'other') as any,
                                          interestLevel: 'medium',
                                          assignedSalesId: convertRow.assignedCsId || '',
                                          assignedSalesName: '',
                                          communications: [],
                                          notes: convertRow.notes || '',
                                          createdAt: new Date().toISOString().slice(0,10),
                                        };
                                        // Delete subscriber FIRST so addLead doesn't get blocked by isSubscriber check
                                        deleteSubscriber(convertRow.id);
                                        setSalesOwnSubscribers(prev => prev.filter(s => s.id !== convertRow.id));
                                        await addLead(subAsLead);
                                        setConvertRow(null);
                                        notify('success', `✅ تم تحويل ${convertRow.name} إلى العملاء المحتملين`);
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
                                      // Update local state immediately for snappy UI
                                      updateSubscriber(updated);
                                      setSalesOwnSubscribers(prev => prev.map(s => s.id === updated.id ? updated : s));
                                      // Await explicit server save so errors are caught and shown
                                      await mysqlAdmin.saveSubscriber(updated as unknown as Record<string,unknown>);
                                      setConvertRow(null);
                                      const typeLabel = convertType === 'finished' ? 'منتهي' : convertType === 'paused' ? 'متوقف' : convertType === 'refunded' ? 'قائمة طلبات الاسترداد (ينتظر موافقة)' : 'فرع الدقي';
                                      notify('success', `✅ تم تحويل العميل إلى ${typeLabel}`);
                                    } catch (err: unknown) {
                                      notify('error', '❌ فشل التحويل: ' + (err instanceof Error ? err.message : String(err)));
                                    } finally {
                                      setConvertSaving(false);
                                    }
                                  }}
                                  className="flex-1 bg-orange-600 text-white rounded-xl px-3 py-2 text-sm font-bold hover:bg-orange-700 disabled:opacity-50 transition">
                                  {convertSaving ? '⏳...' : '✅ تأكيد التحويل'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* تفاصيل popup */}
                  {collDetailsRow && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl" onClick={e=>{if(e.target===e.currentTarget)setCollDetailsRow(null);}}>
                      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-indigo-50">
                          <div>
                            <h3 className="font-extrabold text-gray-900">📋 تفاصيل الكورسات</h3>
                            <p className="text-xs text-gray-500 mt-0.5">{collDetailsRow.name}</p>
                          </div>
                          <button onClick={()=>setCollDetailsRow(null)} className="text-gray-400 hover:text-gray-700"><X size={20}/></button>
                        </div>
                        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
                          {collDetailsDraft.map((d, i) => {
                            const title = d.courseId.startsWith('bundle:')
                              ? bundles.find(b=>b.id===d.courseId.replace('bundle:',''))?.title || d.courseId
                              : d.courseId.startsWith('multi:')
                              ? 'باقة: ' + d.courseId.replace('multi:','').split(',').map((cid: string) => courses.find(c=>c.id===cid)?.title || cid).join(' + ')
                              : courses.find(c=>c.id===d.courseId)?.title || d.courseId;
                            return (
                              <div key={d.courseId} className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                                <p className="font-bold text-gray-800 text-sm mb-3 truncate">{title}</p>
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-xs text-gray-500 mb-1">سعر الكورس (ج.م)</label>
                                    <input type="number" value={d.expected}
                                      onChange={e=>setCollDetailsDraft(prev=>prev.map((x,j)=>j===i?{...x,expected:e.target.value}:x))}
                                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                      placeholder="0" />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-500 mb-1">المبلغ المدفوع (ج.م)</label>
                                    <input type="number" value={d.paid}
                                      onChange={e=>setCollDetailsDraft(prev=>prev.map((x,j)=>j===i?{...x,paid:e.target.value}:x))}
                                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                      placeholder="0" />
                                  </div>
                                </div>
                                <div className="mt-3">
                                  <label className="block text-xs text-gray-500 mb-1">تاريخ الاشتراك</label>
                                  <input type="date" value={d.createdAt}
                                    onChange={e=>setCollDetailsDraft(prev=>prev.map((x,j)=>j===i?{...x,createdAt:e.target.value}:x))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" />
                                </div>
                              </div>
                            );
                          })}
                          {collDetailsDraft.length === 0 && (
                            <p className="text-sm text-gray-400 text-center py-4">لا يوجد كورسات مسجلة</p>
                          )}
                        </div>
                        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50">
                          <button onClick={()=>setCollDetailsRow(null)} className="px-4 py-2 text-sm rounded-xl border border-gray-200 hover:bg-gray-100">إلغاء</button>
                          <button disabled={collDetailsSaving} onClick={async()=>{
                            if(!collDetailsRow) return;
                            setCollDetailsSaving(true);
                            try {
                              const newPayHistory = [...(collDetailsRow.paymentHistory||[])];
                              collDetailsDraft.forEach(d => {
                                const cid = d.courseId;
                                const exp = Number(d.expected)||0;
                                const paid = Number(d.paid)||0;
                                // Virtual multi-bundle: only stored in customPrices, skip paymentHistory
                                if (cid.startsWith('multi:')) return;
                                if (cid.startsWith('bundle:')) {
                                  // Bundle: find existing bundle-tagged entry first, then fall back to first course payment
                                  const bundleId = cid.replace('bundle:', '');
                                  const bCourseIds = bundles.find(b=>b.id===bundleId)?.courses.map(c=>c.id) || [];
                                  // Remove any old individual-course payments and replace with one consolidated bundle entry
                                  const existingBundleIdx = newPayHistory.findIndex(p=>p.courseId===cid&&!p.isInstallment);
                                  if (existingBundleIdx >= 0) {
                                    newPayHistory[existingBundleIdx] = {...newPayHistory[existingBundleIdx], courseExpected: exp, ...(d.paid!==''?{amount:paid}:{})};
                                  } else {
                                    // Find first existing non-installment payment for any course in the bundle
                                    const firstCoursePayIdx = newPayHistory.findIndex(p=>p.courseId&&bCourseIds.includes(p.courseId)&&!p.isInstallment);
                                    if (firstCoursePayIdx >= 0) {
                                      // Promote this payment to represent the whole bundle, remove others
                                      const otherCoursePayIdxs = newPayHistory.map((_p,i)=>i).filter(i=>i!==firstCoursePayIdx&&newPayHistory[i].courseId&&bCourseIds.includes(newPayHistory[i].courseId as string));
                                      // Remove other individual course payments (keep installments)
                                      const toRemove = new Set(otherCoursePayIdxs.filter(i=>!newPayHistory[i].isInstallment));
                                      newPayHistory.splice(0, newPayHistory.length, ...newPayHistory.filter((_,i)=>!toRemove.has(i)));
                                      const newIdx = newPayHistory.findIndex(p=>p.courseId&&bCourseIds.includes(p.courseId)&&!p.isInstallment);
                                      if (newIdx >= 0) newPayHistory[newIdx] = {...newPayHistory[newIdx], courseId: cid, courseExpected: exp, ...(d.paid!==''?{amount:paid}:{})};
                                    } else if (exp > 0 || paid > 0) {
                                      newPayHistory.push({ id: `det-${Date.now()}-${cid}`, courseId: cid, amount: paid, courseExpected: exp, paymentType: 'course' as 'course', currency: 'EGP' as const, at: new Date().toISOString(), isInstallment: false });
                                    }
                                  }
                                } else {
                                  const idx = newPayHistory.findIndex(p=>p.courseId===cid&&!p.isInstallment);
                                  if(idx >= 0) {
                                    newPayHistory[idx] = {...newPayHistory[idx], courseExpected: exp, ...(d.paid!==''?{amount:paid}:{})};
                                  } else if(exp > 0 || paid > 0) {
                                    newPayHistory.push({ id: `det-${Date.now()}-${cid}`, courseId: cid, amount: paid, courseExpected: exp, paymentType: 'course' as 'course', currency: 'EGP' as const, at: new Date().toISOString(), isInstallment: false });
                                  }
                                }
                              });
                              const newCreatedAt = collDetailsDraft.map(d=>d.createdAt).filter(Boolean).sort()[0] || collDetailsRow.createdAt;
                              // Build customPrices map for reliable persistence
                              const updatedCustomPrices: Record<string,number> = { ...((collDetailsRow as any).customPrices || {}) };
                              collDetailsDraft.forEach(d => {
                                if (d.expected !== '' && Number(d.expected) > 0) updatedCustomPrices[d.courseId] = Number(d.expected);
                              });
                              const updated = { ...collDetailsRow, customPrices: updatedCustomPrices, paymentHistory: newPayHistory, createdAt: newCreatedAt };
                              updateSubscriber(updated);
                              if (isNonAdminStaff) setSalesOwnSubscribers(prev => prev.map(s => s.id === updated.id ? updated : s));
                              // Strip updatedAt to bypass OCC conflict check when editing prices
                              const { updatedAt: _occ, ...savePayload } = updated as any;
                              await mysqlAdmin.saveSubscriber(savePayload);
                              notify('success', '\u062a\u0645 \u062d\u0641\u0638 \u0627\u0644\u062a\u0641\u0627\u0635\u064a\u0644 \u0628\u0646\u062c\u0627\u062d \u2705');
                            } catch { notify('error', 'حدث خطأ أثناء الحفظ'); }
                            finally { setCollDetailsSaving(false); setCollDetailsRow(null); }
                          }} className="px-5 py-2 text-sm rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 disabled:opacity-50">
                            {collDetailsSaving ? '...' : 'حفظ'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </article>
              );
}
