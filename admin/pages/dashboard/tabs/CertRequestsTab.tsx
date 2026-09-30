import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Loader2, Pencil, RefreshCw, Search, Star, Trash2, Truck, X } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import type { Course } from '../../../types';
import { confirmDialog } from '../../../../shared/ui/confirmDialog';
import { Modal } from '../../../../shared/ui/Modal';
import { cairoDay } from '../../../../shared/cairoDate';
import { useCertificateCatalog } from '../../../lib/certificateCatalog';
import { branchLabels, normBranchKey } from '../../unified-client/constants';

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
  currency: string; collectionParty: string | null; note: string | null; adminNote: string | null;
  requestedAt: string | null; issuedAt: string | null;
};

type CertStatus = 'pending' | 'priced' | 'paid' | 'in_progress' | 'not_sent' | 'issued' | 'shipped' | 'at_branch' | 'delivered' | 'returned';

const STATUS_META: Record<CertStatus, { label: string; badge: string }> = {
  pending:     { label: 'تحت المراجعة',          badge: 'bg-gray-100 text-gray-600' },
  priced:      { label: 'مسعّرة',                badge: 'bg-amber-100 text-amber-700' },
  paid:        { label: 'مدفوعة',                badge: 'bg-blue-100 text-blue-700' },
  in_progress: { label: 'في الجهة المسئولة',     badge: 'bg-purple-100 text-purple-700' },
  not_sent:    { label: 'لسه متبعتتش للجهة',     badge: 'bg-orange-100 text-orange-700' },
  issued:      { label: 'جاهزة للشحن',           badge: 'bg-green-100 text-green-700' },
  shipped:     { label: 'مع شركة الشحن',         badge: 'bg-cyan-100 text-cyan-700' },
  returned:    { label: 'مرتجع',                 badge: 'bg-rose-100 text-rose-700' },
  at_branch:   { label: 'في الفرع',              badge: 'bg-teal-100 text-teal-700' },
  delivered:   { label: 'العميل استلمها',        badge: 'bg-emerald-100 text-emerald-800' },
};

// «قسم شهادات في الشحن»: ready to go, with the courier, or back from it.
const SHIPPING: CertStatus[] = ['issued', 'shipped', 'returned'];

