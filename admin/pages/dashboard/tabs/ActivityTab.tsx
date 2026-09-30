import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Database, Download, Loader2, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useSiteData, useEnsureLectures } from '../../../context/SiteDataContext';
import { DataTable, type Column } from '../../../components/shared/DataTable';
import type { ActivityLogItem } from '../../../types';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { confirmDialog } from '../../../../shared/ui/confirmDialog';
import { promptDialog } from '../../../../shared/ui/promptDialog';
import { downloadCsv as writeCsv } from '../../../../shared/csv';
import { cairoDateTime } from '../../../../shared/cairoDate';

interface Props {
  isSalesOnly: boolean;
}

const ACTION_LABELS: Record<string, string> = {
  create: 'إضافة',
  update: 'تحديث',
  delete: 'حذف',
  login: 'دخول',
  logout: 'خروج',
  bulk: 'إجراء جماعي',
  run: 'تشغيل',
  course_removed: 'مسح كورس',
  course_transferred: 'تحويل كورس',
  refund_created: 'طلب استرداد',
  refund_requested: 'طلب استرداد',
  refund_approved: 'استرداد',
  refund_rejected: 'رفض استرداد',
  refund_handling: 'معالجة استرداد',
  certificate_status: 'حالة شهادة',
  certificate_edited: 'تعديل شهادة',
};

const ACTION_CLASS: Record<string, string> = {
  create: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  update: 'bg-blue-50 text-blue-700 border-blue-200',
  delete: 'bg-red-50 text-red-700 border-red-200',
  login: 'bg-purple-50 text-purple-700 border-purple-200',
  logout: 'bg-gray-50 text-gray-700 border-gray-200',
};

// The server's names for them (api/lib/activityDescribe.js).
const DEPARTMENTS = ['الإدارة', 'الأونلاين', 'المبيعات', 'المبيعات والتحصيل', 'التحصيل', 'خدمة العملاء', 'فرع الدقي', 'الحسابات', 'الموارد البشرية', 'التدريب', 'الاستشارات'];
const SECTIONS = ['العملاء المحتملين', 'العملاء', 'الحسابات والمدفوعات', 'الشهادات', 'الاستردادات', 'الاستشارات', 'الدقي', 'الموظفين', 'الكورسات', 'محتوى الموقع', 'الإعدادات', 'الدعم وخدمة العملاء', 'التقارير والذكاء الاصطناعي', 'عام'];
const PAGE = 200;

type LogRow = ActivityLogItem & { details?: string | null; department?: string };
type Filters = { q: string; actor: string; department: string; section: string; from: string; to: string };
const NO_FILTERS: Filters = { q: '', actor: '', department: '', section: '', from: '', to: '' };

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadCsv(filename: string, rows: LogRow[]) {
  const header = ['التوقيت', 'المسئول', 'القسم', 'الجزء', 'الإجراء', 'التفاصيل', 'بيانات الطلب'];
  writeCsv(filename, [header, ...rows.map(row => [
    cairoDateTime(row.at), row.actorName || row.actor || '', row.department || '', row.section || '',
    ACTION_LABELS[row.action] || row.action, row.label || '', row.details || '',
  ])]);
}

/**
 * «سجل النظام محتاج تطوير اكتر ويسجل تفاصيل اكتر وكل حاجة بتحصل واسم المسئول
 * مش ايميله ومحتاجين يضاف القسم». Every change made from the panel, by name and
 * department, said in words, with what was sent — searched and filtered on the
 * server, where the whole log is, not in the last 200 rows the browser held.
 */
