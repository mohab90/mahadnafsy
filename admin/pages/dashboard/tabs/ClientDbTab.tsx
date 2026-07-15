import React, { useMemo, useState } from 'react';
import {
  Search, Users, UserCheck, UserPlus, MessageSquare,
  CreditCard, Download, ExternalLink, BookOpen, CheckSquare, Square,
} from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { useBranches } from '../../../hooks/useBranches';
import { useNavigate } from 'react-router-dom';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

// clientType: raw value from DB (e.g. 'ONLINE_LOCAL_NEW', 'LEAD_INTL_OLD', null)
type ClientRow = {
  id: string;
  clientCode: string;
  name: string;
  phone: string;
  email: string;
  type: 'subscriber' | 'lead';
  clientType: string | null;  // new taxonomy e.g. ONLINE_LOCAL_NEW
  subType: 'online' | 'daqqi' | 'regular' | null; // derived for filters/stats
  status: string;
  branch: string;
  createdAt: string;
  totalPaid: number;
  assignedSalesName: string;
  courseNames: string;
  courseIds: string[];
};

function normPhone(p: string) {
  return (p || '').replace(/\D/g, '').replace(/^(002|00)?20/, '').replace(/^0/, '');
}

function waLink(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  const intl = digits.startsWith('20') ? digits : digits.startsWith('0') ? `2${digits}` : `20${digits}`;
  return `https://wa.me/${intl}`;
}

// Map: clientType → { Arabic label, entity category, badge color }
const CLIENT_TYPE_INFO: Record<string, { label: string; entity: string; color: string }> = {
  ONLINE_LOCAL_NEW: { label: 'أونلاين محلي جديد',   entity: 'مشترك',       color: 'bg-blue-100 text-blue-700'     },
  ONLINE_LOCAL_OLD: { label: 'أونلاين محلي قديم',    entity: 'مشترك',       color: 'bg-blue-100 text-blue-700'     },
  ONLINE_SAUDI_NEW: { label: 'أونلاين سعودي جديد',  entity: 'مشترك',       color: 'bg-sky-100 text-sky-700'       },
  ONLINE_SAUDI_OLD: { label: 'أونلاين سعودي قديم',   entity: 'مشترك',       color: 'bg-sky-100 text-sky-700'       },
  ONLINE_ABROAD:    { label: 'أونلاين دولي',         entity: 'مشترك',       color: 'bg-cyan-100 text-cyan-700'     },
  DAQQI_NEW:        { label: 'دقي جديد',             entity: 'مشترك',       color: 'bg-violet-100 text-violet-700' },
  DAQQI_OLD:        { label: 'دقي قديم',             entity: 'مشترك',       color: 'bg-violet-100 text-violet-700' },
  QATAMIYA:         { label: 'القطامية',             entity: 'مشترك',       color: 'bg-emerald-100 text-emerald-700'},
  LEAD_LOCAL_NEW:   { label: 'محلي جديد',            entity: 'عميل محتمل',  color: 'bg-amber-100 text-amber-700'   },
  LEAD_LOCAL_OLD:   { label: 'محلي قديم',            entity: 'عميل محتمل',  color: 'bg-amber-100 text-amber-700'   },
  LEAD_INTL_NEW:    { label: 'دولي جديد',            entity: 'عميل محتمل',  color: 'bg-orange-100 text-orange-700' },
  LEAD_INTL_OLD:    { label: 'دولي قديم',            entity: 'عميل محتمل',  color: 'bg-orange-100 text-orange-700' },
};

// Derive legacy subType from clientType for filters/stats
function getSubType(branch: string, clientType?: string | null): 'online' | 'daqqi' | 'regular' {
  if (clientType) {
    const ct = clientType.toUpperCase();
    if (ct === 'QATAMIYA') return 'regular';
    if (ct.startsWith('DAQQI')) return 'daqqi';
    if (ct.startsWith('ONLINE') || ct.startsWith('LEAD_LOCAL') || ct.startsWith('LEAD_INTL')) return 'online';
  }
  const b = (branch || '').toUpperCase();
  if (!b || b === 'OTHER') return 'online';
  if (b.startsWith('DAQQI') || b === 'TAGAMOA') return 'daqqi';
  if (b.startsWith('ONLINE')) return 'online';
  if (b === 'QATAMIYA') return 'regular';
  return 'online';
}