// The next step from each status, as buttons — the server's own transitions
// (routes/certificates.js). The old status dropdown offered every status and
// the server refused most of them.
const NEXT: Partial<Record<CertStatus, Array<{ to: CertStatus; label: string; tone: string }>>> = {
  paid:        [{ to: 'in_progress', label: 'اتبعتت للجهة', tone: 'bg-purple-600' }],
  in_progress: [{ to: 'issued', label: 'جاهزة للشحن', tone: 'bg-green-600' }, { to: 'not_sent', label: 'لسه متبعتتش', tone: 'bg-orange-500' }],
  not_sent:    [{ to: 'in_progress', label: 'اتبعتت للجهة', tone: 'bg-purple-600' }, { to: 'issued', label: 'جاهزة للشحن', tone: 'bg-green-600' }],
  issued:      [{ to: 'shipped', label: 'اتسلمت لشركة الشحن', tone: 'bg-cyan-600' }, { to: 'at_branch', label: 'في الفرع', tone: 'bg-teal-600' }, { to: 'delivered', label: 'العميل استلمها', tone: 'bg-emerald-600' }],
  shipped:     [{ to: 'delivered', label: 'العميل استلمها', tone: 'bg-emerald-600' }, { to: 'returned', label: 'حصل مرتجع', tone: 'bg-rose-600' }],
  returned:    [{ to: 'shipped', label: 'اتشحنت تاني', tone: 'bg-cyan-600' }, { to: 'at_branch', label: 'في الفرع', tone: 'bg-teal-600' }, { to: 'delivered', label: 'العميل استلمها', tone: 'bg-emerald-600' }],
  at_branch:   [{ to: 'delivered', label: 'العميل استلمها', tone: 'bg-emerald-600' }],
};

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
  nameAr: row.nameAr || '', nameEn: row.nameEn || '', type: row.type.toUpperCase(), customName: row.customName || '',
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
  const [innerTab, setInnerTab] = useState<'requests' | 'pricing'>(pricing ? initialTab : 'requests');
  const certCatalog = useCertificateCatalog();
  const [rows, setRows] = useState<CertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [partyFilter, setPartyFilter] = useState('');
  const [editing, setEditing] = useState<{ row: CertRow; draft: EditDraft } | null>(null);

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
    if (certStatusFilter === 'shipping' ? !SHIPPING.includes(row.status) : certStatusFilter !== 'all' && row.status !== certStatusFilter) return false;
    if (branchFilter && normBranchKey(row.branch) !== branchFilter) return false;
    if (ownerFilter && (row.ownerName || '') !== ownerFilter) return false;
    if (partyFilter && !String(row.collectionParty || '').split('، ').includes(partyFilter)) return false;
    return true;
  });

  const chips: Array<{ key: string; label: string; color: string; val: number }> = [
    { key: 'shipping', label: '🚚 في الشحن', color: 'bg-cyan-50 text-cyan-800 border-cyan-200', val: rows.filter(row => SHIPPING.includes(row.status)).length },
    ...(Object.keys(STATUS_META) as CertStatus[]).map(status => ({
      key: status, label: STATUS_META[status].label, color: STATUS_META[status].badge, val: rows.filter(row => row.status === status).length,
    })),
  ];
  const hasFilters = certSearch || certTypeFilter !== 'all' || certStatusFilter !== 'all' || branchFilter || ownerFilter || partyFilter;
  const select = 'border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400';
  const th = 'text-right px-3 py-2.5 border border-gray-200 font-semibold text-xs whitespace-nowrap';
  const td = 'px-3 py-2 border border-gray-100 text-xs align-top';
  const input = 'mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm';

  return (
    <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
      {pricing && (
        <div className="flex flex-wrap gap-1.5 border-b border-gray-200 pb-2 -mt-1">
          {([['requests', 'الطلبات'], ['pricing', 'أسعار الشهادات الإضافية']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setInnerTab(key)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition ${innerTab === key ? 'bg-amber-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {pricing && innerTab === 'pricing' ? pricing : (<>
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

        <div className="flex flex-wrap gap-2">
          {chips.map(chip => (
            <button key={chip.key} onClick={() => setCertStatusFilter(certStatusFilter === chip.key ? 'all' : chip.key)}
              className={`text-xs font-bold px-3 py-1.5 rounded-full border transition ${certStatusFilter === chip.key ? 'ring-2 ring-offset-1 ring-primary-400' : ''} ${chip.color}`}>
              {chip.label}: {chip.val}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input value={certSearch} onChange={e => setCertSearch(e.target.value)} placeholder="ابحث بالاسم أو الهاتف أو الكود أو الكورس..."
              className="w-full border border-gray-300 rounded-xl pr-8 pl-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
          </div>
          <select value={certTypeFilter} onChange={e => setCertTypeFilter(e.target.value)} className={select} aria-label="نوع الشهادة">
            <option value="all">كل أنواع الشهادات</option>
            {certCatalog.types.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
          </select>
          <select value={certStatusFilter} onChange={e => setCertStatusFilter(e.target.value)} className={select} aria-label="الحالة">
            <option value="all">كل الحالات</option>
            <option value="shipping">🚚 في الشحن</option>
            {(Object.entries(STATUS_META) as [CertStatus, { label: string }][]).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
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
              className="text-xs font-bold px-3 py-2 rounded-xl bg-gray-100 text-gray-600 flex items-center gap-1">
              <X size={12} /> مسح الفلاتر
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
                  <th className={th}>الفرع</th>
                  <th className={th}>نوع الشهادة</th>
                  <th className={th}>الكورس</th>
                  <th className={th}>الاسم على الشهادة</th>
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
                        <div className="text-[11px] text-gray-400" dir="ltr">{row.clientCode || row.subscriberPhone}</div>
                      </td>
                      <td className={`${td} whitespace-nowrap text-gray-600`}>{branchName(row.branch)}</td>
                      <td className={`${td} font-medium`}>
                        {certCatalog.label(row.type, row.customName)}
                        {row.nationality && <div className="text-[10px] text-gray-400">{NATIONALITIES[row.nationality] || row.nationality}</div>}
                      </td>
                      <td className={`${td} text-gray-600`}>{row.courseTitle || <span className="text-gray-300">—</span>}</td>
                      <td className={td}>
                        {!row.nameAr && !row.nameEn ? (
                          <span className="text-[11px] bg-red-100 text-red-600 font-bold px-2 py-0.5 rounded-full">⚠️ اسم فارغ</span>
                        ) : (
                          <>
                            <div>{row.nameAr || '—'}</div>
                            <div className="text-gray-400" dir="ltr">{row.nameEn || ''}</div>
                          </>
                        )}
                      </td>
                      <td className={`${td} whitespace-nowrap font-bold text-primary-700`}>{num(row.price)} {row.price != null ? row.currency : ''}</td>
                      <td className={`${td} whitespace-nowrap font-bold text-emerald-700`}>{num(row.paid)}</td>
                      <td className={`${td} whitespace-nowrap`}>
                        {row.remaining == null ? '—' : row.remaining > 0
                          ? <span className="font-bold text-red-600">{num(row.remaining)}</span>
                          : <span className="text-[11px] font-bold text-green-600">مكتمل ✓</span>}
                      </td>
                      <td className={`${td} max-w-[160px] text-gray-600`}>{row.collectionParty || <span className="text-gray-300">—</span>}</td>
                      <td className={`${td} whitespace-nowrap text-gray-600`}>{row.ownerName || '—'}</td>
                      <td className={`${td} min-w-[150px]`}>
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${meta.badge}`}>{meta.label}</span>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {(NEXT[row.status] || []).map(step => (
                            <button key={step.to} disabled={busy} onClick={() => void changeStatus(row, step.to)}
                              className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold text-white ${step.tone} hover:opacity-90 disabled:opacity-40`}>
                              {step.to === 'shipped' && <Truck size={10} />}{step.label}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className={`${td} max-w-[200px] text-gray-600`}>
                        <span className="line-clamp-3" title={row.adminNote || ''}>{row.adminNote || <span className="text-gray-300">—</span>}</span>
                      </td>
                      <td className={`${td} whitespace-nowrap text-gray-400`}>{row.requestedAt ? cairoDay(row.requestedAt) : '—'}</td>
                      <td className={td}>
                        <div className="flex items-center gap-1">
                          <button onClick={() => setEditing({ row, draft: draftOf(row) })} disabled={busy} title="تعديل الشهادة"
                            className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition"><Pencil size={14} /></button>
                          {row.subscriberId && (
                            <button onClick={() => navigate(`/client/${row.clientCode || row.subscriberId}`)} title="ملف العميل"
                              className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg transition"><ExternalLink size={14} /></button>
                          )}
                          <button onClick={() => void remove(row)} disabled={busy} title="حذف الطلب"
                            className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition"><Trash2 size={14} /></button>
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
