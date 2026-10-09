import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, ExternalLink, Loader2, Pencil, RefreshCw, Search, Star, Trash2, X } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import type { Course } from '../../../types';
import { confirmDialog } from '../../../../shared/ui/confirmDialog';
import { Modal } from '../../../../shared/ui/Modal';
import { cairoDay } from '../../../../shared/cairoDate';
import { useCertificateCatalog } from '../../../lib/certificateCatalog';
import { branchLabels, normBranchKey } from '../../unified-client/constants';
import ExtraRequestsPanel from './ExtraRequestsPanel';
import InstituteCertificatesPanel from './InstituteCertificatesPanel';
import { CertDataModal, missingCertData } from './CertDataModal';
import { useSiteData } from '../../../context/SiteDataContext';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface Props {
  notify: NotifyFn;
  courses: Course[];
  certSearch: string;
  setCertSearch: (v: string) => void;
  certTypeFilter: string;
  setCertTypeFilter: (v: string) => void;
  certStatusFilter: string;
  setCertStatusFilter: (v: string) => void;
  /** The pricing panel, passed in as an element so this screen stays unaware of
   *  how prices are stored — it only decides where the panel sits. Only the
   *  people who can save prices are given one. */
  pricing?: React.ReactNode;
  initialTab?: 'requests' | 'pricing';
}

/** One request, as GET /api/admin/certificate-requests gives it. */
type CertRow = {
  id: string; subscriberId: string | null; subscriberName: string; subscriberPhone: string; clientCode: string | null;
  branch: string | null; ownerName: string | null; courseId: string | null; courseTitle: string | null;
  type: string; customName: string | null; nameAr: string | null; nameEn: string | null; nationality: string | null;
  idNumber: string | null; status: CertStatus; price: number | null; paid: number; remaining: number | null;
  /** The dates the certificate states; until typed, the round's or the enrolment's (suggested*). */
  courseStartDate: string | null; courseEndDate: string | null; suggestedStart: string | null; suggestedEnd: string | null;
  /** The price list's figure for this type and currency; «مكتمل» is against it. */
  systemPrice: number | null; complete: boolean;
  /** The client's own name when it is three names or more and none was typed. */
  nameSuggested: string | null;
  currency: string; collectionParty: string | null; note: string | null; adminNote: string | null;
  requestedAt: string | null; issuedAt: string | null;
};

type CertStatus = 'pending' | 'priced' | 'paid' | 'in_progress' | 'not_sent' | 'issued' | 'shipped' | 'at_branch' | 'delivered' | 'returned';

// «الحالات هتكون كالاتي فقط» (8 Oct 2026). Unpaid — PENDING or PRICED — reads
// «في انتظار تأكيد الدفعة» and moves on only paid in full (the server checks it
// against the price list); after that the desk moves it freely between the seven.
const STATUS_META: Record<CertStatus, { label: string; badge: string }> = {
  pending:     { label: 'في انتظار تأكيد الدفعة', badge: 'bg-amber-100 text-amber-800' },
  priced:      { label: 'في انتظار تأكيد الدفعة', badge: 'bg-amber-100 text-amber-800' },
  paid:        { label: 'تحت المراجعة',          badge: 'bg-blue-100 text-blue-700' },
  not_sent:    { label: 'تحت المراجعة',          badge: 'bg-blue-100 text-blue-700' },
  in_progress: { label: 'في الجهة المسئولة',     badge: 'bg-purple-100 text-purple-700' },
  issued:      { label: 'موجودة في الشركة',      badge: 'bg-green-100 text-green-700' },
  at_branch:   { label: 'في الفرع',              badge: 'bg-teal-100 text-teal-700' },
  shipped:     { label: 'اتشحنت',                badge: 'bg-cyan-100 text-cyan-700' },
  delivered:   { label: 'العميل استلم',          badge: 'bg-emerald-100 text-emerald-800' },
  returned:    { label: 'مرتجع',                 badge: 'bg-rose-100 text-rose-700' },
};
const UNPAID: CertStatus[] = ['pending', 'priced'];
const PAID_STAGES: CertStatus[] = ['paid', 'in_progress', 'issued', 'at_branch', 'shipped', 'delivered', 'returned'];
// The filter: the eight, «في انتظار تأكيد الدفعة» standing for both unpaid ones.
const STATUS_FILTERS: Array<{ key: string; label: string; match: CertStatus[] }> = [
  { key: 'unpaid', label: 'في انتظار تأكيد الدفعة', match: UNPAID },
  ...PAID_STAGES.map(stage => ({ key: stage, label: STATUS_META[stage].label, match: stage === 'paid' ? ['paid', 'not_sent'] as CertStatus[] : [stage] })),
];
const CERT_MANAGERS = new Set(['admin', 'manager', 'online_manager', 'daqqi_manager', 'tagamoa_manager', 'sales_collection_manager']);