// Fallback labels when no clientType set
const SUB_TYPE_LABEL: Record<string, string> = {
  online: 'مشترك أونلاين',
  daqqi: 'مشترك الدقي',
  regular: 'مشترك',
};
const SUB_TYPE_COLOR: Record<string, string> = {
  online: 'bg-blue-100 text-blue-700',
  daqqi: 'bg-violet-100 text-violet-700',
  regular: 'bg-emerald-100 text-emerald-700',
};

export default function ClientDbTab({ notify, onBook }: { notify: NotifyFn; onBook?: (id: string, type: 'subscriber' | 'lead') => void }) {
  const { subscribers, leads, courses, bundles, staffScopedSubscribers, staffScopedLeads } = useSiteData();
  // Staff-scoped data is populated from the original DB rows by Dashboard's fetchSalesData.
  // Prefer it whenever available so full-access staff roles (online manager) do not fall back to a separate admin-only context path.
  const effectiveSubs = staffScopedSubscribers.length > 0 ? staffScopedSubscribers : subscribers;
  const effectiveLeads = staffScopedLeads.length > 0 ? staffScopedLeads : leads;
  const branches = useBranches();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'subscriber' | 'subscriber_online' | 'subscriber_daqqi' | 'subscriber_regular' | 'lead' | 'lead_local' | 'lead_intl'>('all');
  const [branchFilter, setBranchFilter] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [sort, setSort] = useState<'date_desc' | 'date_asc' | 'name_asc' | 'amount_desc'>('date_desc');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // Multi-select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const allClients: ClientRow[] = useMemo(() => {
    const subPhones = new Set(
      effectiveSubs.map(s => normPhone(s.phone)).filter(p => p.length >= 7)
    );
    const subEmails = new Set(
      effectiveSubs
        .map(s => (s.email || '').toLowerCase())
        .filter(e => e && !e.endsWith('@lead.local'))
    );

    const rawSubs: ClientRow[] = effectiveSubs.map(s => ({
      id: s.id,
      clientCode: s.clientCode || '',
      name: s.name,
      phone: s.phone || '',
      email: s.email || '',
      type: 'subscriber' as const,
      subType: getSubType(s.branch || '', (s as unknown as Record<string, string>).clientType),
      clientType: (s as unknown as Record<string, string>).clientType || null,
      status: 'مشترك',
      branch: s.branch || '',
      createdAt: s.createdAt || '',
      totalPaid: Math.round(
        (s.paymentHistory || []).reduce(
          (sum: number, p: { currency: string; amount: number }) =>
            sum + (p.currency === 'SAR' ? p.amount * 13 : p.currency === 'USD' ? p.amount * 50 : p.amount),
          0
        )
      ),
      assignedSalesName: s.assignedSalesName || '',
      courseIds: s.enrolledCourseIds || [],
      courseNames: (() => {
        // Extract bundle names from payment history
        const bundleNames = (s.paymentHistory || [])
          .map((p: { note?: string; itemTitle?: string }) => {
            const txt = p.note || p.itemTitle || '';
            const m = txt.match(/مسار(?:\s+تعليمي)?[:\s]+(.+)/);
            return m ? `📦 ${m[1].trim()}` : null;
          })
          .filter((v): v is string => !!v);
        const uniqueBundles = [...new Set(bundleNames)];
        const courseNamesArr = (s.enrolledCourseIds || [])
          .map((id: string) => courses.find(c => c.id === id)?.title)
          .filter((t): t is string => !!t);
        return [...uniqueBundles, ...courseNamesArr].join('، ');
      })(),
    }));

    const rawLeads: ClientRow[] = effectiveLeads
      .filter(l => {
        const lp = normPhone(l.phone);
        const le = (l.email || '').toLowerCase();
        const dupSub =
          (lp.length >= 7 && subPhones.has(lp)) ||
          (le && !le.endsWith('@lead.local') && subEmails.has(le));
        return !dupSub;
      })
      .map(l => ({
        id: l.id,
        clientCode: l.clientCode || '',
        name: l.name,
        phone: l.phone || '',
        email: l.email || '',
        type: 'lead' as const,
        clientType: (l as unknown as Record<string, string>).clientType || null,
        subType: null,
        status: l.status || 'new',
        branch: l.branch || '',
        createdAt: l.createdAt || '',
        totalPaid: 0,
        assignedSalesName: l.assignedSalesName || '',
        courseIds: [l.enrolledCourseId, ...(l.interestedCourseIds || [])].filter(Boolean) as string[],
        courseNames: [l.enrolledCourseId, ...(l.interestedCourseIds || [])]
          .filter(Boolean)
          .map(id => courses.find(c => c.id === id)?.title)
          .filter(Boolean)
          .join('، '),
      }));

    return [...rawSubs, ...rawLeads];
  }, [effectiveSubs, effectiveLeads, courses]);

  const allCourseOptions = useMemo(() => {
    const ids = new Set(allClients.flatMap(c => c.courseIds));
    return courses
      .filter(c => ids.has(c.id))
      .map(c => ({ id: c.id, title: c.title }))
      .sort((a, b) => a.title.localeCompare(b.title, 'ar'));
  }, [allClients, courses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');

    return allClients
      .filter(c => {
        if (typeFilter === 'subscriber' && c.type !== 'subscriber') return false;
        if (typeFilter === 'subscriber_online' && (c.type !== 'subscriber' || c.subType !== 'online')) return false;
        if (typeFilter === 'subscriber_daqqi' && (c.type !== 'subscriber' || c.subType !== 'daqqi')) return false;
        if (typeFilter === 'subscriber_regular' && (c.type !== 'subscriber' || c.subType !== 'regular')) return false;
        if (typeFilter === 'lead' && c.type !== 'lead') return false;
        if (typeFilter === 'lead_local' && (c.type !== 'lead' || !c.clientType?.includes('LOCAL'))) return false;
        if (typeFilter === 'lead_intl' && (c.type !== 'lead' || !c.clientType?.includes('INTL'))) return false;
        if (branchFilter && c.branch?.toUpperCase() !== branchFilter) return false;
        if (courseFilter && !c.courseIds.includes(courseFilter)) return false;
        if (q) {
          const nameMatch = c.name.toLowerCase().includes(q);
          const phoneMatch = qDigits.length >= 4 && normPhone(c.phone).includes(qDigits);
          const emailMatch = c.email.toLowerCase().includes(q);
          const codeMatch = c.clientCode.toLowerCase().includes(q);
          if (!nameMatch && !phoneMatch && !emailMatch && !codeMatch) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sort === 'name_asc') return a.name.localeCompare(b.name, 'ar');
        if (sort === 'amount_desc') return b.totalPaid - a.totalPaid;
        if (sort === 'date_asc') return a.createdAt.localeCompare(b.createdAt);
        return b.createdAt.localeCompare(a.createdAt);
      });
  }, [allClients, search, typeFilter, branchFilter, courseFilter, sort]);

  // Always use settings branches; fall back to raw values only if settings empty
  const branchOptions = useMemo(() => {
    if (branches.length > 0) {
      return branches.map(b => ({ value: b.id.toUpperCase(), label: b.label }));
    }
    return [...new Set(allClients.map(c => c.branch).filter(Boolean))]
      .map(b => ({ value: b.toUpperCase(), label: b }));
  }, [branches, allClients]);

  function branchLabel(branchRaw: string) {
    const up = (branchRaw || '').toUpperCase();
    return branchOptions.find(b => b.value === up)?.label || branchRaw || '—';
  }

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageRowKeys = pageRows.map(c => `${c.type}-${c.id}`);
  const allPageSelected = pageRowKeys.length > 0 && pageRowKeys.every(k => selectedIds.has(k));

  const stats = useMemo(() => ({
    total: allClients.length,
    subscribers: allClients.filter(c => c.type === 'subscriber').length,
    online: allClients.filter(c => c.subType === 'online').length,
    daqqi: allClients.filter(c => c.subType === 'daqqi').length,
    leads: allClients.filter(c => c.type === 'lead').length,
  }), [allClients]);

  function toggleSelect(key: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function togglePageAll() {
    if (allPageSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        pageRowKeys.forEach(k => next.delete(k));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        pageRowKeys.forEach(k => next.add(k));
        return next;
      });
    }
  }

  function exportSelectedCSV() {
    const rows = filtered.filter(c => selectedIds.has(`${c.type}-${c.id}`));
    const header = 'الاسم,الكود,الهاتف,الإيميل,النوع,الفرع,الكورسات,المدفوع,المبيعات,التاريخ';
    const lines = rows.map(c =>
      [c.name, c.clientCode, c.phone, c.email,
       (() => { const ti = c.clientType ? CLIENT_TYPE_INFO[c.clientType] : null; return ti ? `${ti.label} - ${ti.entity}` : (c.subType ? SUB_TYPE_LABEL[c.subType] : 'عميل محتمل'); })(),
       c.branch, `"${c.courseNames}"`, c.totalPaid, c.assignedSalesName, c.createdAt.slice(0,10)
      ].join(',')
    );
    const csv = '\uFEFF' + [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'clients_export.csv'; a.click();
    URL.revokeObjectURL(url);
    notify('success', `تم تصدير ${rows.length} عميل`);
  }

  return (
    <div className="space-y-4 animate-fade-in" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-2xl p-5 text-white">
        <h2 className="text-xl font-extrabold flex items-center gap-2">
          <Users size={22} /> قاعدة العملاء الموحدة
        </h2>
        <p className="text-emerald-100 text-xs mt-1">جميع المشتركين والعملاء المحتملين في مكان واحد</p>
        <div className="flex gap-3 mt-3 flex-wrap">
          {[
            { label: 'الإجمالي', value: stats.total, icon: Users },
            { label: 'مشتركون', value: stats.subscribers, icon: UserCheck },
            { label: 'أونلاين', value: stats.online },
            { label: 'الدقي', value: stats.daqqi },
            { label: 'محتملون', value: stats.leads, icon: UserPlus },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white/20 rounded-xl px-3 py-1.5 text-center">
              <p className="text-lg font-black">{value.toLocaleString()}</p>
              <p className="text-xs opacity-90">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-2xl p-3 shadow-sm">
        <div className="flex flex-wrap gap-2 items-center">
          {/* Search — compact */}
          <div className="relative w-48">
            <Search size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="اسم / هاتف / كود..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); setSelectedIds(new Set()); }}
              className="w-full border border-gray-200 rounded-lg pr-8 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300"
            />
          </div>

          {/* Type filter with online/daqqi distinction */}
          <select
            value={typeFilter}
            onChange={e => { setTypeFilter(e.target.value as typeof typeFilter); setPage(0); setSelectedIds(new Set()); }}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300"
          >
            <option value="all">كل الأنواع</option>
            <option value="subscriber">مشتركون (كل)</option>
            <option value="subscriber_online">مشتركون أونلاين</option>
            <option value="subscriber_daqqi">مشتركو الدقي</option>
            <option value="subscriber_regular">مشتركو القطامية</option>
            <option value="lead">عملاء محتملون (كل)</option>
            <option value="lead_local">عملاء محتملون محليون</option>
            <option value="lead_intl">عملاء محتملون دوليون</option>
          </select>

          {/* Branch filter */}
          {branchOptions.length > 1 && (
            <select
              value={branchFilter}
              onChange={e => { setBranchFilter(e.target.value); setPage(0); setSelectedIds(new Set()); }}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300"
            >
              <option value="">كل الفروع</option>
              {branchOptions.map(b => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
          )}

          {/* Course filter */}
          {allCourseOptions.length > 0 && (
            <select
              value={courseFilter}
              onChange={e => { setCourseFilter(e.target.value); setPage(0); setSelectedIds(new Set()); }}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300 max-w-[160px]"
            >
              <option value="">كل الكورسات</option>
              {allCourseOptions.map(c => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          )}

          {/* Sort */}
          <select
            value={sort}
            onChange={e => { setSort(e.target.value as typeof sort); setPage(0); }}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300"
          >
            <option value="date_desc">الأحدث أولاً</option>
            <option value="date_asc">الأقدم أولاً</option>
            <option value="name_asc">أبجدي</option>
            <option value="amount_desc">الأعلى دفعاً</option>
          </select>

          <span className="text-xs text-gray-500 font-medium mr-auto">
            {filtered.length.toLocaleString()} نتيجة
          </span>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2.5 flex items-center gap-3 flex-wrap">
          <span className="text-indigo-700 font-bold text-sm">{selectedIds.size} عميل محدد</span>
          <button
            onClick={exportSelectedCSV}
            className="flex items-center gap-1.5 bg-indigo-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition"
          >
            <Download size={13} /> تصدير CSV
          </button>
          <button
            onClick={() => {
              const phones = filtered
                .filter(c => selectedIds.has(`${c.type}-${c.id}`) && c.phone)
                .map(c => c.phone)
                .join('\n');
              navigator.clipboard.writeText(phones).then(() => notify('success', 'تم نسخ الأرقام'));
            }}
            className="flex items-center gap-1.5 bg-green-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-green-700 transition"
          >
            <MessageSquare size={13} /> نسخ الأرقام
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-gray-500 text-xs hover:text-gray-700 mr-auto"
          >
            إلغاء التحديد
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" dir="rtl">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {/* Checkbox col */}
                <th className="px-3 py-3 text-center w-8">
                  <button onClick={togglePageAll} className="text-gray-400 hover:text-indigo-600 transition" title="تحديد الكل في الصفحة">
                    {allPageSelected
                      ? <CheckSquare size={15} className="text-indigo-600" />
                      : <Square size={15} />}
                  </button>
                </th>
                <th className="px-3 py-3 text-right font-bold text-gray-600 text-xs w-24">الكود</th>
                <th className="px-3 py-3 text-right font-bold text-gray-600 text-xs">الاسم</th>
                <th className="px-3 py-3 text-right font-bold text-gray-600 text-xs">النوع</th>
                <th className="px-3 py-3 text-right font-bold text-gray-600 text-xs">الهاتف</th>
                <th className="px-3 py-3 text-right font-bold text-gray-600 text-xs">الفرع</th>
                <th className="px-3 py-3 text-right font-bold text-gray-600 text-xs">الكورسات</th>
                <th className="px-3 py-3 text-center font-bold text-gray-600 text-xs">المدفوع</th>
                <th className="px-3 py-3 text-center font-bold text-gray-600 text-xs">التاريخ</th>
                <th className="px-3 py-3 text-center font-bold text-gray-600 text-xs">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-16 text-gray-400">
                    <Users size={32} className="mx-auto mb-2 opacity-30" />
                    <p>لا توجد نتائج</p>
                  </td>
                </tr>
              )}
              {pageRows.map(c => {
                const rowKey = `${c.type}-${c.id}`;
                const isSelected = selectedIds.has(rowKey);
                const wa = waLink(c.phone);
                const profilePath = `/client/${c.clientCode || c.id}`;
                const typeInfo = c.clientType ? CLIENT_TYPE_INFO[c.clientType] : null;
                const typeLabel = typeInfo
                  ? typeInfo.label
                  : (c.subType ? SUB_TYPE_LABEL[c.subType] : 'عميل محتمل');
                const typeColor = typeInfo
                  ? typeInfo.color
                  : (c.subType ? SUB_TYPE_COLOR[c.subType] : 'bg-amber-100 text-amber-700');
                const entityLabel = typeInfo
                  ? typeInfo.entity
                  : (c.type === 'subscriber' ? 'مشترك' : 'عميل محتمل');
                return (
                  <tr key={rowKey} className={`transition ${isSelected ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
                    {/* Checkbox */}
                    <td className="px-3 py-3 text-center">
                      <button onClick={() => toggleSelect(rowKey)} className="text-gray-400 hover:text-indigo-600 transition">
                        {isSelected
                          ? <CheckSquare size={15} className="text-indigo-600" />
                          : <Square size={15} />}
                      </button>
                    </td>
                    {/* Client code — first column */}
                    <td className="px-3 py-3">
                      {c.clientCode
                        ? <span className="text-xs text-indigo-500 font-mono bg-indigo-50 px-1.5 py-0.5 rounded">#{c.clientCode}</span>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    {/* Name + email */}
                    <td className="px-3 py-3">
                      <button
                        onClick={() => navigate(profilePath)}
                        className="font-semibold text-indigo-700 hover:text-indigo-900 hover:underline text-sm text-right transition"
                      >
                        {c.name}
                      </button>
                      {c.email && !c.email.endsWith('@lead.local') && (
                        <div className="text-xs text-gray-400 mt-0.5 truncate max-w-[160px]" title={c.email}>{c.email}</div>
                      )}
                    </td>
                    {/* Type badge */}
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${typeColor}`}>
                          {typeLabel}
                        </span>
                        <span className="text-[10px] text-gray-400 pr-1">{entityLabel}</span>
                      </div>
                    </td>
                    {/* Phone */}
                    <td className="px-3 py-3 text-gray-600 text-xs font-mono">{c.phone || '—'}</td>
                    {/* Branch */}
                    <td className="px-3 py-3 text-gray-500 text-xs">
                      {branchLabel(c.branch)}
                    </td>
                    {/* Courses */}
                    <td className="px-3 py-3 text-gray-600 text-xs max-w-[150px] truncate" title={c.courseNames}>
                      {c.courseNames
                        ? <span className="flex items-center gap-1"><BookOpen size={11} className="text-gray-400 shrink-0" />{c.courseNames}</span>
                        : '—'}
                    </td>
                    {/* Total paid */}
                    <td className="px-3 py-3 text-center font-bold text-emerald-700 text-sm">
                      {c.totalPaid > 0 ? `${c.totalPaid.toLocaleString()} ج` : '—'}
                    </td>
                    {/* Date */}
                    <td className="px-3 py-3 text-center text-gray-400 text-xs">
                      {c.createdAt ? c.createdAt.slice(0, 10) : '—'}
                    </td>
                    {/* Actions */}
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5 justify-center">
                        {/* Open profile */}
                        <button
                          onClick={() => navigate(profilePath)}
                          className="p-1.5 rounded-lg text-indigo-500 hover:bg-indigo-50 hover:text-indigo-700 transition"
                          title="فتح ملف العميل"
                        >
                          <ExternalLink size={13} />
                        </button>
                        {/* WhatsApp */}
                        {wa && (
                          <a
                            href={wa}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 hover:text-green-700 transition"
                            title="واتس أب"
                          >
                            <MessageSquare size={13} />
                          </a>
                        )}
                        {/* Booking/payment — all client types */}
                        <button
                          onClick={() => onBook ? onBook(c.id, c.type) : navigate(profilePath, { state: { openTab: 'payments' } })}
                          className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 transition"
                          title="حجز / دفعة"
                        >
                          <CreditCard size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 text-xs font-bold bg-white border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition"
            >
              السابق
            </button>
            <span className="text-xs text-gray-500">
              صفحة {page + 1} من {totalPages} ({filtered.length.toLocaleString()} نتيجة)
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              className="px-3 py-1.5 text-xs font-bold bg-white border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition"
            >
              التالي
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
