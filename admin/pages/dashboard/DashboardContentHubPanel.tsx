import { Globe } from 'lucide-react';

import { CONTENT_HUB_ACTIONS, CONTENT_HUB_TABS } from './contentHubConfig';
import type { TabKey } from './navigation';

type Props = {
  contentHubSubTab: TabKey;
  setContentHubSubTab: (tab: TabKey) => void;
  setActiveTab: (tab: TabKey) => void;
};

export function DashboardContentHubPanel({
  contentHubSubTab,
  setContentHubSubTab,
  setActiveTab,
}: Props) {
  return (
    <div className="space-y-4" dir="rtl">
      <div className="rounded-2xl bg-gradient-to-l from-violet-600 to-indigo-600 p-5 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold">
              <Globe size={22} /> صفحات الموقع
            </h2>
            <p className="mt-1 text-sm text-indigo-100">إدارة صفحات الموقع والمحتوى المساعد من مكان واحد</p>
          </div>
          <div className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-indigo-50">
            {CONTENT_HUB_TABS.length + CONTENT_HUB_ACTIONS.length} منطقة محتوى
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl bg-gray-100 p-1.5">
        {CONTENT_HUB_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setContentHubSubTab(tab.key)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-all ${
              contentHubSubTab === tab.key
                ? 'bg-white font-bold text-violet-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <span className="grid h-5 w-5 place-items-center rounded-md bg-white/70 text-[11px] font-black text-violet-700">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {CONTENT_HUB_ACTIONS.map((action) => (
          <button
            key={action.key}
            type="button"
            onClick={() => setActiveTab(action.key)}
            className="rounded-xl border border-gray-200 bg-white p-3 text-right shadow-sm transition hover:border-violet-200 hover:bg-violet-50/60"
          >
            <span className="block text-sm font-extrabold text-gray-900">{action.label}</span>
            <span className="mt-1 block text-xs leading-5 text-gray-500">{action.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