const ActivityTab: React.FC<Props> = ({ isSalesOnly }) => {
  const {
    isAdmin, clearAllData, courses, bundles, lectures, chapters, therapists, testimonials,
    subscribers, leads, staffMembers, consultations, orders, communityPosts, communityLibraryItems,
    communityVideos, communityEvents, discounts, content,
  } = useSiteData();

  // Lectures are not loaded at login any more — the backup export writes the lectures and chapters into the file.
  useEnsureLectures();

  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');

  // The search box waits for the typing to stop; the dropdowns apply at once.
  useEffect(() => {
    const timer = setTimeout(() => setFilters(draft), draft.q === filters.q ? 0 : 400);
    return () => clearTimeout(timer);
  }, [draft, filters.q]);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    (Object.entries(filters) as [keyof Filters, string][]).forEach(([key, value]) => { if (value) params.set(key, value); });
    try {
      const page = await mysqlAdmin.adminGet<LogRow[]>(`/admin/activity-logs?${params}`);
      const list = Array.isArray(page) ? page : [];
      setRows(prev => (offset ? [...prev, ...list] : list));
      setHasMore(list.length === PAGE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل السجل');
    } finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { void load(0); }, [load]);

  const actors = useMemo(() => ['المالك', ...staffMembers.map(member => member.name).filter(Boolean)], [staffMembers]);

  const columns: Column<LogRow>[] = [
    {
      key: 'at',
      header: 'التوقيت',
      className: 'whitespace-nowrap',
      render: row => <span className="text-xs text-gray-600">{cairoDateTime(row.at)}</span>,
    },
    {
      key: 'actor',
      header: 'المسئول',
      render: row => <span className="font-bold text-gray-800">{row.actorName || row.actor || '—'}</span>,
    },
    {
      key: 'department',
      header: 'القسم',
      render: row => <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">{row.department || '—'}</span>,
    },
    {
      key: 'section',
      header: 'الجزء',
      render: row => <span className="text-xs text-gray-600">{row.section || 'عام'}</span>,
    },
    {
      key: 'action',
      header: 'الإجراء',
      render: row => (
        <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-bold ${ACTION_CLASS[row.action] || 'border-gray-200 bg-gray-50 text-gray-700'}`}>
          {ACTION_LABELS[row.action] || row.action || 'إجراء'}
        </span>
      ),
    },
    {
      key: 'label',
      header: 'التفاصيل',
      className: 'min-w-[280px]',
      render: row => (
        <div>
          <p className="text-sm font-semibold text-gray-800">{row.label || row.entity || '—'}</p>
          {row.details && (
            <p className="mt-0.5 whitespace-pre-wrap break-all text-[11px] leading-5 text-gray-400" dir="auto">{row.details}</p>
          )}
        </div>
      ),
    },
  ];

  const hasFilters = Object.values(draft).some(Boolean);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const field = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm';
  const set = (key: keyof Filters) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft(prev => ({ ...prev, [key]: event.target.value }));

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-slate-900 text-white">
            <Activity size={20} />
          </div>
          <div>
            <h3 className="text-lg font-extrabold text-gray-900">سجل النظام</h3>
            <p className="text-xs text-gray-500">كل تعديل اتعمل من اللوحة — مين عمله وقسمه وعمل إيه وبإيه · {rows.length}{hasMore ? '+' : ''} حركة</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void load(0)} disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} تحديث
          </button>
          <button
            type="button"
            onClick={() => downloadCsv(`activity_logs_${stamp}.csv`, rows)}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50"
          >
            <Download size={14} /> CSV
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => downloadJson(`backup_full_site_${stamp}.json`, {
                _meta: { createdAt: new Date().toISOString(), version: '1.0' },
                courses, bundles, lectures, chapters, therapists, testimonials, subscribers, leads,
                staffMembers, consultations, orders, communityPosts, communityLibraryItems,
                communityVideos, communityEvents, discounts, content,
              })}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
            >
              <Database size={14} /> نسخة احتياطية
            </button>
          )}
          {!isSalesOnly && (
            <button
              type="button"
              onClick={async () => {
                if (!await confirmDialog('سيتم مسح جميع البيانات المحلية. هل أنت متأكد؟')) return;
                if ((await promptDialog('اكتب كلمة حذف للتأكيد:'))?.trim() !== 'حذف') return;
                clearAllData();
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
            >
              <Trash2 size={14} /> استعادة الافتراضي
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="relative md:col-span-2">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={draft.q} onChange={set('q')} placeholder="بحث في السجل — اسم، عميل، كود، إجراء..."
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-9 text-sm outline-none focus:border-indigo-400" />
          </label>
          <select value={draft.actor} onChange={set('actor')} className={field} aria-label="المسئول">
            <option value="">كل الموظفين</option>
            {actors.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={draft.department} onChange={set('department')} className={field} aria-label="القسم">
            <option value="">كل الأقسام</option>
            {DEPARTMENTS.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <select value={draft.section} onChange={set('section')} className={field} aria-label="الجزء">
            <option value="">كل أجزاء السيستم</option>
            {SECTIONS.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
          <input type="date" value={draft.from} onChange={set('from')} className={field} aria-label="من" />
          <input type="date" value={draft.to} onChange={set('to')} className={field} aria-label="إلى" />
          <button type="button" disabled={!hasFilters} onClick={() => setDraft(NO_FILTERS)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40">
            مسح الفلاتر
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <DataTable<LogRow> data={rows} columns={columns} loading={loading && !rows.length} total={rows.length} limit={rows.length || 25} />

      {hasMore && (
        <button type="button" disabled={loading} onClick={() => void load(rows.length)}
          className="mx-auto flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {loading && <Loader2 size={14} className="animate-spin" />} تحميل المزيد
        </button>
      )}
    </div>
  );
};

export default ActivityTab;
