import { ArrowLeft, ChevronRight, ExternalLink, Globe } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { CONTENT_HUB_ACTIONS, CONTENT_HUB_TABS } from './contentHubConfig';
import type { TabKey } from './navigation';

type Props = {
  contentHubSubTab: TabKey;
  setContentHubSubTab: (tab: TabKey) => void;
  setActiveTab: (tab: TabKey) => void;
};

/**
 * «صفحات الموقع»: a grid of the site's pages, each a card saying what is edited
 * there. Choosing one opens its editor under a slim bar that leads back here.
 * The address follows (/dashboard/content_hub/<page>), so a refresh or the
 * browser's back button stays on the same page.
 */
export function DashboardContentHubPanel({
  contentHubSubTab,
  setContentHubSubTab,
  setActiveTab,
}: Props) {
  const navigate = useNavigate();
  const current = CONTENT_HUB_TABS.find(tab => tab.key === contentHubSubTab);

  const open = (key: TabKey) => {
    setContentHubSubTab(key);
    navigate(`/dashboard/content_hub/${key}`);
  };
  const backToGrid = () => {
    setContentHubSubTab('content_hub');
    navigate('/dashboard/content_hub');
  };

  if (current) {
    const Icon = current.icon;
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-3 py-2.5 shadow-sm" dir="rtl">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <button type="button" onClick={backToGrid}
            className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 font-bold text-gray-500 transition hover:bg-gray-100 hover:text-gray-900">
            <ChevronRight size={16} /> صفحات الموقع
          </button>
          <span className="text-gray-300">/</span>
          <span className="flex min-w-0 items-center gap-1.5 font-extrabold text-gray-900">
            <Icon size={16} className="flex-none text-primary-600" />
            <span className="truncate">{current.label}</span>
          </span>
        </div>
        <label className="flex items-center gap-2 text-xs font-bold text-gray-500">
          <span className="hidden sm:inline">روح لصفحة تانية</span>
          <select
            value={current.key}
            onChange={event => open(event.target.value as TabKey)}
            className="rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm font-bold text-gray-700 focus:border-primary-400 focus:outline-none"
          >
            {CONTENT_HUB_TABS.map(tab => <option key={tab.key} value={tab.key}>{tab.label}</option>)}
          </select>
        </label>
      </div>
    );
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-xl font-extrabold text-gray-900">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-50 text-primary-700"><Globe size={20} /></span>
          صفحات الموقع
        </h2>
        <p className="mt-2 text-sm leading-6 text-gray-500">
          اختار الصفحة اللي عايز تعدل فيها. كل صفحة متقسمة بنفس ترتيب أقسامها في الموقع، وكل خانة مكتوب فيها الكلام اللي ظاهر دلوقتي.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {CONTENT_HUB_TABS.map((tab, index) => {
          const Icon = tab.icon;
          const featured = index === 0;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => open(tab.key)}
              className={`group flex items-start gap-3 rounded-2xl border p-4 text-right shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                featured
                  ? 'border-primary-200 bg-gradient-to-l from-primary-50 to-white hover:border-primary-300 sm:col-span-2 xl:col-span-1'
                  : 'border-gray-200 bg-white hover:border-primary-200'
              }`}
            >
              <span className={`grid h-11 w-11 flex-none place-items-center rounded-xl transition ${
                featured ? 'bg-primary-600 text-white' : 'bg-gray-50 text-gray-600 group-hover:bg-primary-50 group-hover:text-primary-700'
              }`}>
                <Icon size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[15px] font-extrabold text-gray-900">
                  {tab.label}
                  {featured && <span className="rounded-full bg-primary-600 px-2 py-0.5 text-[10px] font-bold text-white">جديد</span>}
                </span>
                <span className="mt-1 block text-xs leading-5 text-gray-500">{tab.description}</span>
              </span>
              <ArrowLeft size={16} className="mt-1 flex-none text-gray-300 transition group-hover:-translate-x-0.5 group-hover:text-primary-600" />
            </button>
          );
        })}
      </div>

      <div>
        <p className="mb-2 text-xs font-bold text-gray-400">ليها شاشات خاصة بيها</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {CONTENT_HUB_ACTIONS.map(action => (
            <button
              key={action.key}
              type="button"
              onClick={() => setActiveTab(action.key)}
              className="flex items-start justify-between gap-2 rounded-2xl border border-dashed border-gray-300 bg-white p-3 text-right transition hover:border-primary-200 hover:bg-primary-50"
            >
              <span>
                <span className="block text-sm font-extrabold text-gray-900">{action.label}</span>
                <span className="mt-1 block text-xs leading-5 text-gray-500">{action.description}</span>
              </span>
              <ExternalLink size={14} className="mt-0.5 flex-none text-gray-400" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
