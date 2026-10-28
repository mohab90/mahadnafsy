import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, ExternalLink, FileText, Pencil, Plus, Printer, RefreshCw, Ruler, Search, Share2 } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { waLink } from '../../../lib/whatsappLink';
import { cairoDateOnly, cairoDay } from '../../../../shared/cairoDate';
import { branchLabels, normBranchKey } from '../../unified-client/constants';
import { exportToExcel, type ExportColumn } from '../../../lib/exportUtils';
import { SelectionExportBar, useRowPicker } from './SelectionExportBar';
import { CertificateEditModal } from './CertificateEditModal';
import { SITE, certificateUrl, formPrintUrl } from '../../../lib/certificateForm';
import { FormLayoutModal } from './FormLayoutModal';
import { AddInstituteCertificateModal } from './AddInstituteCertificateModal';

// «تاب في صفحه الشهادات اسمه شهادات المعهد ودا بيكون اتوماتك ومجاني لاي عميل خلص
// فلوسه او 90 % من فلوسه … نقدر نطلع منها نسخه pdf ونعملها شير للعميل او نعملها
// طباعه وبردو يمشي في خطوات اتشحنت او في الفرع … لو العميل عمل تحميل للشهاده pdf
// من الموقع يظهر» (8 Oct 2026). The certificates themselves are issued by the
// server every hour (api/lib/instituteCertificates.js); this follows each one.
type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type Stage = 'READY' | 'PRINTED' | 'AT_BRANCH' | 'SHIPPED' | 'DELIVERED' | 'RETURNED';
type Row = {
  id: string; code: string; issuedAt: string; status: Stage; statusAt: string | null; statusBy: string | null;
  downloadedAt: string | null; downloads: number;
  /** Printed at the institute: when, by whom, how many times; and whether this is a track's certificate. */
  printedAt: string | null; printedBy: string | null; printCount: number; isTrack: boolean; subscriberId: string; subscriberName: string; nameEn: string | null;
  phone: string; clientCode: string | null; branch: string | null; courseTitle: string;
  nationalId: string | null; personalPhotoUrl: string | null; idPhotoUrl: string | null;
  /** The course's title in English, and what the English-only certificate still lacks. */
  courseTitleEn: string | null; missing: string[];
  /** What prints (the desk's change on this certificate, else the client's file and the course). */
  printed: { name: string | null; course: string | null; duration: string; trainer: string };
  edits: { nameEn: string | null; courseEn: string | null; duration: string | null; trainer: string | null };
};

const STAGES: Record<Stage, { label: string; cls: string }> = {
  READY: { label: 'جاهزة', cls: 'bg-amber-100 text-amber-800' },
  PRINTED: { label: 'اتطبعت', cls: 'bg-blue-100 text-blue-800' },
  AT_BRANCH: { label: 'في الفرع', cls: 'bg-indigo-100 text-indigo-800' },
  SHIPPED: { label: 'اتشحنت', cls: 'bg-violet-100 text-violet-800' },
  DELIVERED: { label: 'العميل استلم', cls: 'bg-emerald-100 text-emerald-800' },
  RETURNED: { label: 'مرتجع', cls: 'bg-rose-100 text-rose-800' },
};
// The download: the client's whole row, ending with the Drive links of the pictures on file.
const EXPORT_COLUMNS: ExportColumn[] = [
  { header: 'اسم العميل', key: 'client', width: 26 },
  { header: 'كود العميل', key: 'clientCode', width: 12 },
  { header: 'التليفون', key: 'phone', width: 16 },
  { header: 'الفرع', key: 'branch', width: 14 },
  { header: 'الكورس', key: 'course', width: 26 },
  { header: 'الاسم بالإنجليزي على الشهادة', key: 'nameEn', width: 30 },
  { header: 'الرقم القومي / الهوية', key: 'nationalId', width: 20 },
  { header: 'رقم الشهادة', key: 'code', width: 22 },
  { header: 'تاريخ الإصدار', key: 'issuedAt', width: 14 },
  { header: 'الحالة', key: 'status', width: 16 },
  { header: 'حمّلها العميل من الموقع', key: 'downloaded', width: 22 },
  { header: 'رابط الشهادة', key: 'link', width: 50 },
  { header: 'رابط الصورة الشخصية', key: 'personalPhoto', width: 40 },
  { header: 'رابط صورة الهوية', key: 'idPhoto', width: 40 },
];
const exportRow = (row: Row): Record<string, unknown> => ({
  client: row.subscriberName, clientCode: row.clientCode || '', phone: row.phone,
  branch: row.branch ? branchLabels[normBranchKey(row.branch)] || row.branch : '', course: row.courseTitle,
  nameEn: row.nameEn || '', nationalId: row.nationalId || '', code: row.code, issuedAt: cairoDay(row.issuedAt),
  status: STAGES[row.status]?.label || row.status, downloaded: row.downloadedAt ? cairoDay(row.downloadedAt) : 'لسه',
  link: certificateUrl(row.code), personalPhoto: row.personalPhotoUrl || '', idPhoto: row.idPhotoUrl || '',
});

