import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, ExternalLink, FileText, RefreshCw, Search, Share2 } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { waLink } from '../../../lib/whatsappLink';
import { cairoDay } from '../../../../shared/cairoDate';
import { branchLabels, normBranchKey } from '../../unified-client/constants';

// «تاب في صفحه الشهادات اسمه شهادات المعهد ودا بيكون اتوماتك ومجاني لاي عميل خلص
// فلوسه او 90 % من فلوسه … نقدر نطلع منها نسخه pdf ونعملها شير للعميل او نعملها
// طباعه وبردو يمشي في خطوات اتشحنت او في الفرع … لو العميل عمل تحميل للشهاده pdf
// من الموقع يظهر» (8 Oct 2026). The certificates themselves are issued by the
// server every hour (api/lib/instituteCertificates.js); this follows each one.
type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type Stage = 'READY' | 'PRINTED' | 'AT_BRANCH' | 'SHIPPED' | 'DELIVERED' | 'RETURNED';
type Row = {
  id: string; code: string; issuedAt: string; status: Stage; statusAt: string | null; statusBy: string | null;
  downloadedAt: string | null; downloads: number; subscriberId: string; subscriberName: string; nameEn: string | null;
  phone: string; clientCode: string | null; branch: string | null; courseTitle: string;
};

const STAGES: Record<Stage, { label: string; cls: string }> = {
  READY: { label: 'جاهزة', cls: 'bg-amber-100 text-amber-800' },
  PRINTED: { label: 'اتطبعت', cls: 'bg-blue-100 text-blue-800' },
  AT_BRANCH: { label: 'في الفرع', cls: 'bg-indigo-100 text-indigo-800' },
  SHIPPED: { label: 'اتشحنت', cls: 'bg-violet-100 text-violet-800' },
  DELIVERED: { label: 'العميل استلم', cls: 'bg-emerald-100 text-emerald-800' },
  RETURNED: { label: 'مرتجع', cls: 'bg-rose-100 text-rose-800' },
};
// The site serves the printable certificate; the desk's own opens are marked so
// they are not read as the client downloading it.
const SITE = 'https://mahadnafsy.com';
const certificateUrl = (code: string, staff = false) => `${SITE}/api/completions/${encodeURIComponent(code)}/certificate${staff ? '?staff=1' : ''}`;

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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(row => {
      if (stage && row.status !== stage) return false;
      if (branch && normBranchKey(row.branch || '') !== branch) return false;
      if (downloaded === 'yes' ? !row.downloadedAt : downloaded === 'no' ? !!row.downloadedAt : false) return false;
      if (!q) return true;
      return [row.subscriberName, row.nameEn, row.phone, row.clientCode, row.courseTitle, row.code]
        .some(value => String(value || '').toLowerCase().includes(q));
    });
  }, [rows, query, stage, branch, downloaded]);
  const counts = useMemo(() => {
    const out: Record<string, number> = { all: rows.length, downloaded: rows.filter(row => row.downloadedAt).length };
    rows.forEach(row => { out[row.status] = (out[row.status] || 0) + 1; });
    return out;
  }, [rows]);
  const branches = useMemo(() => [...new Set(rows.map(row => normBranchKey(row.branch || '')).filter(Boolean))], [rows]);
  const selectCls = 'rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-bold text-gray-700';
  const btn = 'inline-flex items-center gap-0.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-bold';

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
        <select value={branch} onChange={event => setBranch(event.target.value)} className={selectCls} aria-label="الفرع">
          <option value="">كل الفروع</option>
          {branches.map(key => <option key={key} value={key}>{branchLabels[key] || key}</option>)}
        </select>
        <button onClick={() => void sync()} disabled={syncing} className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50">
          <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} /> تحديث القائمة
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-14 text-center text-sm text-gray-400">
          {loading ? 'جاري التحميل…' : 'مفيش شهادات بالفلاتر دي.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                {['العميل', 'الكورس', 'الاسم على الشهادة', 'رقم الشهادة', 'اتصدرت', 'الحالة', 'من الموقع', 'إجراءات'].map(title => (
                  <th key={title} className="px-3 py-2 text-right font-bold">{title}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 1000).map(row => {
                const share = waLink(row.phone, `مبروك يا ${row.subscriberName} 🎓\nشهادة «${row.courseTitle}» من معهد الدراسات النفسية جاهزة:\n${certificateUrl(row.code)}`);
                return (
                  <tr key={row.id} className="border-t border-gray-100 align-top hover:bg-amber-50/30">
                    <td className="px-3 py-2">
                      <div className="whitespace-nowrap font-bold text-gray-800">{row.subscriberName}</div>
                      {row.phone && <div className="text-right text-[11px] text-gray-500" dir="ltr">{row.phone}</div>}
                      <div className="text-[10px] text-gray-400">{row.branch ? branchLabels[normBranchKey(row.branch)] || row.branch : ''}</div>
                    </td>
                    <td className="px-3 py-2 font-bold text-indigo-700">{row.courseTitle}</td>
                    <td className="px-3 py-2">
                      {row.nameEn ? <div dir="ltr" className="text-right">{row.nameEn}</div> : <div className="text-[11px] text-red-600">مفيش اسم بالإنجليزي — هيطلع بالعربي</div>}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-gray-500" dir="ltr">{row.code}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-500">{cairoDay(row.issuedAt)}</td>
                    <td className="px-3 py-2">
                      <select value={row.status} disabled={busy === row.id} onChange={event => void move(row, event.target.value as Stage)}
                        className={`rounded-lg border-0 px-2 py-1 text-[11px] font-bold ${STAGES[row.status]?.cls || ''} disabled:opacity-50`} aria-label="حالة الشهادة">
                        {(Object.keys(STAGES) as Stage[]).map(key => <option key={key} value={key}>{STAGES[key].label}</option>)}
                      </select>
                      {row.statusBy && <div className="mt-0.5 text-[10px] text-gray-400">{row.statusBy}{row.statusAt ? ` · ${cairoDay(row.statusAt)}` : ''}</div>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {row.downloadedAt
                        ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700"><Download size={10} className="inline" /> حمّلها {cairoDay(row.downloadedAt)}{row.downloads > 1 ? ` · ${row.downloads} مرات` : ''}</span>
                        : <span className="text-[10px] text-gray-300">لسه</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-nowrap items-center gap-1">
                        <a href={certificateUrl(row.code, true)} target="_blank" rel="noreferrer" title="الشهادة — طباعة أو حفظ PDF"
                          className={`${btn} bg-slate-800 text-white hover:bg-slate-900`}><FileText size={10} /> PDF / طباعة</a>
                        {share && (
                          <a href={share} target="_blank" rel="noreferrer" title="ابعتها للعميل على الواتساب"
                            className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}><Share2 size={10} /> شير</a>
                        )}
                        <button onClick={() => navigate(`/client/${row.clientCode || row.subscriberId}`)} className={`${btn} border border-gray-200 bg-white text-gray-600 hover:bg-gray-100`}>
                          <ExternalLink size={10} /> الملف
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