const NATIONALITIES: Record<string, string> = {
  egyptian: '🇪🇬 مصري',
  non_egyptian_egypt: '👤 مقيم بمصر',
  saudi_resident: '🇸🇦 مقيم بالسعودية',
  international: '✈️ دولي',
};

const num = (value: number | null | undefined) => (value == null ? '—' : Number(value).toLocaleString('ar-EG-u-nu-latn'));
const branchName = (branch: string | null) => (branch ? branchLabels[normBranchKey(branch)] || branch : '—');

type EditDraft = {
  nameAr: string; nameEn: string; type: string; customName: string; courseId: string; nationality: string;
  idNumber: string; price: string; paidAmount: string; collectionParty: string; adminNote: string;
};
const draftOf = (row: CertRow): EditDraft => ({
  nameAr: row.nameAr || row.nameSuggested || '', nameEn: row.nameEn || '', type: row.type.toUpperCase(), customName: row.customName || '',
  courseId: row.courseId || '', nationality: row.nationality ? row.nationality.toUpperCase() : '',
  idNumber: row.idNumber || '', price: row.price != null ? String(row.price) : '', paidAmount: String(row.paid || 0),
  collectionParty: row.collectionParty || '', adminNote: row.adminNote || '',
});

/**
 * The certificates desk: every request with its client, branch, owner, money,
 * where it was paid and what the desk noted, moved step by step to the client —
 * «اتسلمت لشركة الشحن» then «العميل استلمها» or «حصل مرتجع».
 */