export default function InstituteCertificatesPanel({ notify }: { notify: NotifyFn }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState('');
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState('');
  const [branch, setBranch] = useState('');
  const [downloaded, setDownloaded] = useState('');
  const [editing, setEditing] = useState<Row | null>(null);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [printed, setPrinted] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await mysqlAdmin.adminGet<Row[]>('/admin/institute-certificates');
      setRows(Array.isArray(list) ? list : []);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحميل شهادات المعهد');
    } finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await mysqlAdmin.adminPost<{ issued: number }>('/admin/institute-certificates/sync', {});
      notify('success', result.issued ? `اتصدرت ${result.issued} شهادة جديدة` : 'مفيش شهادات جديدة — القائمة محدّثة');
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحديث القائمة');
    } finally { setSyncing(false); }
  };

  const move = async (row: Row, next: Stage) => {
    setBusy(row.id);
    try {
      await mysqlAdmin.adminPatch(`/admin/institute-certificates/${encodeURIComponent(row.id)}/status`, { status: next });
      setRows(current => current.map(item => (item.id === row.id ? { ...item, status: next } : item)));
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تغيير الحالة');
    } finally { setBusy(''); }
  };

  // «أي شهادة اتطبعت في المعهد لازم يظهر عليها علامة»: every print from here is recorded (and READY moves to «اتطبعت»).
  const markPrinted = async (row: Row, mode: 'full' | 'form') => {
    try {
      await mysqlAdmin.adminPost(`/admin/institute-certificates/${encodeURIComponent(row.id)}/printed`, { mode });
      const now = new Date().toISOString();
      setRows(current => current.map(item => (item.id === row.id ? {
        ...item, printedAt: now, printCount: (item.printCount || 0) + 1, status: item.status === 'READY' ? 'PRINTED' : item.status,
      } : item)));
    } catch { /* the print is already open; the mark can be missed, the paper cannot */ }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(row => {
      if (stage && row.status !== stage) return false;
      if (branch && normBranchKey(row.branch || '') !== branch) return false;
      if (printed === 'yes' ? !row.printedAt : printed === 'no' ? !!row.printedAt : false) return false;
      if (downloaded === 'yes' ? !row.downloadedAt : downloaded === 'no' ? !!row.downloadedAt : false) return false;
      if (!q) return true;
      return [row.subscriberName, row.nameEn, row.phone, row.clientCode, row.courseTitle, row.code]
        .some(value => String(value || '').toLowerCase().includes(q));
    });
  }, [rows, query, stage, branch, downloaded, printed]);
  const picker = useRowPicker(shown);
  const downloadExcel = async () => {
    const chosen = picker.chosen.length ? picker.chosen : shown;
    if (!chosen.length) { notify('error', 'مفيش شهادات للتنزيل.'); return; }
    await exportToExcel(chosen.map(exportRow), EXPORT_COLUMNS, { filename: `institute-certificates-${cairoDateOnly()}`, title: 'شهادات المعهد' });
    notify('success', `تم تنزيل ${chosen.length} شهادة في ملف Excel${picker.chosen.length ? ' (المحدد فقط)' : ' (كل المعروض)'}.`);
  };
  const counts = useMemo(() => {
    const out: Record<string, number> = { all: rows.length, downloaded: rows.filter(row => row.downloadedAt).length, printed: rows.filter(row => row.printedAt).length };
    rows.forEach(row => { out[row.status] = (out[row.status] || 0) + 1; });
    return out;
  }, [rows]);
  const branches = useMemo(() => [...new Set(rows.map(row => normBranchKey(row.branch || '')).filter(Boolean))], [rows]);
  const selectCls = 'rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-bold text-gray-700';
  const iconBtn = 'inline-flex h-7 w-7 items-center justify-center rounded-md transition';

  return (
    <div className="space-y-3" dir="rtl">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        شهادة المعهد مجانية وبتطلع لوحدها لأي عميل دفع 90% أو أكتر من الكورس (كل ساعة، أو من «تحديث القائمة»). نفس الشهادة اللي العميل بيشوفها ويحمّلها من حسابه على الموقع.
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث بالاسم أو التليفون أو الكود أو الكورس"
            className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pr-9 pl-3 text-xs outline-none focus:ring-2 focus:ring-amber-200" />
        </div>
        <select value={stage} onChange={event => setStage(event.target.value)} className={selectCls} aria-label="الحالة">
          <option value="">كل الحالات ({counts.all || 0})</option>
          {(Object.keys(STAGES) as Stage[]).map(key => <option key={key} value={key}>{STAGES[key].label} ({counts[key] || 0})</option>)}
        </select>
        <select value={downloaded} onChange={event => setDownloaded(event.target.value)} className={selectCls} aria-label="التحميل">
          <option value="">التحميل من الموقع</option>
          <option value="yes">العميل حمّلها ({counts.downloaded || 0})</option>
          <option value="no">لسه محمّلهاش</option>
        </select>
        <select value={printed} onChange={event => setPrinted(event.target.value)} className={selectCls} aria-label="الطباعة">
          <option value="">الطباعة في المعهد</option>
          <option value="yes">اتطبعت ({counts.printed || 0})</option>
          <option value="no">لسه ما اتطبعتش</option>
        </select>
        <select value={branch} onChange={event => setBranch(event.target.value)} className={selectCls} aria-label="الفرع">
          <option value="">كل الفروع</option>
          {branches.map(key => <option key={key} value={key}>{branchLabels[key] || key}</option>)}
        </select>
        <button onClick={() => void sync()} disabled={syncing} className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50">
          <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} /> تحديث القائمة
        </button>
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700">
          <Plus size={12} /> إضافة شهادة
        </button>
        <button onClick={() => setLayoutOpen(true)} className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100">
          <Ruler size={12} /> مقاسات النموذج
        </button>
      </div>

      <SelectionExportBar picker={picker} shown={shown.length} onDownload={downloadExcel} notify={notify} />

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-14 text-center text-sm text-gray-400">
          {loading ? 'جاري التحميل…' : 'مفيش شهادات بالفلاتر دي.'}
        </div>
      ) : (
        // Five columns that fit the screen — the table used to be nine, wider than the page, and the
        // buttons at its far end were out of sight («بتظهر جزء منها … زر طباعة مش شغال»).
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full table-fixed text-xs">
            <colgroup>
              <col className="w-9" />
              <col className="w-[22%]" />
              <col />
              <col className="w-[17%]" />
              <col className="w-[170px]" />
            </colgroup>
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-2 py-2 text-center">
                  <input type="checkbox" checked={picker.allSelected} onChange={picker.toggleAll} aria-label="تحديد كل الشهادات المعروضة" />
                </th>
                {['العميل', 'الشهادة (بالإنجليزي)', 'الحالة', 'إجراءات'].map(title => (
                  <th key={title} className={`px-2 py-2 font-bold ${title === 'إجراءات' ? 'text-center' : 'text-right'}`}>{title}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 1000).map(row => {
                const share = waLink(row.phone, `مبروك يا ${row.subscriberName} 🎓\nشهادة «${row.courseTitle}» من معهد الدراسات النفسية جاهزة:\n${certificateUrl(row.code)}`);
                const ready = !row.missing?.length;
                const edited = Boolean(row.edits?.nameEn || row.edits?.courseEn || row.edits?.duration || row.edits?.trainer);
                return (
                  <tr key={row.id} className={`border-t border-gray-100 align-top hover:bg-amber-50/30 ${picker.isSelected(row.id) ? 'bg-amber-50' : ''}`}>
                    <td className="px-2 py-2 text-center">
                      <input type="checkbox" checked={picker.isSelected(row.id)} onChange={() => picker.toggle(row.id)} aria-label={`تحديد شهادة ${row.subscriberName}`} />
                    </td>
                    <td className="px-2 py-2">
                      <div className="break-words font-bold leading-snug text-gray-800">{row.subscriberName}</div>
                      {row.phone && <div className="text-right text-[11px] text-gray-500" dir="ltr">{row.phone}</div>}
                      <div className="text-[10px] text-gray-400">{row.branch ? branchLabels[normBranchKey(row.branch)] || row.branch : ''}</div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="break-words text-[11px] font-bold leading-snug text-indigo-700">{row.isTrack ? '🧭 مسار: ' : ''}{row.courseTitle}</div>
                      {row.printed?.name ? <div dir="ltr" className="break-words text-right font-bold text-gray-800">{row.printed.name}</div> : null}
                      {row.courseTitleEn && (
                        <div dir="ltr" className="break-words text-right text-[11px] text-gray-500">{row.courseTitleEn}{row.printed?.duration ? ` · ${row.printed.duration}` : ''}</div>
                      )}
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-gray-400">
                        <span className="font-mono" dir="ltr">{row.code}</span>
                        <span>اتصدرت {cairoDay(row.issuedAt)}</span>
                        {edited && <span className="font-bold text-amber-700">اتعدّلت يدوياً</span>}
                      </div>
                      {/* English only: a certificate lacking either is not printed, and says what to add. */}
                      {!ready && (
                        <div className="mt-0.5 text-[11px] font-bold text-red-600">ناقص: {row.missing.join('، ')} — اضغط «تعديل» وكمّله</div>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <select value={row.status} disabled={busy === row.id} onChange={event => void move(row, event.target.value as Stage)}
                        className={`w-full rounded-lg border-0 px-1.5 py-1 text-[11px] font-bold ${STAGES[row.status]?.cls || ''} disabled:opacity-50`} aria-label="حالة الشهادة">
                        {(Object.keys(STAGES) as Stage[]).map(key => <option key={key} value={key}>{STAGES[key].label}</option>)}
                      </select>
                      {row.statusBy && <div className="mt-0.5 text-[10px] text-gray-400">{row.statusBy}{row.statusAt ? ` · ${cairoDay(row.statusAt)}` : ''}</div>}
                      <div className="mt-1 space-y-0.5">
                        {row.printedAt
                          ? <span className="block rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700"><Printer size={10} className="inline" /> اتطبعت {cairoDay(row.printedAt)}{row.printCount > 1 ? ` · ${row.printCount}×` : ''}{row.printedBy ? ` · ${row.printedBy}` : ''}</span>
                          : <span className="block text-[10px] text-gray-300">لسه ما اتطبعتش</span>}
                        {row.downloadedAt
                          ? <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700"><Download size={10} className="inline" /> حمّلها {cairoDay(row.downloadedAt)}{row.downloads > 1 ? ` · ${row.downloads}×` : ''}</span>
                          : <span className="text-[10px] text-gray-300">لسه محمّلهاش</span>}
                      </div>
                    </td>
                    <td className="px-1 py-2">
                      {/* Icon buttons, close together; each says what it does when hovered. A certificate that is not ready
                          opens the edit dialog instead of doing nothing. */}
                      <div className="flex flex-nowrap items-center justify-center gap-1">
                        {ready ? (
                          <a href={formPrintUrl(SITE, row.code, true)} target="_blank" rel="noreferrer" onClick={() => void markPrinted(row, 'form')}
                            title="طباعة على النموذج الجاهز — اسم العميل والكورس والمدة فقط"
                            className={`${iconBtn} bg-indigo-600 text-white hover:bg-indigo-700`}><Printer size={13} /></a>
                        ) : (
                          <button onClick={() => setEditing(row)} title={`ناقص: ${row.missing.join('، ')} — كمّله الأول`} className={`${iconBtn} bg-gray-200 text-gray-500`}><Printer size={13} /></button>
                        )}
                        {ready ? (
                          <a href={certificateUrl(row.code, true)} target="_blank" rel="noreferrer" onClick={() => void markPrinted(row, 'full')} title="الشهادة بالتصميم الكامل — PDF أو طباعة"
                            className={`${iconBtn} bg-slate-800 text-white hover:bg-slate-900`}><FileText size={13} /></a>
                        ) : (
                          <button onClick={() => setEditing(row)} title={`ناقص: ${row.missing.join('، ')} — كمّله الأول`} className={`${iconBtn} bg-gray-200 text-gray-500`}><FileText size={13} /></button>
                        )}
                        <button onClick={() => setEditing(row)} title="تعديل الاسم أو الكورس أو المدة أو المحاضر"
                          className={`${iconBtn} border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100`}><Pencil size={13} /></button>
                        {share && ready && (
                          <a href={share} target="_blank" rel="noreferrer" title="ابعتها للعميل على الواتساب"
                            className={`${iconBtn} bg-emerald-600 text-white hover:bg-emerald-700`}><Share2 size={13} /></a>
                        )}
                        <button onClick={() => navigate(`/client/${row.clientCode || row.subscriberId}`)} title="ملف العميل"
                          className={`${iconBtn} border border-gray-200 bg-white text-gray-600 hover:bg-gray-100`}><ExternalLink size={13} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {layoutOpen && <FormLayoutModal sampleCode={rows.find(row => !row.missing?.length)?.code} notify={notify} onClose={() => setLayoutOpen(false)} />}
      {adding && <AddInstituteCertificateModal notify={notify} onClose={() => setAdding(false)} onChanged={() => void load()} />}
      {editing && (
        <CertificateEditModal row={{ ...editing, courseTitle: editing.courseTitle }} notify={notify} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }} />
      )}
    </div>
  );
}
