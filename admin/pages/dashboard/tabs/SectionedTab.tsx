import { Suspense, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import type { NotifyFn, StaffPermission } from '../../../types';
import { hasPermission, type PermissionKey, type RoleKey } from '../../../constants/permissions';
import { useSiteData } from '../../../context/SiteDataContext';

/**
 * One menu entry holding several screens, each still its own section.
 *
 * The settings menu had seventeen entries, a dozen of which were a single card:
 * a gateway key here, a webhook URL there. Grouping them means one place to go
 * and one glance to see what is configured — but grouping screens must never
 * group who can open them. Each section keeps the permission it had as its own
 * entry, so the strip shows a viewer only what they could already reach, and
 * the tab opens for anyone holding any one of them.
 *
 * The section is the second URL segment, so /dashboard/security/ip is a link
 * worth sending, and the retired routes redirect into it.
 */

export type TabSection = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** The permission this section required when it was its own screen. */
  permission: StaffPermission;
  /**
   * Set where the screen was gated on `isAdmin` alone rather than a permission.
   * Merging must not widen access any more than it narrows it, and مراقبة
   * السيرفر was admin-only where the permission map said view_security.
   */
  adminOnly?: boolean;
  Component: React.ComponentType<{ notify: NotifyFn }>;
};

export function SectionedTab({
  sections,
  notify,
  basePath,
  emptyMessage = 'لا توجد أقسام مسموح لك بإدارتها.',
}: {
  sections: TabSection[];
  notify: NotifyFn;
  /** The tab key, e.g. 'integrations' — the first URL segment after /dashboard. */
  basePath: string;
  emptyMessage?: string;
}) {
  const navigate = useNavigate();
  const { param } = useParams<{ param?: string }>();
  const { isAdmin, currentStaff } = useSiteData();

  const allowed = useMemo(() => {
    // From the context. staffMembers is empty for the ten roles that cannot
    // read the staff list, and searching it alone meant this returned no
    // sections at all for them.
    const self = currentStaff;
    const subject = self
      ? { role: self.role as RoleKey, permissions: self.permissions as PermissionKey[] | undefined }
      : null;
    return sections.filter(s => {
      if (isAdmin) return true;
      if (s.adminOnly) return false;
      return hasPermission(subject, s.permission as PermissionKey);
    });
  }, [sections, isAdmin, currentStaff]);

  const active = useMemo(
    () => allowed.find(s => s.id === param) ?? allowed[0],
    [param, allowed],
  );

  // Reachable when a link points at a section this viewer cannot open. The tab
  // opens for anyone holding any one of its permissions, so having none of them
  // here means the link, not the tab, was the wrong door.
  if (!active) {
    return (
      <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        {emptyMessage}
      </p>
    );
  }

  const Active = active.Component;
  return (
    <div className="space-y-4">
      {allowed.length > 1 && (
        <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-3">
          {allowed.map(section => {
            const Icon = section.icon;
            const isActive = section.id === active.id;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => navigate(`/dashboard/${basePath}/${section.id}`)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition ${
                  isActive
                    ? 'border-indigo-600 bg-indigo-600 text-white'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Icon size={16} />
                {section.label}
              </button>
            );
          })}
        </div>
      )}

      <Suspense
        fallback={(
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-indigo-600" />
          </div>
        )}
      >
        <Active notify={notify} />
      </Suspense>
    </div>
  );
}
