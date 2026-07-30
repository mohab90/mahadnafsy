import React from 'react';
import { ExternalLink, Eye, EyeOff, Phone, Trash2, Wallet } from 'lucide-react';
import { useResizableCols } from '../../../components/useResizableCols';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import type { BranchType, Bundle, LeadItem, LeadStatus, SubscriberItem } from '../../../types';
import { BRANCH_ENUM_LABELS, ROTTEN_CFG, STATUS_CFG, getRottenLevel } from './leadUtils';
import { crmStatusLabels } from '../dashboardShared';

const LEAD_STATUS_CFG = STATUS_CFG;

const crmSourceLabels: Record<string, { label: string; color: string }> = {
  'واتساب': { label: 'واتساب', color: 'bg-green-100 text-green-800' },
  'فيسبوك': { label: 'فيسبوك', color: 'bg-blue-100 text-blue-800' },
  'إنستغرام': { label: 'إنستغرام', color: 'bg-pink-100 text-pink-800' },
  'توصية': { label: 'توصية', color: 'bg-amber-100 text-amber-800' },
  'الموقع': { label: 'الموقع', color: 'bg-indigo-100 text-indigo-800' },
  'جوجل': { label: 'جوجل', color: 'bg-red-100 text-red-800' },
  'شات الـAI': { label: 'AI', color: 'bg-purple-100 text-purple-800' },
  'تسجيل دخول': { label: 'تسجيل', color: 'bg-gray-100 text-gray-700' },
  'Google Sheet': { label: 'Sheet', color: 'bg-teal-100 text-teal-800' },
  'أخرى': { label: 'أخرى', color: 'bg-gray-100 text-gray-600' },
};

const normBranchId = (v: string | null | undefined): string => {
  if (!v) return '';
  return String(v).trim().toUpperCase().replace(/[\s-]+/g, '_');
};

type LeadTableProps = {
  rows: (LeadItem & { _score?: number })[];
  showCourseCol: boolean;
  courses: { id: string; title: string; price?: { EGP: number } }[];
  bundles: Bundle[];
  navigate: (path: string) => void;
  updateLead: (item: LeadItem) => void | Promise<boolean>;
  reloadLeads: () => void | Promise<void>;
  deleteLead: (id: string) => void;
  addSubscriber: (item: SubscriberItem) => Promise<boolean>;
  updateSubscriber: (item: SubscriberItem) => void;
  subscribers: SubscriberItem[];
  salesStaff: { id: string; name: string }[];
  isSalesOnly: boolean;
  canManageLeads: boolean;
  onSalesClick?: (salesId: string) => void;
  onBook: (row: LeadItem) => void;
  branchOptions: { id: string; label: string }[];
  sources: string[];
};

