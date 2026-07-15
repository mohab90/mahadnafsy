import React, { useMemo, useState } from 'react';
import { Activity, Database, Download, Search, Trash2 } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { DataTable, type Column } from '../../../components/shared/DataTable';
import type { ActivityLogItem } from '../../../types';

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
};

const ACTION_CLASS: Record<string, string> = {
  create: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  update: 'bg-blue-50 text-blue-700 border-blue-200',
  delete: 'bg-red-50 text-red-700 border-red-200',
  login: 'bg-purple-50 text-purple-700 border-purple-200',
  logout: 'bg-gray-50 text-gray-700 border-gray-200',
};

function csvEscape(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadCsv(filename: string, rows: ActivityLogItem[]) {
  const header = ['action', 'entity', 'label', 'actor', 'section', 'at'];
  const csv = [
    header.join(','),
    ...rows.map((row) => header.map((key) => csvEscape((row as unknown as Record<string, unknown>)[key])).join(',')),
  ].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const ActivityTab: React.FC<Props> = ({ isSalesOnly }) => {
  const {
    activityLogs,
    isAdmin,
    clearAllData,
    courses,
    bundles,
    lectures,
    chapters,
    therapists,
    testimonials,
    subscribers,
    leads,
    staffMembers,
    consultations,
    orders,
    communityPosts,
    communityLibraryItems,
    communityVideos,
    communityEvents,
    discounts,
    content,
  } = useSiteData();

  const [search, setSearch] = useState('');
  const [actor, setActor] = useState('');
  const [section, setSection] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const actors = useMemo(
    () => [...new Set(activityLogs.map((row) => row.actorName || row.actor || '').filter(Boolean))],
    [activityLogs],
  );
  const sections = useMemo(
    () => [...new Set(activityLogs.map((row) => row.section || 'عام').filter(Boolean))],
    [activityLogs],
  );

  const filteredLogs = useMemo(() => {
    const query = search.trim().toLowerCase();
    return activityLogs.filter((row) => {
      const rowActor = row.actorName || row.actor || '';
      const rowSection = row.section || 'عام';
      const rowDate = String(row.at || '').slice(0, 10);
      if (actor && rowActor !== actor) return false;
      if (section && rowSection !== section) return false;
      if (dateFrom && rowDate < dateFrom) return false;
      if (dateTo && rowDate > dateTo) return false;
      if (query) {
        const haystack = `${row.action} ${row.entity} ${row.label} ${rowActor} ${rowSection}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [activityLogs, actor, dateFrom, dateTo, search, section]);

  const columns: Column<ActivityLogItem>[] = [
    {
      key: 'action',
      header: 'الإجراء',
      render: (row) => (
        <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-bold ${ACTION_CLASS[row.action] || 'border-gray-200 bg-gray-50 text-gray-700'}`}>
          {ACTION_LABELS[row.action] || row.action || 'إجراء'}
        </span>
      ),
    },
    {
      key: 'section',
      header: 'القسم',
      render: (row) => row.section || 'عام',
    },
    {
      key: 'label',
      header: 'التفاصيل',
      className: 'min-w-[220px]',
      render: (row) => <span title={row.label}>{row.label || row.entity || '-'}</span>,
    },
    {
      key: 'actor',
      header: 'المسؤول',
      render: (row) => row.actorName || row.actor || '-',
    },
    {
      key: 'at',
      header: 'التوقيت',
      render: (row) => row.at || '-',
    },
  ];

  const hasFilters = Boolean(search || actor || section || dateFrom || dateTo);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-slate-900 text-white">
            <Activity size={20} />
          </div>
          <div>
            <h3 className="text-lg font-extrabold text-gray-900">سجل النظام</h3>
            <p className="text-xs text-gray-500">
              {filteredLogs.length} حركة{activityLogs.length !== filteredLogs.length ? ` من إجمالي ${activityLogs.length}` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => downloadCsv(`activity_logs_${stamp}.csv`, filteredLogs)}
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
              onClick={() => {
                if (!window.confirm('سيتم مسح جميع البيانات المحلية. هل أنت متأكد؟')) return;
                if (window.prompt('اكتب كلمة حذف للتأكيد:')?.trim() !== 'حذف') return;
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
        <div className="grid gap-3 md:grid-cols-5">
          <label className="relative md:col-span-2">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="بحث في السجل..."
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-9 text-sm outline-none focus:border-indigo-400"
            />
          </label>
          <select value={section} onChange={(event) => setSection(event.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="">كل الأقسام</option>
            {sections.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={actor} onChange={(event) => setActor(event.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="">كل الموظفين</option>
            {actors.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <button
            type="button"
            disabled={!hasFilters}
            onClick={() => {
              setSearch('');
              setActor('');
              setSection('');
              setDateFrom('');
              setDateTo('');
            }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            مسح الفلاتر
          </button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
        </div>
      </div>

      <DataTable<ActivityLogItem>
        data={filteredLogs}
        columns={columns}
        total={filteredLogs.length}
        limit={filteredLogs.length || 25}
      />
    </div>
  );
};

export default ActivityTab;
