import { useMemo, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { AlertCircle, Archive, Upload, Users } from 'lucide-react';
import type { Bundle, Course, LeadItem, LeadStatus, NewLeadDraft, StaffMember, SubscriberItem } from '../../../../types';
import type { NotifyFn } from '../CrmSettingsModal';
import { LeadTable } from '../LeadTable';
import { LEAD_STATUS_CFG, crmStatusLabels } from './LeadSubcomponents';
import { BRANCH_LABELS_AR, normalizeBranch, type BranchKey } from '../../../../constants/branches';
import { courseBadgeLabel, matchCourseOrBundle, toRawCourse } from './leadCourseLabel';
import {
  detectLayout, foldText, leadPhone, readSheetFile, sheetCellText,
  type SheetField, type SheetTab, type TabLayout,
} from '../../../../../shared/sheetImport';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

/**
 * Header keys are compared with separators and case stripped, so
 * "اختر_الفرع_", "اختر الفرع" and "الفرع" are all the same column, and
 * "phone_number" / "phone number" / "PhoneNumber" all match too. The previous
 * version compared raw lowercased headers, which is why a real export with a
 * `phone_number` column imported nothing: no alias matched, so every row failed
 * the name+phone requirement and was silently skipped.
 */
const normKey = (value: string) => String(value || '')
  .replace(/^\uFEFF/, '')
  .trim()
  .toLowerCase()
  .replace(/[_\s\-().[\]/\\]+/g, '');

/**
 * A sheet as it was read: its tabs, the one being imported, which column is which,
 * and which column holds the branch (the shared reader has no field for it).
 *
 * The screen used to cut the file with its own reader — UTF-8 text only, a short
 * list of exact heading spellings, one tab. A real sheet failed it three ways:
 * an .xlsx opened as garbage, a CSV saved by Arabic Excel (Windows-1256) read as
 * boxes, and a phone column called «رقم التليفون» matched nothing — and the only
 * sign was a preview full of «مطلوب». It reads through shared/sheetImport.ts now,
 * the reader the old-data screens already use, and the person can correct any
 * column that was guessed wrong.
 */
type ImportSheet = { tabs: SheetTab[]; tabIndex: number; layout: TabLayout; branchCol: number };
type LeadImportRow = Record<string, string>;
type LeadImportContext = { branchOptions: { id: string; label: string }[]; courses: Course[]; bundles: Bundle[] };

const IMPORT_FIELDS: Array<{ key: SheetField | 'branch'; label: string }> = [
  { key: 'name', label: 'الاسم' }, { key: 'phone', label: 'الهاتف' }, { key: 'email', label: 'الإيميل' },
  { key: 'course', label: 'الكورس' }, { key: 'notes', label: 'ملاحظات' }, { key: 'branch', label: 'الفرع' },
];

/** The column whose heading names a branch and which is not already something else. */
function branchColumnOf(tab: SheetTab, layout: TabLayout): number {
  if (layout.headerRow < 0) return -1;
  const taken = new Set(Object.values(layout.columns));
  return (tab.rows[layout.headerRow] || []).findIndex((heading, index) => !taken.has(index) && /فرع|branch/.test(foldText(heading)));
}

/** A column as the person sees it in the pickers: its heading, or its place and a sample. */
function columnLabel(tab: SheetTab, layout: TabLayout, index: number): string {
  const heading = layout.headerRow >= 0 ? sheetCellText(tab.rows[layout.headerRow]?.[index]) : '';
  const sample = sheetCellText(tab.rows[layout.headerRow + 1]?.[index]).slice(0, 18);
  return heading || `عمود ${index + 1}${sample ? ` (${sample})` : ''}`;
}

function buildLeadRows(sheet: ImportSheet, ctx: LeadImportContext): LeadImportRow[] {
  const tab = sheet.tabs[sheet.tabIndex];
  const { layout } = sheet;
  const columns = layout.columns;
  const text = (row: Array<string | number | null>, field: SheetField) => (columns[field] === undefined ? '' : sheetCellText(row[columns[field] as number]));
  return tab.rows.slice(layout.headerRow + 1).map((row, index) => {
    const { phone, others } = columns.phone === undefined ? { phone: '', others: [] as string[] } : leadPhone(row[columns.phone]);
    const notes = [text(row, 'notes'), others.length ? `أرقام أخرى: ${others.join(' ، ')}` : ''].filter(Boolean).join(' — ');
    const branchRaw = sheet.branchCol >= 0 ? sheetCellText(row[sheet.branchCol]) : '';
    const courseRaw = text(row, 'course');
    return {
      _id: `${tab.name}:${layout.headerRow + 2 + index}`,
      _name: text(row, 'name'),
      _phone: phone,
      _email: text(row, 'email').toLowerCase(),
      _notes: notes,
      _branchRaw: branchRaw,
      _courseRaw: courseRaw,
      // Resolved now (not at import time) so the preview can show whether each
      // branch/course actually matched before anything is written.
      _branchKey: matchBranch(branchRaw, ctx.branchOptions) || '',
      _courseId: matchCourseOrBundle(courseRaw, ctx.courses, ctx.bundles) || '',
    };
  }).filter(row => row._name || row._phone || row._email || row._notes);
}

/** Free-text branch from a sheet → canonical BranchKey, or null to keep raw. */
function matchBranch(raw: string, options: { id: string; label: string }[]): BranchKey | null {
  if (!raw) return null;
  const direct = normalizeBranch(raw);
  if (direct) return direct;
  const needle = normKey(raw);
  // Arabic label match, e.g. "الجيزة - الدقي" or "فرع الدقي" → DAQQI.
  for (const [key, label] of Object.entries(BRANCH_LABELS_AR)) {
    const hay = normKey(label);
    if (hay && (hay.includes(needle) || needle.includes(hay))) return key as BranchKey;
  }
  // Then the tenant's own configured branch list, if it has one.
  for (const option of options) {
    if (normKey(option.label) === needle || normKey(option.id) === needle) {
      return normalizeBranch(option.id);
    }
  }
  return null;
}

// Course matching lives in leadCourseLabel.ts — it also searches bundles and
// folds Arabic spelling variants, which plain normKey() could not.

export interface ArchiveTabProps {
  leads: LeadItem[];
  staffMembers: StaffMember[];
  addLead: (l: NewLeadDraft, opts?: { skipReload?: boolean }) => Promise<unknown>;
  updateLead: (l: LeadItem) => void | Promise<boolean>;
  reloadLeads: () => void | Promise<void>;
  notify: NotifyFn;
  courses: Course[];
  bundles: Bundle[];
  navigate: NavigateFunction;
  deleteLead: (id: string) => void | Promise<unknown>;
  addSubscriber: (s: SubscriberItem) => Promise<boolean>;
  updateSubscriber: (s: SubscriberItem) => void | Promise<unknown>;
  subscribers: SubscriberItem[];
  salesReps: StaffMember[];
  isSalesOnly: boolean;
  canManageLeads: boolean;
  onBook: (lead: LeadItem) => void;
  branchOptions: { id: string; label: string }[];
  sources: string[];
  title?: string;
  defaultSource?: string;
  /** The tab's name where it differs from the source its imports are stamped
   *  with — «داتا سعودي» stores its rows as «دولي قديم». */
  tabLabel?: string;
  customFilter?: (lead: LeadItem) => boolean;
  hideImport?: boolean;
  /**
   * Which of the three panels this instance shows.
   *
   * The screen was already exactly the three things a staff-built tab can
   * choose between — استيراد عملاء, توزيع, إظهار داتا — welded together and
   * gated as one by canManageLeads. Splitting the gate is what lets a
   * configured tab be this component rather than a new one: a tab that only
   * distributes is this with `import: false, data: false`.
   *
   * Omitted means all three, so every existing caller is unchanged. The desk
   * permission still applies on top: choosing to show a panel cannot hand it
   * to someone who could not open it before.
   */
  panels?: { import?: boolean; distribute?: boolean; data?: boolean };
  /** What the shared filter bar is currently asking for. Applied on top of this
   *  view's own source filter, so «محلي قديم» and «دولي» search, filter and sort
   *  exactly like the table view does. */
  matchesFilters?: (lead: LeadItem) => boolean;
  /** Clears the filter bar and the workspace branch, so the whole pool shows. */
  onShowAll?: () => void;
}
export function ArchiveTab({ leads, staffMembers, addLead, updateLead, reloadLeads, notify, courses, bundles, navigate, deleteLead, addSubscriber, updateSubscriber, subscribers, salesReps, isSalesOnly, canManageLeads, onBook, branchOptions, sources, title = 'محلي قديم — الاستيراد والتعيين الجماعي', defaultSource = 'محلي قديم', tabLabel, customFilter, hideImport = false, panels, matchesFilters, onShowAll }: ArchiveTabProps) {
  const [archiveSheet, setArchiveSheet] = useState<ImportSheet | null>(null);
  const [archiveParseErr, setArchiveParseErr] = useState('');
  const [archiveImporting, setArchiveImporting] = useState(false);
  const [archiveImportResult, setArchiveImportResult] = useState<{ created: number; dupes: number; errors: number } | null>(null);
  const [archiveSelectedIds, setArchiveSelectedIds] = useState<Set<string>>(new Set());
  const [archiveSource, setArchiveSource] = useState(defaultSource);
  const tabName = tabLabel || defaultSource;
  const [bulkAssignSrc, setBulkAssignSrc] = useState('');
  const [bulkAssignRole, setBulkAssignRole] = useState<'sales' | 'collection'>('sales');
  const [bulkSelectedLeadIds, setBulkSelectedLeadIds] = useState<Set<string>>(new Set());
  const [bulkAssigning2, setBulkAssigning2] = useState(false);
  const [bulkQuantity, setBulkQuantity] = useState('');
  // Where imported / distributed rows should live. 'archive' keeps them grouped
  // under this tab's source so the desk can work through the batch; 'main'
  // releases them into the ordinary lead flow (pipeline, table, follow-ups).
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const [importDest, setImportDest] = useState<'archive' | 'main'>('archive');
  const [assignDest, setAssignDest] = useState<'keep' | 'archive' | 'main'>('keep');
  const mainSource = `${defaultSource} — موزّع`;
  const showDeskTools = canManageLeads && !isSalesOnly;
  // Configuration narrows; it never widens. A tab asking for the distribute
  // panel still gets it only if the viewer holds the desk permission, so the
  // settings screen cannot be used to hand a rep tools they could not open.
  const showImportPanel = showDeskTools && !hideImport && panels?.import !== false;
  const showDistributePanel = showDeskTools && panels?.distribute !== false;
  const showDataPanel = panels?.data !== false;

  const importContext = useMemo<LeadImportContext>(() => ({ branchOptions, courses, bundles }), [branchOptions, courses, bundles]);
  const archiveParsed = useMemo(
    () => (archiveSheet ? buildLeadRows(archiveSheet, importContext) : []), [archiveSheet, importContext]);
  const usableRow = (row: LeadImportRow) => Boolean(row._name && row._phone);
  const validImportIds = archiveParsed.filter(usableRow).map(row => row._id);
  const incompleteRows = archiveParsed.length - validImportIds.length;

  // Every change to what is read starts the ticks again from the rows that can be
  // written, so the count on the button is the count about to be uploaded.
  const adoptSheet = (sheet: ImportSheet | null) => {
    setArchiveSheet(sheet);
    setArchiveImportResult(null);
    setArchiveSelectedIds(new Set(sheet ? buildLeadRows(sheet, importContext).filter(usableRow).map(row => row._id) : []));
  };

  const parseArchiveFile = async (file: File) => {
    setArchiveParseErr('');
    adoptSheet(null);
    try {
      const tabs = (await readSheetFile(file)).filter(tab => tab.rows.length > 0);
      if (!tabs.length) { setArchiveParseErr('الملف فارغ أو لا يحتوي على بيانات'); return; }
      const layouts = tabs.map(tab => detectLayout(tab.rows));
      // The first tab that reads as a list of people; failing that, the first.
      const found = layouts.findIndex(layout => layout.columns.name !== undefined && layout.columns.phone !== undefined);
      const tabIndex = found >= 0 ? found : 0;
      adoptSheet({ tabs, tabIndex, layout: layouts[tabIndex], branchCol: branchColumnOf(tabs[tabIndex], layouts[tabIndex]) });
    } catch (error) {
      setArchiveParseErr(error instanceof Error ? error.message : 'خطأ في قراءة الملف');
    }
  };

  const chooseImportTab = (tabIndex: number) => {
    if (!archiveSheet) return;
    const layout = detectLayout(archiveSheet.tabs[tabIndex].rows);
    adoptSheet({ ...archiveSheet, tabIndex, layout, branchCol: branchColumnOf(archiveSheet.tabs[tabIndex], layout) });
  };

  /** One column is one field: choosing it for this one takes it from whichever had it. */
  const setImportColumn = (field: SheetField | 'branch', value: string) => {
    if (!archiveSheet) return;
    const column = value === '' ? undefined : Number(value);
    if (field === 'branch') { adoptSheet({ ...archiveSheet, branchCol: column ?? -1 }); return; }
    const columns = { ...archiveSheet.layout.columns };
    for (const key of Object.keys(columns) as SheetField[]) if (columns[key] === column) delete columns[key];
    if (column === undefined) delete columns[field]; else columns[field] = column;
    adoptSheet({
      ...archiveSheet,
      layout: { ...archiveSheet.layout, columns, guessed: false },
      branchCol: column !== undefined && archiveSheet.branchCol === column ? -1 : archiveSheet.branchCol,
    });
  };

  const doImport = async () => {
    const toImport = archiveParsed.filter(r => archiveSelectedIds.has(r._id) && r._name && r._phone);
    if (toImport.length === 0) { notify('error', 'لا توجد صفوف محددة للاستيراد'); return; }
    setArchiveImporting(true);
    setArchiveImportResult(null);
    let created = 0, dupes = 0, errors = 0;
    for (const row of toImport) {
      try {
        // The course goes in the course column either way: a name that matched
        // the catalogue becomes a real interest link, one that didn't is kept as
        // free text behind the `raw:` prefix. It used to be shoved into the notes,
        // where nobody filters or reports on it.
        const courseEntry = row._courseId
          ? row._courseId
          : (row._courseRaw ? toRawCourse(row._courseRaw) : '');
        await addLead({
          name: row._name,
          phone: row._phone,
          email: row._email || undefined,
          notes: row._notes || undefined,
          branch: (row._branchKey || undefined) as LeadItem['branch'],
          rawBranch: row._branchRaw || undefined,
          interestedCourseIds: courseEntry ? [courseEntry] : undefined,
          // Imported rows land in the unassigned pool. Round-robin scattering a
          // whole archive across the team the moment it arrives is exactly what
          // the desk does not want — distribution is a deliberate step.
          skipAutoAssign: true,
          source: importDest === 'archive' ? (archiveSource || 'استيراد قديم') : mainSource,
          status: 'new',
          hidden: false,
        } as NewLeadDraft & { skipAutoAssign: boolean; rawBranch?: string },
        // One reload at the end, not one per row — see addLead in useCrmCoreState.
        { skipReload: true });
        created++;
      } catch (err: unknown) {
        const msg = (err as Error).message || '';
        if (msg.includes('409') || msg.includes('مسجل')) dupes++;
        else errors++;
      }
      setImportProgress({ done: created + dupes + errors, total: toImport.length });
    }
    setArchiveImportResult({ created, dupes, errors });
    setArchiveImporting(false);
    setImportProgress(null);
    await reloadLeads();
    if (created > 0) {
      notify('success', importDest === 'archive'
        ? `تم استيراد ${created} عميل — موجودون في تاب ${tabName} بانتظار التوزيع`
        : `تم استيراد ${created} عميل — ظاهرون في جدول الداتا بانتظار التوزيع`);
    }
  };

  // The view's own source filter, then whatever the filter bar is asking for.
  const poolLeads = leads.filter(l => !l.hidden && (customFilter ? customFilter(l) : l.source === archiveSource));
  const archiveLeads = poolLeads.filter(l => (matchesFilters ? matchesFilters(l) : true));
  // «غير موزّع: 262» above an empty table: the counter counts the pool and the
  // table counts what the filter bar lets through, and the filter bar — a
  // branch picked for the workspace, a search, a status — carries over from
  // tab to tab. Said on the screen, with the way out, instead of an empty list.
  const hiddenByFilters = poolLeads.length - archiveLeads.length;
  // Narrow the pool to leads interested in one course before assigning. A rep
  // handed a mixed bag calls about whatever is on the row; a rep handed forty
  // people who all asked about the same diploma has one conversation to
  // prepare. Empty means every course, which is the previous behaviour.
  const [bulkCourseFilter, setBulkCourseFilter] = useState('');
  // Already-distributed leads leave the pool.
  //
  // The pool was filtered on source and hidden alone, and the default
  // destination is "اتركها مكانها" — so a batch handed to a rep kept its source
  // and stayed on the list, indistinguishable from data nobody had touched. The
  // next pass over the screen handed the same people to somebody else, and the
  // only sign was the مبيعات column that had to be read row by row.
  //
  // Scoped to the role being assigned: a lead already with a sales rep may still
  // be waiting for a collector, so distributing تحصيل must not treat it as done.
  // Reassignment is a real need, so it stays available behind a switch rather
  // than being removed — what changes is that it is now deliberate.
  const [includeAssigned, setIncludeAssigned] = useState(false);
  //
  // The collection team is not in the main distribution; they get what is left
  // — «في الداتا المتبقيه اوزعلهم منها» — so for them a lead with anybody on
  // it, rep or officer, is already taken.
  const assignedAlready = (lead: typeof archiveLeads[number]) => (bulkAssignRole === 'sales'
    ? Boolean(lead.assignedSalesId)
    : Boolean(lead.assignedSalesId || lead.assignedCsId));
  const undistributed = includeAssigned ? archiveLeads : archiveLeads.filter(lead => !assignedAlready(lead));
  const alreadyCount = archiveLeads.length - archiveLeads.filter(lead => !assignedAlready(lead)).length;
  const filteredBulkLeads = bulkCourseFilter
    ? undistributed.filter(lead => {
      const title = String(courses.find(c => c.id === bulkCourseFilter)?.title || '').toLowerCase();
      // A lead records the course as an enrolment, as one of several declared
      // interests, or as free text in the notes when it arrived from an ad
      // form. Matching only the tidy case would miss most of the imported data.
      return lead.enrolledCourseId === bulkCourseFilter
        || (lead.interestedCourseIds || []).includes(bulkCourseFilter)
        || (!!title && String(lead.notes || '').toLowerCase().includes(title));
    })
    : undistributed;
  const staffForAssign = staffMembers.filter(s => {
    const role = (s.role || '').toLowerCase();
    // Only a collection officer can hold a collection lead — the server checks
    // the role, so an admin in this list could only fail.
    return bulkAssignRole === 'sales'
      ? ['sales', 'admin'].includes(role)
      : role === 'collection' && s.status !== 'inactive';
  });

  const doBulkAssign = async () => {
    if (!bulkAssignSrc || bulkSelectedLeadIds.size === 0) return;
    const staff = staffMembers.find(s => s.id === bulkAssignSrc);
    if (!staff) return;
    setBulkAssigning2(true);
    if (bulkAssignRole === 'collection') {
      // One request for the batch; the server skips whatever somebody took in
      // the meantime and says how many.
      try {
        const result = await mysqlAdmin.adminPost<{ assigned: number; skipped: number }>('/admin/leads/assign-collection', {
          leadIds: [...bulkSelectedLeadIds], staffId: staff.id, includeAssigned,
          source: assignDest === 'main' ? mainSource : assignDest === 'archive' ? (archiveSource || defaultSource) : undefined,
        });
        setBulkSelectedLeadIds(new Set());
        await reloadLeads();
        notify('success', `اتوزع ${result.assigned} عميل على ${staff.name}${result.skipped ? ` — ${result.skipped} كانوا مع حد تاني` : ''}`);
      } catch (error) {
        notify('error', error instanceof Error ? error.message : 'تعذر التوزيع');
      } finally { setBulkAssigning2(false); }
      return;
    }
    let done = 0;
    for (const lid of bulkSelectedLeadIds) {
      const lead = leads.find(l => l.id === lid);
      if (!lead) continue;
      // The rep's tabs split on `source` exactly like this one does, so moving a
      // distributed batch between "the data table" and "the archive tab" is a
      // matter of which source it carries. 'keep' leaves it where it is.
      const source = assignDest === 'main' ? mainSource
        : assignDest === 'archive' ? (archiveSource || defaultSource)
        : lead.source;
      // Handing a lead to a rep puts it in play. One the cold-lead job had archived
      // used to keep that status on the rep's list — terminal, so it never reached
      // their reminders or their work queue — and was taken straight back by the
      // next run. It arrives as new, with the status change on its timeline.
      await updateLead({
        ...lead, source, assignedSalesId: staff.id, assignedSalesName: staff.name,
        status: (lead.status as string) === 'archived' ? 'new' : lead.status,
      });
      done++;
    }
    setBulkAssigning2(false);
    setBulkSelectedLeadIds(new Set());
    await reloadLeads();
    notify('success', `تم تعيين ${done} عميل إلى ${staff.name}`);
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center gap-2">
        <Archive size={18} className="text-indigo-600" />
        <h2 className="font-extrabold text-gray-800 text-base">{title}</h2>
        <span className="text-xs font-bold text-gray-500">({archiveLeads.length}{hiddenByFilters > 0 ? ` من ${poolLeads.length}` : ''})</span>
      </div>
      {hiddenByFilters > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">
          <span>الفلاتر المختارة مخفية <strong>{hiddenByFilters}</strong> من <strong>{poolLeads.length}</strong> عميل في التاب ده.</span>
          {onShowAll && (
            <button type="button" onClick={onShowAll} className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-bold text-white hover:bg-amber-700">
              اعرض الكل
            </button>
          )}
        </div>
      )}

      {/* ── Section 1: Import CSV ── */}
      {/* Sourcing and distributing data is a desk job, not a rep's. A rep holds
          `manage_leads` (they edit their own leads), so that permission alone was
          never the right gate here — it is why reps were seeing an import box. */}
      {showImportPanel && (
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
        <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
          <Upload size={14} className="text-indigo-500" /> استيراد ملف CSV / Excel
        </h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">مصدر الليدز</label>
            <input value={archiveSource} onChange={e => setArchiveSource(e.target.value)}
              placeholder="مثال: استيراد قديم 2024"
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm w-48" />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">وجهة الداتا</label>
            <select value={importDest} onChange={e => setImportDest(e.target.value as 'archive' | 'main')}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white min-w-[190px]">
              <option value="archive">تبقى في تاب {tabName}</option>
              <option value="main">تنزل في جدول الداتا</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">ملف Excel (.xlsx) أو CSV</label>
            <input type="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt"
              onChange={e => { const f = e.target.files?.[0]; if (f) void parseArchiveFile(f); e.target.value = ''; }}
              className="text-sm text-gray-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer" />
          </div>
        </div>
        <p className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
          الداتا المستوردة تصل <strong>بدون مندوب مبيعات</strong> — التوزيع يدوي من قسم «تعيين جماعي لموظف» بالأسفل.
        </p>
        <div className="space-y-1">
          <p className="text-[11px] text-gray-500">
            الأعمدة المدعومة:
            <code className="bg-indigo-50 text-indigo-700 px-1 rounded mx-1 font-bold">اختر_الفرع_</code>
            <code className="bg-indigo-50 text-indigo-700 px-1 rounded mx-1 font-bold">full_name</code>
            <code className="bg-indigo-50 text-indigo-700 px-1 rounded mx-1 font-bold">phone_number</code>
            <code className="bg-indigo-50 text-indigo-700 px-1 rounded mx-1 font-bold">الكورس</code>
          </p>
          <p className="text-[10px] text-gray-400">
            الاسم والهاتف إلزاميان. الأعمدة بتتعرف عليها من عناوينها (الاسم، التليفون / الموبايل / الجوال، الفرع، email، ملاحظات…) وتقدر تصحّح أي عمود بعد الرفع.
            الملف ممكن يكون Excel أو CSV (UTF-8 أو Windows-1256)، والأرقام اللي ناقصها الصفر أو فيها مسافات وشرط بتتظبط لوحدها.
          </p>
        </div>
        {archiveParseErr && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-center gap-2">
            <AlertCircle size={15} /> {archiveParseErr}
          </div>
        )}
        {archiveSheet && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2">
            {archiveSheet.tabs.length > 1 && (
              <label className="flex flex-wrap items-center gap-2 text-xs font-bold text-gray-700">
                التاب المستورد:
                <select value={archiveSheet.tabIndex} onChange={e => chooseImportTab(Number(e.target.value))}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white">
                  {archiveSheet.tabs.map((tab, index) => <option key={tab.name + index} value={index}>{tab.name} ({tab.rows.length})</option>)}
                </select>
              </label>
            )}
            <p className="text-[11px] font-bold text-gray-600">
              {archiveSheet.layout.guessed
                ? 'الملف مفيهوش صف عناوين — الأعمدة اتخمّنت من محتواها، راجعها:'
                : 'الأعمدة اللي اتعرفت عليها — صحّح أي واحد غلط:'}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {IMPORT_FIELDS.map(field => {
                const value = field.key === 'branch'
                  ? (archiveSheet.branchCol >= 0 ? archiveSheet.branchCol : '')
                  : (archiveSheet.layout.columns[field.key] ?? '');
                const tab = archiveSheet.tabs[archiveSheet.tabIndex];
                const width = Math.max(0, ...tab.rows.slice(0, 50).map(row => row.length));
                const required = field.key === 'name' || field.key === 'phone';
                return (
                  <label key={field.key} className="text-[11px] font-bold text-gray-600 space-y-0.5 block">
                    <span>{field.label}{required ? ' *' : ''}</span>
                    <select value={value} onChange={e => setImportColumn(field.key, e.target.value)}
                      className={`w-full border rounded-lg px-2 py-1 text-xs bg-white ${required && value === '' ? 'border-red-300' : 'border-gray-200'}`}>
                      <option value="">— مفيش —</option>
                      {Array.from({ length: width }, (_, index) => (
                        <option key={index} value={index}>{columnLabel(tab, archiveSheet.layout, index)}</option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          </div>
        )}
        {archiveSheet && archiveParsed.length > 0 && validImportIds.length === 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-center gap-2">
            <AlertCircle size={15} /> مفيش ولا صف فيه اسم ورقم هاتف مع بعض. اختار عمود الاسم وعمود الهاتف من فوق.
          </div>
        )}
        {archiveSheet && validImportIds.length > 0 && incompleteRows > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs font-bold text-amber-800" role="status">
            {incompleteRows} صف ناقص اسم أو رقم هاتف صالح — مش هيتستورد (باهت في الجدول تحت).
          </div>
        )}
        {archiveParsed.length > 0 && (
          <>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-sm font-bold text-gray-700">{archiveParsed.length} صف — محدد: {archiveSelectedIds.size}</span>
              <div className="flex gap-2">
                <button onClick={() => setArchiveSelectedIds(new Set(validImportIds))} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 font-bold">تحديد الكل</button>
                <button onClick={() => setArchiveSelectedIds(new Set())} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 font-bold">إلغاء الكل</button>
              </div>
            </div>
            <div className="max-h-64 overflow-auto border border-gray-200 rounded-xl">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="py-2 px-3 text-right font-bold text-gray-600 w-8"><input type="checkbox" checked={validImportIds.length > 0 && archiveSelectedIds.size === validImportIds.length} onChange={e => setArchiveSelectedIds(e.target.checked ? new Set(validImportIds) : new Set())} className="w-3.5 h-3.5" /></th>
                    <th className="py-2 px-3 text-right font-bold text-gray-600">الاسم</th>
                    <th className="py-2 px-3 text-right font-bold text-gray-600">الهاتف</th>
                    <th className="py-2 px-3 text-right font-bold text-gray-600">الفرع</th>
                    <th className="py-2 px-3 text-right font-bold text-gray-600">الكورس</th>
                    <th className="py-2 px-3 text-right font-bold text-gray-600">الإيميل</th>
                    <th className="py-2 px-3 text-right font-bold text-gray-600">ملاحظة</th>
                  </tr>
                </thead>
                <tbody>
                  {archiveParsed.slice(0, 200).map((r) => {
                    const hasRequired = r._name && r._phone;
                    const courseTitle = r._courseId ? courseBadgeLabel(r._courseId, courses, bundles) : '';
                    return (
                      <tr key={r._id} className={`border-b border-gray-50 hover:bg-gray-50/50 ${!hasRequired ? 'opacity-50' : ''}`}>
                        <td className="py-1.5 px-3"><input type="checkbox" checked={archiveSelectedIds.has(r._id)} disabled={!hasRequired} onChange={e => { const next = new Set(archiveSelectedIds); e.target.checked ? next.add(r._id) : next.delete(r._id); setArchiveSelectedIds(next); }} className="w-3.5 h-3.5" /></td>
                        <td className="py-1.5 px-3 font-bold text-gray-900">{r._name || <span className="text-red-400">مطلوب</span>}</td>
                        <td className="py-1.5 px-3 font-mono text-gray-600">{r._phone || <span className="text-red-400">مطلوب</span>}</td>
                        {/* Green = mapped to a real branch/course; amber = kept as
                            raw text so nothing is lost but nothing is guessed. */}
                        <td className="py-1.5 px-3">
                          {r._branchRaw ? (
                            r._branchKey
                              ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">{BRANCH_LABELS_AR[r._branchKey as BranchKey] || r._branchKey}</span>
                              : <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700" title="لم يُطابق فرعًا معروفًا — سيُحفظ كنص">{r._branchRaw}</span>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="py-1.5 px-3">
                          {r._courseRaw ? (
                            r._courseId
                              ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700" title={courseTitle}>{courseTitle}</span>
                              : <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700" title="لم يُطابق كورسًا في الكتالوج — سيُحفظ كنص في عمود الكورسات">{r._courseRaw}</span>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="py-1.5 px-3 text-gray-500">{r._email}</td>
                        <td className="py-1.5 px-3 text-gray-500 max-w-[120px] truncate">{r._notes}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {archiveParsed.length > 200 && <p className="text-center py-2 text-xs text-gray-400">عرض أول 200 صف من {archiveParsed.length}</p>}
            </div>
            <button disabled={archiveImporting || archiveSelectedIds.size === 0} onClick={doImport}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700 disabled:opacity-60 transition">
              {archiveImporting ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> جارٍ الاستيراد...</> : <><Upload size={15} /> استيراد {archiveSelectedIds.size} عميل</>}
            </button>
            {/* A few thousand rows take minutes; without a counter the screen
                looks frozen and people reload mid-import. */}
            {importProgress && (
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-bold text-gray-600">
                  <span>{importProgress.done} من {importProgress.total}</span>
                  <span>{Math.round((importProgress.done / importProgress.total) * 100)}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full rounded-full bg-indigo-500 transition-all"
                    style={{ width: `${(importProgress.done / importProgress.total) * 100}%` }} />
                </div>
                <p className="text-[10px] text-gray-400">لا تغلق الصفحة حتى ينتهي الاستيراد.</p>
              </div>
            )}
          </>
        )}
        {archiveImportResult && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm space-y-1">
            <p className="font-bold text-emerald-800">✅ انتهى الاستيراد</p>
            <p className="text-emerald-700">تم إنشاء: <strong>{archiveImportResult.created}</strong> عميل جديد</p>
            {archiveImportResult.dupes > 0 && <p className="text-amber-700">مكرر (تم تجاهله): <strong>{archiveImportResult.dupes}</strong></p>}
            {archiveImportResult.errors > 0 && <p className="text-red-700">أخطاء: <strong>{archiveImportResult.errors}</strong></p>}
          </div>
        )}
      </div>
      )}

      {/* ── Section 2: Bulk Assign ── */}
      {showDistributePanel && <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
        <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
          <Users size={14} className="text-emerald-500" /> تعيين جماعي لموظف
        </h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">القسم</label>
            <select value={bulkAssignRole} onChange={e => setBulkAssignRole(e.target.value as 'sales' | 'collection')} className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
              <option value="sales">مبيعات</option>
              <option value="collection">تحصيل — من الداتا المتبقية</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">الموظف</label>
            <select value={bulkAssignSrc} onChange={e => setBulkAssignSrc(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white min-w-[180px]">
              <option value="">اختر الموظف...</option>
              {staffForAssign.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">الكورس</label>
            <select value={bulkCourseFilter} onChange={e => { setBulkCourseFilter(e.target.value); setBulkSelectedLeadIds(new Set()); }}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white min-w-[200px]">
              <option value="">كل الكورسات</option>
              {courses.map(course => (
                <option key={course.id} value={course.id}>{course.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">وجهة الداتا بعد التوزيع</label>
            <select value={assignDest} onChange={e => setAssignDest(e.target.value as 'keep' | 'archive' | 'main')}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white min-w-[200px]">
              <option value="keep">اتركها مكانها</option>
              <option value="main">انزلها في جدول الداتا</option>
              <option value="archive">أبقها في تاب {tabName}</option>
            </select>
          </div>
          <button disabled={!bulkAssignSrc || bulkSelectedLeadIds.size === 0 || bulkAssigning2} onClick={doBulkAssign}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 disabled:opacity-60 transition">
            {bulkAssigning2 ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Users size={15} />}
            تعيين {bulkSelectedLeadIds.size > 0 ? `(${bulkSelectedLeadIds.size})` : 'محدد'}
          </button>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500">{filteredBulkLeads.length} عميل — محدد: {bulkSelectedLeadIds.size}</span>
            {alreadyCount > 0 && (
              <label
                title="الموزّعون بيختفوا من القايمة عشان ما يتوزّعوش تاني على حد تاني بالغلط"
                className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-bold transition ${
                  includeAssigned ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-gray-200 bg-gray-50 text-gray-600'}`}
              >
                <input
                  type="checkbox"
                  checked={includeAssigned}
                  onChange={event => { setIncludeAssigned(event.target.checked); setBulkSelectedLeadIds(new Set()); }}
                  className="h-3.5 w-3.5 accent-amber-600"
                />
                أظهر الموزّعين ({alreadyCount})
              </label>
            )}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            {/* Quantity input */}
            <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-xl px-2 py-1">
              <span className="text-xs font-bold text-blue-700">تحديد عدد:</span>
              <input
                type="number"
                min="1"
                max={filteredBulkLeads.length}
                value={bulkQuantity}
                onChange={e => setBulkQuantity(e.target.value)}
                placeholder="..."
                className="w-20 text-xs px-1.5 py-0.5 border border-blue-200 rounded-lg text-center bg-white focus:outline-none focus:border-blue-400"
              />
              <button
                onClick={() => {
                  const n = parseInt(bulkQuantity) || 0;
                  if (n > 0) setBulkSelectedLeadIds(new Set(filteredBulkLeads.slice(0, n).map(l => l.id)));
                }}
                disabled={!bulkQuantity || parseInt(bulkQuantity) <= 0}
                className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 font-bold transition">
                تحديد
              </button>
            </div>
            <button onClick={() => setBulkSelectedLeadIds(new Set(filteredBulkLeads.map(l => l.id)))} className="text-xs px-2.5 py-1 bg-gray-100 rounded-lg hover:bg-gray-200 font-bold">تحديد الكل ({filteredBulkLeads.length})</button>
            <button onClick={() => setBulkSelectedLeadIds(new Set())} className="text-xs px-2.5 py-1 bg-gray-100 rounded-lg hover:bg-gray-200 font-bold">إلغاء التحديد</button>
          </div>
        </div>
      </div>}

      {/* ── Section 3: Lead Table ── */}
      {showDataPanel && <LeadTable
        rows={archiveLeads}
        showCourseCol={true}
        courses={courses}
        bundles={bundles}
        navigate={navigate}
        updateLead={updateLead}
        reloadLeads={reloadLeads}
        deleteLead={deleteLead}
        addSubscriber={addSubscriber}
        updateSubscriber={updateSubscriber}
        subscribers={subscribers}
        salesStaff={salesReps}
        isSalesOnly={isSalesOnly}
        canManageLeads={canManageLeads}
        onBook={onBook}
        branchOptions={branchOptions}
        sources={sources}
        onSalesClick={!isSalesOnly ? (staffId: string) => navigate(`/staff/${staffId}`) : undefined}
      />}
    </div>
  );
}