export default function CertRequestsTab({
  notify, courses, certSearch, setCertSearch, certTypeFilter, setCertTypeFilter,
  certStatusFilter, setCertStatusFilter, pricing, initialTab = 'requests',
}: Props) {
  const navigate = useNavigate();
  const { isAdmin, currentStaff } = useSiteData();
  // «عند المديرين اقدر امسح شهاده واقدر اعدل شهاده» — the server holds the same line.
  const canManage = isAdmin || CERT_MANAGERS.has(String(currentStaff?.role || '').toLowerCase());
  const [innerTab, setInnerTab] = useState<'requests' | 'institute' | 'extras' | 'pricing'>(pricing ? initialTab : 'requests');
  const certCatalog = useCertificateCatalog();
  const [rows, setRows] = useState<CertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [partyFilter, setPartyFilter] = useState('');
  const [editing, setEditing] = useState<{ row: CertRow; draft: EditDraft } | null>(null);
  const [completing, setCompleting] = useState<CertRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await mysqlAdmin.listAllCertificateRequests() as unknown as CertRow[]);
    } catch (error) {
      notify('error', error instanceof Error ? `تعذر تحميل الشهادات: ${error.message}` : 'تعذر تحميل الشهادات');
    } finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const changeStatus = async (row: CertRow, status: CertStatus) => {
    if (busyId) return;
    setBusyId(row.id);
    try {
      await mysqlAdmin.updateCertificateRequest(row.id, status);
      setRows(prev => prev.map(item => (item.id === row.id ? { ...item, status } : item)));
      notify('success', `${row.subscriberName}: ${STATUS_META[status].label}`);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحديث حالة الشهادة');
    } finally { setBusyId(null); }
  };

  const remove = async (row: CertRow) => {
    if (!await confirmDialog(`حذف طلب الشهادة لـ "${row.subscriberName}"؟ هذا الإجراء لا يمكن التراجع عنه.`)) return;
    setBusyId(row.id);
    try {
      await mysqlAdmin.deleteCertificateRequest(row.id);
      setRows(prev => prev.filter(item => item.id !== row.id));
      notify('success', 'تم حذف الطلب.');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر حذف طلب الشهادة');
    } finally { setBusyId(null); }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const { row, draft } = editing;
    setBusyId(row.id);
    try {
      const result = await mysqlAdmin.updateCertificateDetails(row.id, {
        ...draft, nationality: draft.nationality || null, courseId: draft.courseId || null,
      }) as { changed?: string[] };
      notify('success', result.changed?.length ? `اتعدلت: ${result.changed.join('، ')}` : 'مفيش تغيير');
      setEditing(null);
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر حفظ التعديل');
    } finally { setBusyId(null); }
  };

  const branches = useMemo(() => [...new Set(rows.map(row => normBranchKey(row.branch)).filter(Boolean))], [rows]);
  const owners = useMemo(() => [...new Set(rows.map(row => row.ownerName || '').filter(Boolean))].sort(), [rows]);
  const parties = useMemo(() => [...new Set(rows.flatMap(row => String(row.collectionParty || '').split('، ')).filter(Boolean))].sort(), [rows]);

  const filtered = rows.filter(row => {
    const q = certSearch.trim().toLowerCase();
    if (q) {
      const haystack = `${row.subscriberName} ${row.subscriberPhone} ${row.clientCode || ''} ${row.nameAr || ''} ${row.nameEn || ''} ${row.courseTitle || ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (certTypeFilter !== 'all' && row.type !== certTypeFilter.toLowerCase()) return false;
    if (certStatusFilter !== 'all' && !(STATUS_FILTERS.find(item => item.key === certStatusFilter)?.match || [certStatusFilter as CertStatus]).includes(row.status)) return false;
    if (branchFilter && normBranchKey(row.branch) !== branchFilter) return false;
    if (ownerFilter && (row.ownerName || '') !== ownerFilter) return false;
    if (partyFilter && !String(row.collectionParty || '').split('، ').includes(partyFilter)) return false;
    return true;
  });

  const countOf = (match: CertStatus[]) => rows.filter(row => match.includes(row.status)).length;
  const hasFilters = certSearch || certTypeFilter !== 'all' || certStatusFilter !== 'all' || branchFilter || ownerFilter || partyFilter;
  // «صغر كل الفلاتر تكون علي صف واحد».
  const select = 'border border-gray-300 rounded-lg px-2 py-1.5 text-xs max-w-[150px] focus:outline-none focus:ring-2 focus:ring-primary-400';
  const th = 'text-right px-3 py-2.5 border border-gray-200 font-semibold text-xs whitespace-nowrap';
  const td = 'px-3 py-2 border border-gray-100 text-xs align-top';
  const input = 'mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm';

  return (
    <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap gap-1.5 border-b border-gray-200 pb-2 -mt-1">
          {([['requests', 'الطلبات'], ['institute', 'شهادات المعهد'], ['extras', 'طلبات إضافية'], ['pricing', 'الأسعار: شهادات وكارنيهات وكتب']] as const)
            .filter(([key]) => key !== 'pricing' || pricing).map(([key, label]) => (
            <button key={key} onClick={() => setInnerTab(key)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition ${innerTab === key ? 'bg-amber-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              {label}
            </button>
          ))}
      </div>

      {innerTab === 'institute' ? <InstituteCertificatesPanel notify={notify} /> : innerTab === 'extras' ? <ExtraRequestsPanel notify={notify} /> : pricing && innerTab === 'pricing' ? pricing : (<>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <Star size={18} className="text-amber-500" /> طلبات الشهادات
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">{filtered.length} / {rows.length} طلب</span>
            <button onClick={() => void load()} disabled={loading}
              className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} تحديث
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 lg:flex-nowrap">
          <div className="relative min-w-[170px] flex-1">
            <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input value={certSearch} onChange={e => setCertSearch(e.target.value)} placeholder="اسم، تليفون، كود، كورس…"
              className="w-full border border-gray-300 rounded-lg pr-7 pl-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary-400" />
          </div>
          <select value={certTypeFilter} onChange={e => setCertTypeFilter(e.target.value)} className={select} aria-label="نوع الشهادة">
            <option value="all">كل أنواع الشهادات</option>
            {certCatalog.types.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
          </select>
          <select value={certStatusFilter} onChange={e => setCertStatusFilter(e.target.value)} className={select} aria-label="الحالة">
            <option value="all">كل الحالات ({rows.length})</option>
            {STATUS_FILTERS.map(item => <option key={item.key} value={item.key}>{item.label} ({countOf(item.match)})</option>)}
          </select>
          <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className={select} aria-label="الفرع">
            <option value="">كل الفروع</option>
            {branches.map(branch => <option key={branch} value={branch}>{branchName(branch)}</option>)}
          </select>
          <select value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)} className={select} aria-label="المسئول">
            <option value="">كل المسئولين</option>
            {owners.map(owner => <option key={owner} value={owner}>{owner}</option>)}
          </select>
          <select value={partyFilter} onChange={e => setPartyFilter(e.target.value)} className={select} aria-label="جهة التحصيل">
            <option value="">كل جهات التحصيل</option>
            {parties.map(party => <option key={party} value={party}>{party}</option>)}
          </select>
          {hasFilters && (
            <button onClick={() => { setCertSearch(''); setCertTypeFilter('all'); setCertStatusFilter('all'); setBranchFilter(''); setOwnerFilter(''); setPartyFilter(''); }}
              className="text-[11px] font-bold px-2 py-1.5 rounded-lg bg-gray-100 text-gray-600 flex items-center gap-1 whitespace-nowrap">
              <X size={11} /> مسح
            </button>
          )}
        </div>

        {loading && !rows.length ? (
          <div className="py-16 text-center text-gray-400"><Loader2 size={20} className="mx-auto animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <Star size={36} className="mx-auto mb-3 text-gray-200" />
            <p>{rows.length === 0 ? 'لا توجد طلبات شهادات بعد' : 'لا توجد نتائج مطابقة للفلتر'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 border border-gray-200">
                  <th className={th}>العميل</th>
                  <th className={th}>التليفون</th>
                  <th className={th}>الفرع</th>
                  <th className={th}>نوع الشهادة</th>
                  <th className={th}>الكورس</th>
                  <th className={th}>الاسم على الشهادة</th>
                  <th className={th}>بيانات الشهادة</th>
                  <th className={th}>السعر</th>
                  <th className={th}>المدفوع</th>
                  <th className={th}>المتبقي</th>
                  <th className={th}>جهة التحصيل</th>
                  <th className={th}>المسئول</th>
                  <th className={th}>الحالة</th>
                  <th className={th}>ملاحظات</th>
                  <th className={th}>تاريخ الطلب</th>
                  <th className={th}>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, index) => {
                  const meta = STATUS_META[row.status] || STATUS_META.pending;
                  const busy = busyId === row.id;
                  return (
                    <tr key={row.id} className={`${index % 2 ? 'bg-gray-50/60' : 'bg-white'} hover:bg-amber-50/40 border border-gray-100`}>
                      <td className={td}>
                        <div className="font-bold text-gray-900">{row.subscriberName || '—'}</div>
                        {row.clientCode && <div className="text-[11px] text-gray-400" dir="ltr">{row.clientCode}</div>}
                      </td>
                      <td className={`${td} whitespace-nowrap`} dir="ltr">
                        {row.subscriberPhone ? <a href={`tel:${row.subscriberPhone}`} className="text-blue-600 hover:underline">{row.subscriberPhone}</a> : <span className="text-gray-300">—</span>}
                      </td>
                      <td className={`${td} whitespace-nowrap text-gray-600`}>{branchName(row.branch)}</td>
                      <td className={`${td} font-medium`}>
                        {certCatalog.label(row.type, row.customName)}
                        {row.nationality && <div className="text-[10px] text-gray-400">{NATIONALITIES[row.nationality] || row.nationality}</div>}
                      </td>
                      <td className={`${td} text-gray-600`}>{row.courseTitle || <span className="text-gray-300">—</span>}</td>
                      <td className={td}>
                        {!row.nameAr && !row.nameEn && row.nameSuggested ? (
                          <>
                            <div>{row.nameSuggested}</div>
                            <div className="text-[10px] text-gray-400">من اسم العميل</div>
                          </>
                        ) : !row.nameAr && !row.nameEn ? (
                          <span className="text-[11px] bg-red-100 text-red-600 font-bold px-2 py-0.5 rounded-full">⚠️ اسم فارغ — محتاج الاسم ثلاثي</span>
                        ) : (
                          <>
                            <div>{row.nameAr || '—'}</div>
                            <div className="text-gray-400" dir="ltr">{row.nameEn || ''}</div>
                          </>
                        )}
                      </td>
                      <td className={`${td} min-w-[150px]`}>
                        {(() => {
                          const missing = missingCertData(row);
                          const start = row.courseStartDate || row.suggestedStart;
                          const end = row.courseEndDate || row.suggestedEnd;
                          return (
                            <div className="space-y-0.5 text-[11px]">
                              {row.idNumber && <div className="font-mono text-gray-600" dir="ltr">{row.idNumber}</div>}
                              {(start || end) && (
                                <div className={row.courseStartDate || row.courseEndDate ? 'text-gray-600' : 'text-gray-400'} title={row.courseStartDate ? '' : 'من السيستم — اتأكد منه'}>
                                  {start || '؟'} ← {end || '؟'}
                                </div>
                              )}
                              {missing.length > 0 && <div className="font-bold text-red-600">ناقص: {missing.join('، ')}</div>}
                              <button disabled={busy} onClick={() => setCompleting(row)}
                                className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-40">
                                {missing.length ? 'تكملة البيانات' : 'تعديل البيانات'}
                              </button>
                            </div>
                          );
                        })()}
                      </td>
                      <td className={`${td} whitespace-nowrap font-bold text-primary-700`}>
                        {num(row.systemPrice ?? row.price)} {(row.systemPrice ?? row.price) != null ? row.currency : ''}
                        {row.systemPrice != null && row.price != null && Number(row.price) !== Number(row.systemPrice) && (
                          <div className="text-[10px] font-normal text-amber-700">مكتوب على الطلب {num(row.price)}</div>
                        )}
                      </td>
                      <td className={`${td} whitespace-nowrap font-bold text-emerald-700`}>{num(row.paid)}</td>
                      <td className={`${td} whitespace-nowrap`}>
                        {row.remaining == null ? <span className="text-[11px] text-amber-700">مفيش سعر في السيستم</span> : !row.complete
                          ? <span className="font-bold text-red-600">{num(row.remaining)}</span>
                          : <span className="text-[11px] font-bold text-green-600">مكتمل ✓</span>}
                      </td>
                      <td className={`${td} max-w-[160px] text-gray-600`}>{row.collectionParty || <span className="text-gray-300">—</span>}</td>
                      <td className={`${td} whitespace-nowrap text-gray-600`}>{row.ownerName || '—'}</td>
                      <td className={`${td} min-w-[150px]`}>
                        {UNPAID.includes(row.status) ? (
                          <div className="flex flex-col items-start gap-1">
                            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${meta.badge}`}>{meta.label}</span>
                            {/* A certificate is not taken forward on money not paid. */}
                            {row.subscriberId && (
                              <button disabled={busy} onClick={() => navigate(`/client/${row.clientCode || row.subscriberId}?pay=cert:${row.id}`)}
                                className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-700 disabled:opacity-40">
                                <CreditCard size={10} /> دفع{row.remaining ? ` ${num(row.remaining)}` : ''}
                              </button>
                            )}
                          </div>
                        ) : (
                          <select value={row.status === 'not_sent' ? 'paid' : row.status} disabled={busy}
                            onChange={event => void changeStatus(row, event.target.value as CertStatus)}
                            className={`rounded-lg border-0 px-2 py-1 text-[11px] font-bold ${meta.badge} disabled:opacity-50`} aria-label="حالة الشهادة">
                            {PAID_STAGES.map(stage => <option key={stage} value={stage}>{STATUS_META[stage].label}</option>)}
                          </select>
                        )}
                      </td>
                      <td className={`${td} max-w-[200px] text-gray-600`}>
                        <span className="line-clamp-3" title={row.adminNote || ''}>{row.adminNote || <span className="text-gray-300">—</span>}</span>
                      </td>
                      <td className={`${td} whitespace-nowrap text-gray-400`}>{row.requestedAt ? cairoDay(row.requestedAt) : '—'}</td>
                      <td className={td}>
                        <div className="flex items-center gap-1">
                          {canManage && (
                            <button onClick={() => setEditing({ row, draft: draftOf(row) })} disabled={busy} title="تعديل الشهادة (للمديرين)"
                              className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition"><Pencil size={14} /></button>
                          )}
                          {row.subscriberId && (
                            <button onClick={() => navigate(`/client/${row.clientCode || row.subscriberId}`)} title="ملف العميل"
                              className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg transition"><ExternalLink size={14} /></button>
                          )}
                          {canManage && (
                            <button onClick={() => void remove(row)} disabled={busy} title="حذف الشهادة (للمديرين)"
                              className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition"><Trash2 size={14} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </>)}

      {completing && (
        <CertDataModal row={completing} notify={notify} onClose={() => setCompleting(null)}
          onSaved={() => { setCompleting(null); void load(); }} />
      )}
      {editing && (
        <Modal open onClose={() => setEditing(null)} size="lg" title={`تعديل شهادة — ${editing.row.subscriberName}`}
          icon={<Pencil size={16} className="text-indigo-600" />}
          footer={(
            <>
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-xl text-sm font-bold border border-gray-200 text-gray-600">إلغاء</button>
              <button disabled={busyId === editing.row.id} onClick={() => void saveEdit()}
                className="px-5 py-2 rounded-xl text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">حفظ التعديل</button>
            </>
          )}>
          {(() => {
            const d = editing.draft;
            const set = (key: keyof EditDraft) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
              setEditing(prev => (prev ? { ...prev, draft: { ...prev.draft, [key]: event.target.value } } : prev));
            return (
              <div className="grid grid-cols-1 gap-3 text-xs font-bold text-gray-600 sm:grid-cols-2">
                <label>الاسم بالعربي<input value={d.nameAr} onChange={set('nameAr')} className={input} /></label>
                <label>الاسم بالإنجليزي<input value={d.nameEn} onChange={set('nameEn')} dir="ltr" className={input} /></label>
                <label>نوع الشهادة
                  <select value={d.type} onChange={set('type')} className={input}>
                    {certCatalog.types.map(({ key, label }) => <option key={key} value={key.toUpperCase()}>{label}</option>)}
                  </select>
                </label>
                <label>اسم الشهادة (لو «أخرى»)<input value={d.customName} onChange={set('customName')} className={input} /></label>
                <label>الكورس
                  <select value={d.courseId} onChange={set('courseId')} className={input}>
                    <option value="">—</option>
                    {courses.map(course => <option key={course.id} value={course.id}>{course.titleAr || course.title}</option>)}
                  </select>
                </label>
                <label>الجنسية
                  <select value={d.nationality} onChange={set('nationality')} className={input}>
                    <option value="">—</option>
                    {Object.entries(NATIONALITIES).map(([key, label]) => <option key={key} value={key.toUpperCase()}>{label}</option>)}
                  </select>
                </label>
                <label>رقم البطاقة<input value={d.idNumber} onChange={set('idNumber')} dir="ltr" className={input} /></label>
                <label>جهة التحصيل
                  <input value={d.collectionParty} onChange={set('collectionParty')} list="cert-parties" placeholder="خزنة الدقي، فودافون كاش …" className={input} />
                  <datalist id="cert-parties">{parties.map(party => <option key={party} value={party} />)}</datalist>
                </label>
                <label>السعر ({editing.row.currency})<input type="number" min="0" value={d.price} onChange={set('price')} className={input} /></label>
                <label>المدفوع<input type="number" min="0" value={d.paidAmount} onChange={set('paidAmount')} className={input} /></label>
                <label className="sm:col-span-2">ملاحظات
                  <textarea value={d.adminNote} onChange={set('adminNote')} rows={3} className={input} />
                </label>
                {editing.row.note && (
                  <p className="sm:col-span-2 rounded-xl bg-gray-50 p-2 text-[11px] font-normal leading-5 text-gray-500">{editing.row.note}</p>
                )}
                <p className="sm:col-span-2 text-[11px] font-normal text-gray-400">السعر والمدفوع بيتعدلوا هنا لو مفيش دفعة مربوطة بالشهادة — لو فيه، بيتعدلوا من الدفعة نفسها. التعديل بيتسجل في هيستوري العميل باسمك.</p>
              </div>
            );
          })()}
        </Modal>
      )}
    </article>
  );
}
