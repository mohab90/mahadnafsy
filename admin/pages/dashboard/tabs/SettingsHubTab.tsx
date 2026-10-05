// مركز الإعدادات — every setting in the system, by area, searchable.
// What is listed, and where each entry opens, is settingsHubConfig.ts.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Search, SlidersHorizontal } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { hasPermission, type PermissionKey, type RoleKey } from '../../../constants/permissions';
import { useBranches } from '../../../hooks/useBranches';
import { TAB_PERMISSION_MAP } from '../dashboardShared';
import { SETTINGS_GROUPS, searchSettings, type SettingsEntry } from './settingsHubConfig';

export default function SettingsHubTab() {
  const { isAdmin, currentStaff } = useSiteData();
  const branches = useBranches();
  const [query, setQuery] = useState('');
  const [area, setArea] = useState<string>('all');

  // An entry is listed to whoever can open what it links to, by the same rule
  // DashboardTabContainer applies when the screen is opened.
  const canOpen = useMemo(() => {
    const subject = currentStaff
      ? { role: currentStaff.role as RoleKey, permissions: currentStaff.permissions as PermissionKey[] | undefined }
      : null;
    const has = (permission: string) => hasPermission(subject, permission as PermissionKey);
    return (entry: SettingsEntry) => {
      if (isAdmin) return true;
      if (entry.permission) return has(entry.permission);
      const required = TAB_PERMISSION_MAP[entry.tab];
      if (required === null) return true;
      if (required === undefined) return false;
      return Array.isArray(required) ? required.some(has) : has(required);
    };
  }, [isAdmin, currentStaff]);

  const visible = useMemo(
    () => SETTINGS_GROUPS.map(g => ({ ...g, entries: g.entries.filter(canOpen) })).filter(g => g.entries.length),
    [canOpen],
  );
  const found = useMemo(() => searchSettings(visible, query), [visible, query]);
  const shown = query.trim() ? found : area === 'all' ? found : found.filter(g => g.key === area);
  const total = visible.reduce((n, g) => n + g.entries.length, 0);
  const tagamoaOn = branches.some(b => b.id === 'TAGAMOA');

  return (
    <div className="space-y-5" dir="rtl">
      <header className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gray-900 text-white">
              <SlidersHorizontal size={21} />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-gray-900">مركز الإعدادات</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500">
                كل إعداد في الموقع والسيستم في مكان واحد، مقسّم حسب الجزء اللي بيأثر عليه. اكتب اللي بتدوّر عليه أو اختار القسم.
              </p>
            </div>
          </div>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600 tabular-nums">{total} إعداد</span>
        </div>
        <label className="relative mt-4 block">
          <Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="ابحث: لوجو، فرع التجمع، Paymob، بصمة، سعر الشهادة…"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pr-9 pl-3 text-sm focus:border-primary-400 focus:bg-white focus:outline-none"
          />
        </label>
        {!query.trim() && (
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
            {[{ key: 'all', title: 'الكل' }, ...visible].map(g => (
              <button
                key={g.key}
                type="button"
                onClick={() => setArea(g.key)}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold transition ${area === g.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {g.title}
              </button>
            ))}
          </div>
        )}
      </header>

      {shown.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
          مفيش إعداد بالكلام ده. جرّب كلمة تانية.
        </div>
      )}

      {shown.map(group => (
        <section key={group.key} className="space-y-2.5" aria-labelledby={`settings-${group.key}`}>
          <div className="flex items-baseline gap-2 px-1">
            <span className={`h-2.5 w-2.5 shrink-0 self-center rounded-full ${group.tone}`} />
            <h3 id={`settings-${group.key}`} className="text-base font-extrabold text-gray-900">{group.title}</h3>
            <p className="text-xs text-gray-500">{group.blurb}</p>
          </div>
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {group.entries.map(entry => (
              <div key={entry.title} className="group flex flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-gray-300 hover:shadow-md">
                <Link to={entry.href} className="flex items-start justify-between gap-2">
                  <span className="text-sm font-extrabold text-gray-900 group-hover:text-primary-700">{entry.title}</span>
                  <ChevronLeft size={16} className="mt-0.5 shrink-0 text-gray-300 group-hover:text-primary-600" />
                </Link>
                <p className="mt-1.5 text-xs leading-5 text-gray-500">{entry.desc}</p>
                {entry.tab === 'branches_settings' && (
                  <p className={`mt-2 w-fit rounded-full px-2 py-0.5 text-[11px] font-bold ${tagamoaOn ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    فرع التجمع: {tagamoaOn ? 'شغّال' : 'مقفول'}
                  </p>
                )}
                {entry.links && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {entry.links.map(link => (
                      <Link key={link.href} to={link.href} className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-bold text-gray-600 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700">
                        {link.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