export const LeadTable: React.FC<LeadTableProps> = ({ rows, showCourseCol, courses, bundles, navigate, updateLead, reloadLeads, deleteLead, subscribers, salesStaff, isSalesOnly, canManageLeads, onSalesClick, onBook, branchOptions, sources }) => {
  // Deduplicated branch options: merge instituteBranches with ENUM fallbacks without duplicates
  const mergedBranchOpts = React.useMemo(() => {
    const enumEntries = Object.entries(BRANCH_ENUM_LABELS).map(([id, label]) => ({ id, label }));
    if (branchOptions.length > 0) {
      const seen = new Set(branchOptions.map(b => normBranchId(b.id)));
      const extras = enumEntries.filter(e => !seen.has(normBranchId(e.id)));
      return [...branchOptions, ...extras];
    }
    return enumEntries;
  }, [branchOptions]);
  const leadsCol = useResizableCols('leads', { name: 180, source: 110, courses: 160, notes: 180, branch: 100, sales: 110, status: 120, createdAt: 120, followup: 110 });
  const [contactRow, setContactRow] = React.useState<LeadItem | null>(null);
  const [contactDraft, setContactDraft] = React.useState({ type: 'call' as 'call' | 'whatsapp' | 'email' | 'meeting' | 'note', date: new Date().toISOString().slice(0, 16), notes: '', outcome: '', nextFollowUp: '', newStatus: '' as LeadStatus | '', lostReason: '' });
  const [historyRow, setHistoryRow] = React.useState<LeadItem | null>(null);
  const [waMenuRow, setWaMenuRow] = React.useState<LeadItem | null>(null);

  const handleSaveContact = async () => {
    if (!contactRow || !contactDraft.notes.trim()) return;
    const freshLead = rows.find(r => r.id === contactRow.id) || contactRow;
    const lostReason = contactDraft.lostReason;
    const notesWithReason = lostReason
      ? `[سبب الخسارة: ${lostReason}] ${contactDraft.notes}`
      : contactDraft.notes;
    const newStatus: LeadStatus = (contactDraft.newStatus as LeadStatus) || (freshLead.status === 'new' ? 'contacted' : freshLead.status);
    try {
      await mysqlAdmin.addLeadInteraction(freshLead.id, {
        type: contactDraft.type,
        date: contactDraft.date.replace('T', ' '),
        notes: notesWithReason,
        outcome: contactDraft.outcome || undefined,
        nextFollowUp: contactDraft.nextFollowUp || undefined,
        newStatus,
      });
      await reloadLeads();
      setContactRow(null);
      setContactDraft({ type: 'call', date: new Date().toISOString().slice(0, 16), notes: '', outcome: '', nextFollowUp: '', newStatus: '', lostReason: '' });
    } catch (error) {
      window.dispatchEvent(new CustomEvent('site-persist-error', {
        detail: {
          field: 'lead-interaction',
          name: error instanceof Error ? error.message : freshLead.id,
        },
      }));
    }
  };

  const openHistory = async (row: LeadItem) => {
    setHistoryRow(row);
    try {
      const result = await mysqlAdmin.getLeadInteractions(row.id);
      setHistoryRow(current => current?.id === row.id
        ? {
            ...current,
            communications: result.communications as LeadItem['communications'],
            communicationCount: Math.max(current.communicationCount || 0, result.communications.length),
          }
        : current);
    } catch (error) {
      window.dispatchEvent(new CustomEvent('site-persist-error', {
        detail: {
          field: 'lead-interactions-read',
          name: error instanceof Error ? error.message : row.id,
        },
      }));
    }
  };

  // ─── Bulk selection state ───────────────────────────────────────────
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = React.useState<LeadStatus | ''>('');
  const [bulkSalesId, setBulkSalesId] = React.useState('');
  // ─── Pagination state ────────────────────────────────────────────────
  const PAGE_SIZE = 100;
  const [currentPage, setCurrentPage] = React.useState(0);
  // Reset to page 0 when rows change (filter/search)
  const prevRowsLenRef = React.useRef(rows.length);
  if (prevRowsLenRef.current !== rows.length) { prevRowsLenRef.current = rows.length; if (currentPage !== 0) setCurrentPage(0); }
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const tableBodyRef = React.useRef<HTMLDivElement>(null);

  const toggleSelect = (id: string) =>
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleSelectAll = () =>
    setSelectedIds(prev => prev.length === pageRows.length ? [] : pageRows.map(r => r.id));
  const handleBulkApply = async () => {
    const updates = rows.filter(r => selectedIds.includes(r.id)).map(r => {
      const updates: Partial<typeof r> = {};
      if (bulkStatus) updates.status = bulkStatus;
      if (bulkSalesId) {
        const s = salesStaff.find(x => x.id === bulkSalesId);
        updates.assignedSalesId = bulkSalesId;
        updates.assignedSalesName = s?.name || '';
      }
      return Object.keys(updates).length > 0 ? updateLead({ ...r, ...updates }) : Promise.resolve(true);
    });
    const results = await Promise.all(updates);
    if (results.some(result => result === false)) return;
    setSelectedIds([]);
    setBulkStatus('');
    setBulkSalesId('');
  };
  return (
    <>
      {/* ─── Bulk Action Bar ─── */}
      {canManageLeads && selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-primary-50 border border-primary-200 rounded-xl px-4 py-3 mb-3">
          <span className="text-sm font-bold text-primary-700">{selectedIds.length} عميل محدد</span>
          <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value as LeadStatus | '')}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
            <option value="">تغيير الحالة...</option>
            <option value="new">جديد</option>
            <option value="interested_booking">✅ مهتم بالحجز</option>
            <option value="interested_followup">📅 مهتم ومتابعة</option>
            <option value="postpone_month">⏳ هيأجل أكتر من شهر</option>
            <option value="not_interested">❌ مش مهتم</option>
            <option value="no_answer_wa">🔇 لا يرد وبعتله واتس</option>
            <option value="no_answer_nowa">🔕 لا يرد ومفيش واتس</option>
            <option value="wrong_number">⛔ الرقم غلط/مقفول دائماً</option>
            <option value="with_colleague">🤝 مع زميل آخر</option>
            <option value="not_interested_hidden">🙈 مش مهتم ومخفي</option>
            <option value="other">📌 أخرى</option>
            <option value="converted">تحول لمشترك</option>
          </select>
          {!isSalesOnly && (
            <select value={bulkSalesId} onChange={e => setBulkSalesId(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
              <option value="">تعيين سيلز...</option>
              {salesStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <button
            onClick={handleBulkApply}
            disabled={!bulkStatus && !bulkSalesId}
            className="px-4 py-1.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white text-sm font-bold rounded-lg transition"
          >تطبيق</button>
          <button onClick={() => setSelectedIds([])} className="text-xs text-gray-500 hover:text-gray-700 underline">إلغاء التحديد</button>
        </div>
      )}
      <div ref={tableBodyRef} className="overflow-auto rounded-xl" style={{ maxHeight: '70vh', direction: 'rtl' }}>
        <table className="w-full min-w-[1100px] text-sm border-collapse table-fixed">
          <thead>
            <tr className="bg-gray-50 text-gray-700 text-xs">
              <th className="px-3 py-2.5 border border-gray-200 w-8 relative">
                {canManageLeads && (
                  <input type="checkbox" checked={pageRows.length > 0 && pageRows.every(r => selectedIds.includes(r.id))}
                    onChange={toggleSelectAll} className="cursor-pointer" />
                )}
              </th>
              <th style={{ width: leadsCol.colWidth('name') }} className="text-right px-3 py-2.5 border border-gray-200 font-semibold relative">الاسم<span className="resize-handle" onMouseDown={e => leadsCol.startResize('name', e)} /></th>
              <th style={{ width: leadsCol.colWidth('createdAt') }} className="text-right px-3 py-2.5 border border-gray-200 font-semibold relative">تاريخ التسجيل<span className="resize-handle" onMouseDown={e => leadsCol.startResize('createdAt', e)} /></th>
              <th style={{ width: leadsCol.colWidth('source') }} className="text-right px-3 py-2.5 border border-gray-200 font-semibold relative">المصدر<span className="resize-handle" onMouseDown={e => leadsCol.startResize('source', e)} /></th>
              {showCourseCol && <th style={{ width: leadsCol.colWidth('courses') }} className="text-right px-3 py-2.5 border border-gray-200 font-semibold relative">الكورسات<span className="resize-handle" onMouseDown={e => leadsCol.startResize('courses', e)} /></th>}
              <th style={{ width: leadsCol.colWidth('branch') }} className="text-right px-3 py-2.5 border border-gray-200 font-semibold relative">الفرع<span className="resize-handle" onMouseDown={e => leadsCol.startResize('branch', e)} /></th>
              {!isSalesOnly && <th style={{ width: leadsCol.colWidth('sales') }} className="text-right px-3 py-2.5 border border-gray-200 font-semibold relative">السيلز<span className="resize-handle" onMouseDown={e => leadsCol.startResize('sales', e)} /></th>}
              <th style={{ width: leadsCol.colWidth('status') }} className="text-right px-3 py-2.5 border border-gray-200 font-semibold relative">الحالة<span className="resize-handle" onMouseDown={e => leadsCol.startResize('status', e)} /></th>
              <th style={{ width: leadsCol.colWidth('notes') }} className="text-right px-3 py-2.5 border border-gray-200 font-semibold relative">ملاحظات<span className="resize-handle" onMouseDown={e => leadsCol.startResize('notes', e)} /></th>
              <th style={{ width: leadsCol.colWidth('followup') }} className="text-right px-3 py-2.5 border border-gray-200 font-semibold relative">المتابعة القادمة<span className="resize-handle" onMouseDown={e => leadsCol.startResize('followup', e)} /></th>
              <th className="text-right px-3 py-2.5 border border-gray-200 font-semibold sticky left-0 bg-gray-50 z-10 w-[90px]">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, idx) => {
              const commCount = row.communicationCount ?? row.communications?.length ?? 0;
              const interestedCourseIds = [...new Set([...(row.interestedCourseIds || []), ...(row.enrolledCourseId ? [row.enrolledCourseId] : [])])];
              const sourceMeta = crmSourceLabels[row.source] || null;
              // ── CRM metrics ──
              const agingDays = row.createdAt
                ? Math.floor((Date.now() - new Date(row.createdAt.replace(/\//g, '-').replace(' ', 'T')).getTime()) / 86_400_000)
                : 0;
              const lastCommEntry = row.communications?.length
                ? [...row.communications].sort((a, b) => b.date.localeCompare(a.date))[0]
                : null;
              const daysSinceContact = lastCommEntry
                ? Math.floor((Date.now() - new Date(lastCommEntry.date.slice(0, 10)).getTime()) / 86_400_000)
                : null;
              const isStale = agingDays > 14 && !['converted', 'lost', 'not_interested'].includes(row.status);
              const rottenLv = getRottenLevel(row);
              const rottenCfg = ROTTEN_CFG[rottenLv];
              return (
                <tr
                  key={row.id}
                  className={`hover:bg-primary-50/30 transition-colors ${row.hidden ? 'opacity-50' : ''} ${selectedIds.includes(row.id) ? 'bg-primary-50/50' : idx % 2 === 1 ? 'bg-gray-50/70' : 'bg-white'} ${rottenLv >= 3 ? 'border-r-[3px] border-r-red-500' : rottenLv === 2 ? 'border-r-[3px] border-r-orange-500' : rottenLv === 1 ? 'border-r-[3px] border-r-yellow-400' : isStale ? 'border-r-2 border-r-orange-300' : ''}`}>
                  <td className="px-3 py-2 border border-gray-200 text-center">
                    {canManageLeads && (
                      <input type="checkbox" checked={selectedIds.includes(row.id)} onChange={() => toggleSelect(row.id)} className="cursor-pointer" />
                    )}
                  </td>
                  {/* ── Name ── */}
                  <td className="px-3 py-2 border border-gray-200">
                    <div className="font-bold text-gray-800 text-xs whitespace-nowrap flex items-center gap-1">
                      {row.name}
                      {rottenLv > 0 && (
                        <span title={`لم يُتواصل منذ ${daysSinceContact ?? agingDays} يوم`}
                          className={`text-[9px] font-bold px-1 py-0.5 rounded-full border ${rottenCfg.badge} flex-shrink-0`}>
                          {rottenCfg.label}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <a href={`tel:${row.phone}`} className="text-blue-600 hover:underline text-xs font-mono font-semibold">{row.phone}</a>
                    </div>
                    {row.status === 'converted' && (() => {
                      const sub = subscribers.find((s) =>
                        s.leadId === row.id ||
                        (row.phone && row.phone.length > 5 && s.phone === row.phone) ||
                        (row.email && row.email.length > 3 && s.email === row.email)
                      );
                      return sub ? (
                        <button onClick={() => navigate(`/client/${sub.clientCode || sub.id}`)}
                          className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full mt-1 inline-flex items-center gap-1 hover:bg-emerald-100">
                          ✓ مشترك
                        </button>
                      ) : null;
                    })()}
                  </td>
                  {/* ── Created At ── */}
                  <td className="px-3 py-2 border border-gray-200 text-xs whitespace-nowrap">
                    {row.createdAt
                      ? <>
                          <div className="text-[11px] text-gray-700 font-medium">{row.createdAt.slice(0, 10)}</div>
                          <div className="text-[10px] text-gray-400">{row.createdAt.length > 10 ? row.createdAt.slice(11, 16) : ''}</div>
                        </>
                      : <span className="text-gray-300">—</span>
                    }
                  </td>
                  {/* ── Source ── */}
                  <td className="px-3 py-2 border border-gray-200 text-xs">
                    <div className="flex flex-wrap items-center gap-1">
                      {sourceMeta
                        ? <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${sourceMeta.color}`}>{sourceMeta.label}</span>
                        : row.source
                          ? <span className="text-[11px] text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">{row.source}</span>
                          : <span className="text-gray-300 text-[11px]">—</span>
                      }
                      {row.fbLeadId && (
                        <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">🔵 FB</span>
                      )}
                    </div>
                    {canManageLeads && (
                      <select
                        value={row.source || ''}
                        onChange={(e) => updateLead({ ...row, source: e.target.value })}
                        className="mt-1 block border-0 bg-transparent text-[10px] text-gray-400 cursor-pointer focus:ring-0 focus:outline-none w-full"
                      >
                        <option value="">تغيير المصدر...</option>
                        {sources.map(src => <option key={src} value={src}>{src}</option>)}
                      </select>
                    )}
                  </td>
                  {/* ── Courses (multiselect) — renamed to الكورسات ── */}
                  {showCourseCol && (
                    <td className="px-3 py-2 border border-gray-200 text-xs min-w-[150px]">
                      {/* Show complete bundles as bundle badge, partial enrollments as individual course badges */}
                      {(() => {
                        const completeBundles = bundles.filter(b => b.courses.length > 0 && b.courses.every(co => interestedCourseIds.includes(co.id)));
                        const hiddenCourseIds = new Set(completeBundles.flatMap(b => b.courses.map(co => co.id)));
                        const partialCourseIds = interestedCourseIds.filter(id => !hiddenCourseIds.has(id));
                        return (
                          <>
                            <div className="flex flex-wrap gap-1 mb-1">
                              {partialCourseIds.map(cid => {
                                let displayTitle: string;
                                if (cid.startsWith('bundle:')) {
                                  const bId = cid.replace('bundle:', '');
                                  displayTitle = bundles.find(b => b.id === bId)?.title || bundles.find(b => b.id === cid)?.title || cid;
                                } else {
                                  displayTitle = courses.find(x => x.id === cid)?.title || bundles.find(b => b.id === cid)?.title || cid;
                                }
                                return (
                                  <span key={cid} className="inline-flex items-center gap-1 text-[10px] bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5">
                                    <span className="truncate max-w-[90px]">{displayTitle}</span>
                                    {canManageLeads && (
                                      <button onClick={() => updateLead({ ...row, interestedCourseIds: interestedCourseIds.filter(x => x !== cid) })}
                                        className="text-blue-400 hover:text-red-500 font-bold leading-none">×</button>
                                    )}
                                  </span>
                                );
                              })}
                            </div>
                            {completeBundles.map(b => (
                              <span key={b.id} className="inline-flex items-center text-[10px] bg-purple-50 text-purple-700 border border-purple-200 rounded-full px-2 py-0.5 mb-1 mr-1">
                                📌 {b.title}
                              </span>
                            ))}
                          </>
                        );
                      })()}
                      {canManageLeads && interestedCourseIds.length < 10 && (
                        <select
                          value=""
                          onChange={(e) => {
                            if (!e.target.value) return;
                            if (e.target.value.startsWith('bundle:')) {
                              const bundleId = e.target.value.slice(7);
                              const bnd = bundles.find(b => b.id === bundleId);
                              if (bnd) {
                                const next = [...new Set([...interestedCourseIds, ...bnd.courses.map(c => c.id)])];
                                updateLead({ ...row, interestedCourseIds: next });
                              }
                            } else {
                              const next = [...new Set([...interestedCourseIds, e.target.value])];
                              updateLead({ ...row, interestedCourseIds: next });
                            }
                          }}
                          className="border border-gray-200 rounded-lg px-2 py-1 text-[10px] w-full bg-white text-gray-600 focus:ring-0"
                        >
                          <option value="">+ إضافة كورس / باقة</option>
                          {bundles.length > 0 && (
                            <optgroup label="📌 الباقات">
                              {bundles.map(b => (
                                <option key={b.id} value={`bundle:${b.id}`}>{b.title}</option>
                              ))}
                            </optgroup>
                          )}
                          <optgroup label="🎓 الكورسات">
                            {courses.filter(c => !interestedCourseIds.includes(c.id)).map(c => (
                              <option key={c.id} value={c.id}>{c.title}</option>
                            ))}
                          </optgroup>
                        </select>
                      )}
                    </td>
                  )}
                  {/* ── Branch ── */}
                  <td className="px-3 py-2 border border-gray-200 text-xs" style={{ width: leadsCol.colWidth('branch') }}>
                    {(() => {
                      const selectedId = mergedBranchOpts.find(b =>
                        normBranchId(b.id) === normBranchId(row.branch) ||
                        b.label === row.branch ||
                        normBranchId(b.label) === normBranchId(row.branch)
                      )?.id ?? '';
                      return canManageLeads ? (
                        <select
                          value={selectedId}
                          onChange={(e) => updateLead({ ...row, branch: (e.target.value || undefined) as BranchType | undefined })}
                          className="border-0 bg-transparent text-xs w-24 cursor-pointer text-gray-700 focus:ring-0 focus:outline-none">
                          <option value="">— الفرع —</option>
                          {mergedBranchOpts.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                        </select>
                      ) : (
                        <span>{mergedBranchOpts.find(b => b.id === selectedId)?.label || row.branch || '—'}</span>
                      );
                    })()}
                  </td>
                  {/* ── Sales ── */}
                  {!isSalesOnly && (
                  <td className="px-3 py-2 border border-gray-200 min-w-[100px]">
                    {row.assignedSalesId && row.assignedSalesName && (
                      onSalesClick ? (
                        <button
                          onClick={() => onSalesClick(row.assignedSalesId!)}
                          className="text-[11px] font-bold text-primary-700 bg-primary-50 border border-primary-200 px-2 py-0.5 rounded-full mb-1 hover:bg-primary-100 transition block w-full text-right truncate"
                        >
                          👤 {row.assignedSalesName}
                        </button>
                      ) : (
                        <span className="text-[11px] font-bold text-primary-700 bg-primary-50 border border-primary-200 px-2 py-0.5 rounded-full mb-1 block w-full text-right truncate">
                          👤 {row.assignedSalesName}
                        </span>
                      )
                    )}
                    {canManageLeads && (
                      <select value={row.assignedSalesId || ''} onChange={(e) => {
                        const s = salesStaff.find((x) => x.id === e.target.value);
                        updateLead({ ...row, assignedSalesId: e.target.value || undefined, assignedSalesName: s?.name || '' });
                      }} className="border-0 bg-transparent text-xs w-full cursor-pointer text-gray-500 focus:ring-0 focus:outline-none">
                        <option value="">— تغيير السيلز —</option>
                        {salesStaff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    )}
                  </td>
                  )}
                  {/* ── Status ── */}
                  <td className="px-3 py-2 border border-gray-200 min-w-[130px]">
                    <span className={`inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full border ${LEAD_STATUS_CFG[row.status as LeadStatus]?.color || 'bg-gray-100 border-gray-200 text-gray-600'}`}>
                      {crmStatusLabels[row.status] || row.status}
                    </span>
                    {commCount > 0 && (
                      <button onClick={() => { void openHistory(row); }}
                        className="text-[10px] text-blue-600 hover:underline mt-1 block">
                        📋 {commCount} تواصل
                      </button>
                    )}
                  </td>
                  {/* ── Notes (last communication) ── */}
                  <td className="px-3 py-2 border border-gray-200 text-xs max-w-[160px]">
                    {(() => {
                      const lastComm = [...(row.communications || [])].sort((a, b) => b.date.localeCompare(a.date))[0];
                      const display = lastComm ? `${lastComm.date.slice(0, 10)}: ${lastComm.notes}` : (row.notes || row.lastContactNote || '');
                      return display
                        ? <p className="text-gray-600 text-[11px] leading-snug line-clamp-3 whitespace-pre-wrap break-words">{display}</p>
                        : <span className="text-gray-300 text-[11px]">—</span>;
                    })()}
                  </td>
                  {/* ── Next Follow-Up Date ── */}
                  <td className="px-3 py-2 border border-gray-200 text-xs whitespace-nowrap" style={{ width: leadsCol.colWidth('followup') }}>
                    {row.nextFollowUpDate ? (() => {
                      const td = new Date().toISOString().slice(0, 10);
                      const isOverdue = row.nextFollowUpDate < td;
                      const isToday = row.nextFollowUpDate === td;
                      return (
                        <span className={`inline-flex items-center gap-1 font-bold text-[11px] px-2 py-0.5 rounded-full border ${
                          isOverdue ? 'bg-red-50 border-red-200 text-red-600' :
                          isToday   ? 'bg-orange-50 border-orange-200 text-orange-600' :
                                      'bg-blue-50 border-blue-200 text-blue-600'
                        }`}>
                          {isOverdue ? '⚠️' : isToday ? '🔔' : '📅'} {row.nextFollowUpDate}
                        </span>
                      );
                    })() : <span className="text-gray-300">—</span>}
                  </td>
                  {/* ── Actions ── */}
                  <td className={`px-0.5 py-1 border border-gray-200 sticky left-0 z-10 shadow-[3px_0_5px_-2px_rgba(0,0,0,0.08)] w-[64px] ${selectedIds.includes(row.id) ? 'bg-primary-50/50' : idx % 2 === 1 ? 'bg-gray-50/70' : 'bg-white'}`}>
                    <div className="grid grid-cols-3 gap-0.5">
                      <button onClick={() => navigate(`/client/${row.clientCode || row.id}`)} title="ملف العميل" className="h-6 w-6 rounded-md text-gray-400 hover:text-primary-600 flex items-center justify-center transition"><ExternalLink size={13}/></button>
                      {canManageLeads && <button onClick={() => { setContactRow(row); setContactDraft({ type: 'call', date: new Date().toISOString().slice(0, 16), notes: '', outcome: '', nextFollowUp: '', newStatus: '', lostReason: '' }); }} title="تسجيل تواصل" className="h-6 w-6 rounded-md text-gray-400 hover:text-blue-600 flex items-center justify-center transition"><Phone size={13}/></button>}
                      <button onClick={() => setWaMenuRow(row)} title="واتساب" className="h-6 w-6 rounded-md text-gray-400 hover:text-green-600 flex items-center justify-center transition">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
                      </button>
                      {canManageLeads && <button onClick={() => onBook(row)} title="حجز ودفع" className="h-6 w-6 rounded-md text-gray-400 hover:text-emerald-600 flex items-center justify-center transition"><Wallet size={13}/></button>}
                      {canManageLeads && <button onClick={() => updateLead({ ...row, hidden: !row.hidden })} title={row.hidden ? 'إظهار' : 'إخفاء'} className={`h-6 w-6 rounded-md flex items-center justify-center transition ${row.hidden ? 'text-amber-500' : 'text-gray-300 hover:text-gray-500'}`}>
                        {row.hidden ? <Eye size={13}/> : <EyeOff size={13}/>}
                      </button>}
                      {canManageLeads && !isSalesOnly ? (
                        <button onClick={() => deleteLead(row.id)} title="حذف" className="h-6 w-6 rounded-md text-gray-300 hover:text-red-500 flex items-center justify-center transition"><Trash2 size={13}/></button>
                      ) : <span />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="text-sm text-gray-400 mt-4 text-center py-6">لا توجد نتائج.</p>}
      </div>

      {/* ── Pagination controls ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 px-1">
          <span className="text-xs text-gray-500">
            {rows.length} عميل — عرض {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, rows.length)}
          </span>
          <div className="flex items-center gap-1">
            <button disabled={safePage === 0} onClick={() => setCurrentPage(0)}
              className="px-2 py-1 text-xs rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-40 font-bold">«</button>
            <button disabled={safePage === 0} onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
              className="px-3 py-1 text-xs rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-40">السابق</button>
            {Array.from({ length: totalPages }, (_, i) => i)
              .filter(i => Math.abs(i - safePage) <= 2)
              .map(i => (
                <button key={i} onClick={() => setCurrentPage(i)}
                  className={`px-2.5 py-1 text-xs rounded-lg font-bold ${i === safePage ? 'bg-primary-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>
                  {i + 1}
                </button>
              ))}
            <button disabled={safePage >= totalPages - 1} onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
              className="px-3 py-1 text-xs rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-40">التالي</button>
            <button disabled={safePage >= totalPages - 1} onClick={() => setCurrentPage(totalPages - 1)}
              className="px-2 py-1 text-xs rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-40 font-bold">»</button>
          </div>
        </div>
      )}

      {/* ── Contact log modal ── */}
      {contactRow && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setContactRow(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" dir="rtl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-4">تسجيل تواصل — {contactRow.name}</h3>
            <div className="space-y-3">
              {/* Status selector */}
              <div>
                <label className="text-xs font-bold text-gray-700 mb-1.5 block">نتيجة التواصل (الحالة الجديدة)</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {([
                    { value: 'interested_booking',   label: '✅ مهتم بالحجز',             color: 'border-green-400 bg-green-100 text-green-800' },
                    { value: 'interested_followup',  label: '📅 مهتم ومتابعة',            color: 'border-teal-300 bg-teal-50 text-teal-700' },
                    { value: 'postpone_month',       label: '⏳ هيأجل أكتر من شهر',      color: 'border-yellow-300 bg-yellow-50 text-yellow-800' },
                    { value: 'not_interested',       label: '❌ مش مهتم',                 color: 'border-red-300 bg-red-50 text-red-600' },
                    { value: 'no_answer_wa',         label: '🔇 لا يرد وبعتله واتس',      color: 'border-slate-300 bg-slate-50 text-slate-600' },
                    { value: 'no_answer_nowa',       label: '🔕 لا يرد ومفيش واتس',       color: 'border-gray-300 bg-gray-50 text-gray-600' },
                    { value: 'wrong_number',         label: '⛔ الرقم غلط/مقفول دائماً', color: 'border-orange-300 bg-orange-50 text-orange-700' },
                    { value: 'with_colleague',       label: '🤝 مع زميل آخر',             color: 'border-purple-300 bg-purple-50 text-purple-700' },
                    { value: 'not_interested_hidden',label: '🙈 مش مهتم ومخفي',          color: 'border-red-400 bg-red-100 text-red-800' },
                    { value: 'other',                label: '📌 أخرى',                    color: 'border-gray-300 bg-gray-50 text-gray-500' },
                  ] as const).map(opt => (
                    <button key={opt.value} type="button"
                      onClick={() => setContactDraft(d => ({ ...d, newStatus: d.newStatus === opt.value ? '' : opt.value }))}
                      className={`py-1.5 rounded-xl text-[11px] font-bold border-2 transition-all text-right px-2 ${contactDraft.newStatus === opt.value ? opt.color + ' ring-2 ring-offset-1 ring-current' : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {/* ── Lost Reason (appears when not_interested / not_interested_hidden / lost) ── */}
              {['not_interested', 'not_interested_hidden', 'lost'].includes(contactDraft.newStatus) && (
                <div>
                  <label className="text-xs font-bold text-red-700 mb-1 block">سبب عدم الاهتمام / الخسارة *</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { value: 'السعر مرتفع',               icon: '💰' },
                      { value: 'اختار منافس',                icon: '🏁' },
                      { value: 'مش وقته الآن',              icon: '⏰' },
                      { value: 'ظروف مالية',                 icon: '💸' },
                      { value: 'لم يرد على التواصل',         icon: '📵' },
                      { value: 'أخرى',                       icon: '📌' },
                    ].map(opt => (
                      <button key={opt.value} type="button"
                        onClick={() => setContactDraft(d => ({ ...d, lostReason: d.lostReason === opt.value ? '' : opt.value }))}
                        className={`py-1.5 rounded-xl text-[11px] font-bold border-2 transition-all text-right px-2 ${
                          contactDraft.lostReason === opt.value
                            ? 'border-red-400 bg-red-100 text-red-800 ring-2 ring-offset-1 ring-red-400'
                            : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                        }`}>
                        {opt.icon} {opt.value}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <select value={contactDraft.type} onChange={(e) => setContactDraft({...contactDraft, type: e.target.value as typeof contactDraft.type})}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="call">اتصال هاتفي</option>
                  <option value="whatsapp">واتس أب</option>
                  <option value="email">بريد إلكتروني</option>
                  <option value="meeting">لقاء شخصي</option>
                  <option value="note">ملاحظة</option>
                </select>
                <input type="datetime-local" value={contactDraft.date} onChange={(e) => setContactDraft({...contactDraft, date: e.target.value})}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <textarea rows={3} value={contactDraft.notes} onChange={(e) => setContactDraft({...contactDraft, notes: e.target.value})}
                placeholder="ماذا حصل في هذا التواصل؟ *"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <div>
                <label className={`text-xs mb-1 block font-medium ${
                  contactDraft.newStatus === 'interested' && !contactDraft.nextFollowUp ? 'text-red-600' : 'text-gray-500'
                }`}>
                  موعد التواصل القادم
                  {contactDraft.newStatus === 'interested' && !contactDraft.nextFollowUp && (
                    <span className="mr-1 text-red-500">⚠️ مطلوب عند التحديد كمهتم</span>
                  )}
                </label>
                <input type="date" value={contactDraft.nextFollowUp} onChange={(e) => setContactDraft({...contactDraft, nextFollowUp: e.target.value})}
                  className={`w-full border rounded-lg px-3 py-2 text-sm ${
                    contactDraft.newStatus === 'interested' && !contactDraft.nextFollowUp
                      ? 'border-red-400 bg-red-50 focus:border-red-500'
                      : 'border-gray-200'
                  }`} />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleSaveContact}
                  disabled={!contactDraft.notes.trim() || (contactDraft.newStatus === 'interested' && !contactDraft.nextFollowUp)}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-50"
                  title={contactDraft.newStatus === 'interested' && !contactDraft.nextFollowUp ? 'يجب تحديد موعد التواصل القادم عند تحديد الحالة كـ مهتم' : ''}
                >
                  حفظ التواصل
                </button>
                <button onClick={() => setContactRow(null)} className="flex-1 py-2.5 bg-gray-200 text-gray-700 rounded-xl text-sm hover:bg-gray-300">إلغاء</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Contact History modal ── */}
      {historyRow && (() => {
        // Use the live version of the lead from rows to always show fresh data
        const liveHistoryRow = historyRow;
        const typeMeta: Record<string, { label: string; icon: string; color: string }> = {
          call: { label: 'اتصال هاتفي', icon: '📞', color: 'bg-blue-50 border-blue-200 text-blue-700' },
          whatsapp: { label: 'واتس أب', icon: '💬', color: 'bg-green-50 border-green-200 text-green-700' },
          email: { label: 'بريد إلكتروني', icon: '📧', color: 'bg-purple-50 border-purple-200 text-purple-700' },
          meeting: { label: 'لقاء شخصي', icon: '🤝', color: 'bg-orange-50 border-orange-200 text-orange-700' },
          note: { label: 'ملاحظة', icon: '📝', color: 'bg-gray-50 border-gray-200 text-gray-700' },
        };
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setHistoryRow(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6" dir="rtl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900">تاريخ التواصل — {liveHistoryRow.name}</h3>
                <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{(liveHistoryRow.communications || []).length} سجل</span>
                <button onClick={() => setHistoryRow(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none mr-2">×</button>
              </div>
              {(liveHistoryRow.communications || []).length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-8">لا توجد سجلات تواصل بعد</p>
              ) : (
                <div className="space-y-3 max-h-[420px] overflow-y-auto pl-1">
                  {[...(liveHistoryRow.communications || [])].sort((a, b) => b.date.localeCompare(a.date)).map(c => {
                    const meta = typeMeta[c.type] || { label: c.type, icon: '📌', color: 'bg-gray-50 border-gray-200 text-gray-700' };
                    return (
                      <div key={c.id} className={`border rounded-xl p-3 ${meta.color}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold">{meta.icon} {meta.label}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-gray-400">{c.date.slice(0, 16)}</span>
                            {canManageLeads && <button
                              onClick={async () => {
                                if (!window.confirm('حذف سجل التواصل؟ سيظل حدث الحذف ظاهرًا في سجل التدقيق.')) return;
                                try {
                                  await mysqlAdmin.deleteLeadInteraction(liveHistoryRow.id, c.id);
                                  await reloadLeads();
                                  await openHistory(liveHistoryRow);
                                } catch (error) {
                                  window.dispatchEvent(new CustomEvent('site-persist-error', {
                                    detail: {
                                      field: 'lead-interaction',
                                      name: error instanceof Error ? error.message : c.id,
                                    },
                                  }));
                                }
                              }}
                              className="text-red-400 hover:text-red-600 hover:bg-red-50 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold transition"
                              title="حذف هذا التواصل"
                            >✕</button>}
                          </div>
                        </div>
                        <p className="text-sm text-gray-700 leading-relaxed">{c.notes}</p>
                        {c.outcome && <p className="text-[11px] text-gray-500 mt-1 border-t border-current/20 pt-1">النتيجة: {c.outcome}</p>}
                        {c.nextFollowUp && <p className="text-[11px] text-amber-600 font-medium mt-0.5">📅 متابعة: {c.nextFollowUp}</p>}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="mt-4 flex gap-2">
                {canManageLeads && <button onClick={() => { setContactRow(liveHistoryRow); setHistoryRow(null); setContactDraft({ type: 'call', date: new Date().toISOString().slice(0, 16), notes: '', outcome: '', nextFollowUp: '', newStatus: '', lostReason: '' }); }}
                  className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700">
                  <Phone size={13} className="inline ml-1" />إضافة تواصل جديد
                </button>}
                <button onClick={() => setHistoryRow(null)} className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-xl text-sm hover:bg-gray-300">إغلاق</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── WhatsApp Templates modal ── */}
      {waMenuRow && (() => {
        const waCourseIds = [...new Set([...(waMenuRow.interestedCourseIds || []), ...(waMenuRow.enrolledCourseId ? [waMenuRow.enrolledCourseId] : [])])];
        const waCourseName = waCourseIds.length > 0 ? (() => { const id = waCourseIds[0]; return id.startsWith('bundle:') ? (bundles.find(b => b.id === id.replace('bundle:', ''))?.title || 'برامجنا') : (courses.find(c => c.id === id)?.title || bundles.find(b => b.id === id)?.title || 'برامجنا'); })() : 'برامجنا';
        const firstName = waMenuRow.name.split(' ')[0];
        const waPhone = (() => { const d = waMenuRow.phone.replace(/\D/g, ''); return d.startsWith('0') ? '2' + d : d; })();
        const templates = [
          {
            cat: '🟢 تعريف وتواصل أولي',
            items: [
              {
                label: '👋 تعريف أولي',
                text: `السلام عليكم ورحمة الله 🌹\nتواصلنا معك بخصوص اهتمامك بـ "${waCourseName}" 💚\n\nهل أنت متاح لدقيقتين نعرفك فيها عن تفاصيل البرنامج؟`,
              },
              {
                label: '📞 بعد محاولة اتصال',
                text: `السلام عليكم ${firstName} 😊\nحاولت التواصل معك هاتفياً ولم أتمكن من الوصول إليك.\n\nراسلني هنا في أي وقت مناسب لك للحديث عن "${waCourseName}" 🎓`,
              },
            ],
          },
          {
            cat: '🔔 متابعة ومهتم',
            items: [
              {
                label: '🔔 تذكير متابعة',
                text: `السلام عليكم ${firstName} 😊\n\nأردت فقط الاطمئنان عليك — هل لديك أي استفسار عن "${waCourseName}"?\n\nنحن هنا للمساعدة في أي وقت! 🎓`,
              },
              {
                label: '📅 تأكيد موعد',
                text: `السلام عليكم ${firstName}\n\nنود تأكيد موعدك معنا للتعرف على "${waCourseName}".\n\nهل الوقت مناسب لك؟ 🙏`,
              },
              {
                label: '💡 معلومات إضافية',
                text: `السلام عليكم ${firstName} 🌟\n\nأرسل لك بعض المعلومات الإضافية عن "${waCourseName}" لمساعدتك في اتخاذ القرار:\n\n✔️ الوحدات والمحتوى\n✔️ الشهادة والاعتماد\n✔️ طرق الدفع المتاحة\n\nهل تريد معرفة المزيد؟`,
              },
            ],
          },
          {
            cat: '🎉 عروض وحوافز',
            items: [
              {
                label: '🎉 عرض خاص',
                text: `السلام عليكم ${firstName} 🎉\n\nلدينا عرض محدود المدة على "${waCourseName}"!\n\nتواصل معنا اليوم لتعرف التفاصيل — العرض ينتهي قريباً ⏰`,
              },
              {
                label: '🏆 قصة نجاح',
                text: `السلام عليكم ${firstName} 🌟\n\nأحببت مشاركتك قصة نجاح إحدى خريجات "${waCourseName}" لتتحفز وتكمل معنا الرحلة 💪\n\n[أضف قصة نجاح هنا]\n\nهل أنت مستعد/ة للبدء؟ 🎓`,
              },
            ],
          },
          {
            cat: '🔁 إعادة تفعيل',
            items: [
              {
                label: '💤 إعادة تفعيل بارد',
                text: `السلام عليكم ${firstName} 🌹\n\nمر علينا وقت منذ آخر تواصل — أردت التحقق من أنك بخير وإن كان لا يزال لديك اهتمام بـ "${waCourseName}".\n\nلا يوجد أي ضغط، فقط أُعلمنا إذا تغير شيء 😊`,
              },
              {
                label: '🆕 محتوى جديد',
                text: `السلام عليكم ${firstName}!\n\nلدينا تحديثات جديدة على برنامج "${waCourseName}" قد تهمك 🎯\n\nهل تود الاطلاع عليها؟`,
              },
            ],
          },
        ];
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setWaMenuRow(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" dir="rtl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-gray-900 flex items-center gap-2">📩 مكتبة رسائل واتساب</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {waMenuRow.name} — <span dir="ltr">{waMenuRow.phone}</span>
                    {waCourseName !== 'برامجنا' && <span className="mr-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-1.5 py-0.5">{waCourseName}</span>}
                  </p>
                </div>
                <button onClick={() => setWaMenuRow(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
              </div>
              <div className="space-y-4">
                {templates.map(cat => (
                  <div key={cat.cat}>
                    <p className="text-[11px] font-bold text-gray-500 mb-1.5 uppercase tracking-wide">{cat.cat}</p>
                    <div className="space-y-1.5">
                      {cat.items.map(t => (
                        <div key={t.label} className="flex items-center gap-2 p-2.5 rounded-xl border border-gray-200 hover:bg-green-50 hover:border-green-300 transition group">
                          <span className="text-sm font-bold text-gray-700 group-hover:text-green-700 flex-1">{t.label}</span>
                          <button
                            onClick={() => { navigator.clipboard?.writeText(t.text); }}
                            title="نسخ النص"
                            className="p-1 rounded-lg bg-gray-50 text-gray-400 hover:bg-gray-200 hover:text-gray-700 text-xs flex-shrink-0">
                            📋
                          </button>
                          <a
                            href={`https://wa.me/${waPhone}?text=${encodeURIComponent(t.text)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => setWaMenuRow(null)}
                            className="px-2.5 py-1 bg-green-500 text-white rounded-lg text-[11px] font-bold hover:bg-green-600 flex-shrink-0">
                            إرسال ↗
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {/* Quick direct WA */}
                <div className="pt-2 border-t border-gray-100">
                  <a
                    href={`https://wa.me/${waPhone}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setWaMenuRow(null)}
                    className="flex items-center justify-center gap-2 py-2.5 bg-green-500 text-white rounded-xl font-bold text-sm hover:bg-green-600 transition">
                    💬 فتح واتساب مباشرة
                  </a>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

    </>
  );
};

// ── Cert Pricing sub-component (extracted to avoid hooks-in-IIFE rule violation) ──
