import React from 'react';

type CommunityAdminTab = 'pending' | 'posts' | 'library' | 'videos' | 'events' | 'comments';

interface DashboardCommunityShellProps {
  active: boolean;
  tab: CommunityAdminTab;
  setTab: (tab: CommunityAdminTab) => void;
  counts: {
    posts: number;
    pending: number;
    library: number;
    videos: number;
    events: number;
  };
  children: React.ReactNode;
}

const communityTabs: Array<[CommunityAdminTab, string]> = [
  ['pending', 'المعلقة ⏳'],
  ['posts', 'المنشورات 📝'],
  ['library', 'المكتبة 📚'],
  ['videos', 'الفيديوهات 🎬'],
  ['events', 'الفعاليات 📅'],
];

export const DashboardCommunityShell: React.FC<DashboardCommunityShellProps> = ({
  active,
  tab,
  setTab,
  counts,
  children,
}) => {
  if (!active) return null;

  return (
    <div className="space-y-5 animate-fade-in" dir="rtl">
      <div className="bg-gradient-to-r from-teal-600 to-emerald-600 rounded-2xl p-6 text-white">
        <h2 className="text-2xl font-extrabold flex items-center gap-2">🫂 إدارة المجتمع</h2>
        <p className="text-teal-100 text-sm mt-1">إدارة المنشورات والمكتبة والفيديوهات والفعاليات</p>
        <div className="flex gap-3 mt-4 text-center flex-wrap">
          {[
            ['المنشورات', counts.posts],
            ['معلقة', counts.pending],
            ['المكتبة', counts.library],
            ['الفيديوهات', counts.videos],
            ['الفعاليات', counts.events],
          ].map(([label, count]) => (
            <div key={label as string} className="bg-white/20 rounded-xl px-4 py-2">
              <p className="text-xl font-black">{count}</p>
              <p className="text-xs">{label as string}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        {communityTabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition ${tab === key ? 'bg-teal-600 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
};
