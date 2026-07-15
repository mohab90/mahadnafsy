import React from 'react';

type NavItem<T extends string> = {
  id: T;
  label: string;
  icon: React.ReactNode;
  count?: number;
};

type StudentDashboardSectionNavProps<T extends string> = {
  items: NavItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
};

export function StudentDashboardSectionNav<T extends string>({
  items,
  activeId,
  onChange,
}: StudentDashboardSectionNavProps<T>) {
  return (
    <div className="flex gap-2 mb-5 flex-wrap">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onChange(item.id)}
          className={[
            'flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold transition',
            activeId === item.id
              ? 'bg-primary-600 text-white shadow'
              : 'bg-white border border-gray-200 text-gray-600 hover:border-primary-300',
          ].join(' ')}
        >
          {item.icon} {item.label}
          {item.count !== undefined && item.count > 0 && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                activeId === item.id ? 'bg-white/25 text-white' : 'bg-primary-100 text-primary-700'
              }`}
            >
              {item.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
