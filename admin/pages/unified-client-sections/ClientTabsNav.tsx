import React from 'react';

type Tab = 'overview' | 'communications' | 'payments' | 'courses' | 'certificates' | 'installments' | 'consultations' | 'daqqi' | 'edit';

interface Props {
  tabs: [Tab, string][];
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
}

export function ClientTabsNav({ tabs, activeTab, setActiveTab }: Props) {
  return (
    <div className="flex items-center gap-0 overflow-x-auto border-b border-gray-100 bg-white rounded-t-2xl px-3">
      {tabs.map(([tab, label]) => (
        <button key={tab}
          onClick={() => setActiveTab(tab)}
          className={`px-3 py-3 text-xs font-bold whitespace-nowrap border-b-2 transition-colors ${
            activeTab === tab
              ? 'text-indigo-700 border-indigo-500'
              : 'text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-50'
          }`}>
          {label}
        </button>
      ))}
    </div>
  );
}
