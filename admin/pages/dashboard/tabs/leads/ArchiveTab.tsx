import { useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { AlertCircle, Archive, Upload, Users } from 'lucide-react';
import type { Bundle, Course, LeadItem, LeadStatus, StaffMember, SubscriberItem } from '../../../../types';
import type { NotifyFn } from '../CrmSettingsModal';
import { LeadTable } from '../LeadTable';
import { LEAD_STATUS_CFG, crmStatusLabels } from './LeadSubcomponents';

export interface ArchiveTabProps {
  leads: LeadItem[];
  staffMembers: StaffMember[];
  addLead: (l: Partial<LeadItem>) => Promise<unknown>;
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
  customFilter?: (lead: LeadItem) => boolean;
  hideImport?: boolean;
}
export function ArchiveTab({ leads, staffMembers, addLead, updateLead, reloadLeads, notify, courses, bundles, navigate, deleteLead, addSubscriber, updateSubscriber, subscribers, salesReps, isSalesOnly, canManageLeads, onBook, branchOptions, sources, title = 'محلي قديم — الاستيراد والتعيين الجماعي', defaultSource = 'محلي قديم', customFilter, hideImport = false }: ArchiveTabProps) {
  const [archiveParsed, setArchiveParsed] = useState<Record<string, string>[]>([]);
  const [archiveParseErr, setArchiveParseErr] = useState('');
  const [archiveImporting, setArchiveImporting] = useState(false);
  const [archiveImportResult, setArchiveImportResult] = useState<{ created: number; dupes: number; errors: number } | null>(null);
  const [archiveSelectedIds, setArchiveSelectedIds] = useState<Set<string>>(new Set());
  const [archiveSource, setArchiveSource] = useState(defaultSource);
  const [archivePage, setArchivePage] = useState(1);
  const [bulkAssignSrc, setBulkAssignSrc] = useState('');
  const [bulkAssignRole, setBulkAssignRole] = useState<'sales' | 'collection'>('sales');
  const [bulkSelectedLeadIds, setBulkSelectedLeadIds] = useState<Set<string>>(new Set());
  const [bulkAssigning2, setBulkAssigning2] = useState(false);
  const [bulkQuantity, setBulkQuantity] = useState('');
  const ARCHIVE_PAGE_SIZE = 100;

  const parseArchiveFile = (file: File) => {
    setArchiveParseErr('');
    setArchiveParsed([]);
    setArchiveImportResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || '';
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) { setArchiveParseErr('الملف فارغ أو لا يحتوي على بيانات'); return; }
      const delim = text.includes('\t') ? '\t' : ',';
      const headers = lines[0].split(delim).map(h => h.replace(/^["']|["']$/g, '').trim().toLowerCase());
      const rows: Record<string, string>[] = [];
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(delim).map(v => v.replace(/^["']|["']$/g, '').trim());
        if (vals.every(v => !v)) continue;
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
        row._name  = row['name'] || row['الاسم'] || row['اسم'] || row['full_name'] || '';
        row._phone = row['phone'] || row['mobile'] || row['الهاتف'] || row['الموبايل'] || row['رقم الهاتف'] || '';
        row._email = row['email'] || row['البريد الالكتروني'] || row['ايميل'] || '';
        row._notes = row['notes'] || row['ملاحظات'] || '';
        row._id    = `arch-${Date.now()}-${i}`;
        rows.push(row);
      }
      setArchiveParsed(rows);
      setArchiveSelectedIds(new Set(rows.map(r => r._id)));
    };
    reader.onerror = () => setArchiveParseErr('خطأ في قراءة الملف');
    reader.readAsText(file, 'UTF-8');
  };

  const doImport = async () => {
    const toImport = archiveParsed.filter(r => archiveSelectedIds.has(r._id) && r._name && r._phone);
    if (toImport.length === 0) { notify('error', 'لا توجد صفوف محددة للاستيراد'); return; }
    setArchiveImporting(true);
    setArchiveImportResult(null);
    let created = 0, dupes = 0, errors = 0;
    for (const row of toImport) {
      try {
        await addLead({ name: row._name, phone: row._phone, email: row._email || undefined, notes: row._notes || undefined, source: archiveSource || 'استيراد قديم', status: 'new', hidden: false });
        created++;
      } catch (err: unknown) {
        const msg = (err as Error).message || '';
        if (msg.includes('409') || msg.includes('مسجل')) dupes++;
        else errors++;
      }
    }
    setArchiveImportResult({ created, dupes, errors });
    setArchiveImporting(false);
    if (created > 0) notify('success', `تم استيراد ${created} عميل بنجاح`);
  };

  const archiveLeads = leads.filter(l => !l.hidden && (customFilter ? customFilter(l) : l.source === archiveSource));
  const totalArchivePages = Math.ceil(archiveLeads.length / ARCHIVE_PAGE_SIZE);
  const filteredBulkLeads = archiveLeads;
  const bulkPaginated = filteredBulkLeads.slice((archivePage - 1) * ARCHIVE_PAGE_SIZE, archivePage * ARCHIVE_PAGE_SIZE);
  const staffForAssign = staffMembers.filter(s => {
    const role = (s.role || '').toLowerCase();
    return bulkAssignRole === 'sales'
      ? ['sales', 'admin'].includes(role)
      : ['collection', 'admin'].includes(role);
  });

  const doBulkAssign = async () => {
    if (!bulkAssignSrc || bulkSelectedLeadIds.size === 0) return;
    const staff = staffMembers.find(s => s.id === bulkAssignSrc);
    if (!staff) return;
    setBulkAssigning2(true);
    let done = 0;
    for (const lid of bulkSelectedLeadIds) {
      const lead = leads.find(l => l.id === lid);
      if (!lead) continue;
      if (bulkAssignRole === 'sales') {
        await updateLead({ ...lead, assignedSalesId: staff.id, assignedSalesName: staff.name });
      } else {
        await updateLead({ ...lead, assignedCollectionId: staff.id, assignedCollectionName: staff.name } as typeof lead);
      }
      done++;
    }
    setBulkAssigning2(false);
    setBulkSelectedLeadIds(new Set());
    notify('success', `تم تعيين ${done} عميل إلى ${staff.name}`);
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center gap-2">
        <Archive size={18} className="text-indigo-600" />
        <h2 className="font-extrabold text-gray-800 text-base">{title}</h2>
      </div>

      {/* ── Section 1: Import CSV ── */}
      {canManageLeads && !hideImport && (
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
            <label className="text-xs font-bold text-gray-600 mb-1 block">ملف CSV أو TSV</label>
            <input type="file" accept=".csv,.tsv,.txt"
              onChange={e => { const f = e.target.files?.[0]; if (f) parseArchiveFile(f); }}
              className="text-sm text-gray-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer" />
          </div>
        </div>
        <p className="text-[11px] text-gray-400">
          الأعمدة المدعومة: <code className="bg-gray-100 px-1 rounded">name / الاسم</code> &nbsp; <code className="bg-gray-100 px-1 rounded">phone / الهاتف</code> &nbsp; <code className="bg-gray-100 px-1 rounded">email</code> &nbsp; <code className="bg-gray-100 px-1 rounded">notes / ملاحظات</code>
        </p>
        {archiveParseErr && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-center gap-2">
            <AlertCircle size={15} /> {archiveParseErr}
          </div>
        )}
        {archiveParsed.length > 0 && (
          <>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-sm font-bold text-gray-700">{archiveParsed.length} صف — محدد: {archiveSelectedIds.size}</span>
              <div className="flex gap-2">
                <button onClick={() => setArchiveSelectedIds(new Set(archiveParsed.map(r => r._id)))} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 font-bold">تحديد الكل</button>
                <button onClick={() => setArchiveSelectedIds(new Set())} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 font-bold">إلغاء الكل</button>
              </div>
            </div>
            <div className="max-h-64 overflow-auto border border-gray-200 rounded-xl">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="py-2 px-3 text-right font-bold text-gray-600 w-8"><input type="checkbox" checked={archiveSelectedIds.size === archiveParsed.length} onChange={e => setArchiveSelectedIds(e.target.checked ? new Set(archiveParsed.map(r => r._id)) : new Set())} className="w-3.5 h-3.5" /></th>
                    <th className="py-2 px-3 text-right font-bold text-gray-600">الاسم</th>
                    <th className="py-2 px-3 text-right font-bold text-gray-600">الهاتف</th>
                    <th className="py-2 px-3 text-right font-bold text-gray-600">الإيميل</th>
                    <th className="py-2 px-3 text-right font-bold text-gray-600">ملاحظة</th>
                  </tr>
                </thead>
                <tbody>
                  {archiveParsed.slice(0, 200).map((r) => {
                    const hasRequired = r._name && r._phone;
                    return (
                      <tr key={r._id} className={`border-b border-gray-50 hover:bg-gray-50/50 ${!hasRequired ? 'opacity-50' : ''}`}>
                        <td className="py-1.5 px-3"><input type="checkbox" checked={archiveSelectedIds.has(r._id)} disabled={!hasRequired} onChange={e => { const next = new Set(archiveSelectedIds); e.target.checked ? next.add(r._id) : next.delete(r._id); setArchiveSelectedIds(next); }} className="w-3.5 h-3.5" /></td>
                        <td className="py-1.5 px-3 font-bold text-gray-900">{r._name || <span className="text-red-400">مطلوب</span>}</td>
                        <td className="py-1.5 px-3 font-mono text-gray-600">{r._phone || <span className="text-red-400">مطلوب</span>}</td>
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
      {canManageLeads && <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
        <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
          <Users size={14} className="text-emerald-500" /> تعيين جماعي لموظف
        </h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">القسم</label>
            <select value={bulkAssignRole} onChange={e => setBulkAssignRole(e.target.value as 'sales' | 'collection')} className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
              <option value="sales">مبيعات</option>
              <option value="collection">تحصيل</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">الموظف</label>
            <select value={bulkAssignSrc} onChange={e => setBulkAssignSrc(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white min-w-[180px]">
              <option value="">اختر الموظف...</option>
              {staffForAssign.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <button disabled={!bulkAssignSrc || bulkSelectedLeadIds.size === 0 || bulkAssigning2} onClick={doBulkAssign}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 disabled:opacity-60 transition">
            {bulkAssigning2 ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Users size={15} />}
            تعيين {bulkSelectedLeadIds.size > 0 ? `(${bulkSelectedLeadIds.size})` : 'محدد'}
          </button>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
          <span className="text-xs text-gray-500">{filteredBulkLeads.length} عميل — محدد: {bulkSelectedLeadIds.size}</span>
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
            <button onClick={() => setBulkSelectedLeadIds(new Set(bulkPaginated.map(l => l.id)))} className="text-xs px-2.5 py-1 bg-gray-100 rounded-lg hover:bg-gray-200 font-bold">تحديد الصفحة</button>
            <button onClick={() => setBulkSelectedLeadIds(new Set(filteredBulkLeads.map(l => l.id)))} className="text-xs px-2.5 py-1 bg-gray-100 rounded-lg hover:bg-gray-200 font-bold">تحديد الكل ({filteredBulkLeads.length})</button>
            <button onClick={() => setBulkSelectedLeadIds(new Set())} className="text-xs px-2.5 py-1 bg-gray-100 rounded-lg hover:bg-gray-200 font-bold">إلغاء التحديد</button>
          </div>
        </div>
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="py-2 px-3 text-right font-bold text-gray-600 w-8"><input type="checkbox" checked={bulkPaginated.length > 0 && bulkPaginated.every(l => bulkSelectedLeadIds.has(l.id))} onChange={e => { const next = new Set(bulkSelectedLeadIds); bulkPaginated.forEach(l => e.target.checked ? next.add(l.id) : next.delete(l.id)); setBulkSelectedLeadIds(next); }} className="w-3.5 h-3.5" /></th>
                <th className="py-2 px-3 text-right font-bold text-gray-600">الاسم</th>
                <th className="py-2 px-3 text-right font-bold text-gray-600">الهاتف</th>
                <th className="py-2 px-3 text-right font-bold text-gray-600">الحالة</th>
                <th className="py-2 px-3 text-right font-bold text-gray-600">مبيعات</th>
                <th className="py-2 px-3 text-right font-bold text-gray-600">المصدر</th>
              </tr>
            </thead>
            <tbody>
              {bulkPaginated.map(lead => (
                <tr key={lead.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="py-1.5 px-3"><input type="checkbox" checked={bulkSelectedLeadIds.has(lead.id)} onChange={e => { const next = new Set(bulkSelectedLeadIds); e.target.checked ? next.add(lead.id) : next.delete(lead.id); setBulkSelectedLeadIds(next); }} className="w-3.5 h-3.5 accent-emerald-600" /></td>
                  <td className="py-1.5 px-3 font-bold text-gray-900">{lead.name}</td>
                  <td className="py-1.5 px-3 font-mono text-gray-600">{lead.phone}</td>
                  <td className="py-1.5 px-3"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${LEAD_STATUS_CFG[lead.status as LeadStatus]?.color || 'bg-gray-100 text-gray-500'}`}>{crmStatusLabels[lead.status] || lead.status}</span></td>
                  <td className="py-1.5 px-3 text-gray-600">{lead.assignedSalesName || '—'}</td>
                  <td className="py-1.5 px-3 text-gray-400">{lead.source || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalArchivePages > 1 && (
          <div className="flex items-center gap-2 justify-center pt-1">
            <button disabled={archivePage <= 1} onClick={() => setArchivePage(p => p - 1)} className="px-3 py-1.5 text-xs rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-40 font-bold">← السابق</button>
            <span className="text-xs text-gray-600 font-bold">{archivePage} / {totalArchivePages}</span>
            <button disabled={archivePage >= totalArchivePages} onClick={() => setArchivePage(p => p + 1)} className="px-3 py-1.5 text-xs rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-40 font-bold">التالي →</button>
          </div>
        )}
      </div>}

      {/* ── Section 3: Lead Table ── */}
      <LeadTable
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
      />
    </div>
  );
}
