import { lazy } from 'react';
import { Activity, Database, Shield, ShieldCheck } from 'lucide-react';
import type { NotifyFn } from '../../../types';
import { SectionedTab, type TabSection } from './SectionedTab';

/**
 * Security, and the two screens that watch the machine underneath it.
 *
 * لوحة الأمان and قائمة IP المسموحة answer the same question from two sides —
 * what happened, and who is allowed in — and sat as separate menu entries, so
 * acting on something the dashboard showed meant navigating away from it.
 * مراقبة السيرفر and ترحيل قاعدة البيانات are the same pairing for the
 * infrastructure: one reports, one intervenes.
 *
 * Each keeps the permission it had: view_security to look, manage_security to
 * change the allowlist. Someone with only the first sees only the panels they
 * could already open.
 */

const SecurityDashboardTab = lazy(() => import('./SecurityDashboardTab'));
const IpWhitelistTab = lazy(() => import('./IpWhitelistTab'));
const ServerMonitorTab = lazy(() => import('./ServerMonitorTab'));
const PgMigrateTab = lazy(() => import('./PgMigrateTab'));

// Each gate is the one that actually rendered the screen before, which for the
// last two was an inline check rather than the permission map: مراقبة السيرفر
// was admin-only, and ترحيل قاعدة البيانات asked for manage_staff. Taking the
// map's looser answer instead would have handed both to more people than had
// them.
export const SECURITY_SECTIONS: TabSection[] = [
  { id: 'dashboard', label: 'لوحة الأمان', icon: ShieldCheck, permission: 'view_security', Component: SecurityDashboardTab },
  { id: 'ip', label: 'قائمة IP المسموحة', icon: Shield, permission: 'manage_security', Component: IpWhitelistTab },
  { id: 'server', label: 'مراقبة السيرفر', icon: Activity, permission: 'view_security', adminOnly: true, Component: ServerMonitorTab },
  { id: 'migrate', label: 'ترحيل قاعدة البيانات', icon: Database, permission: 'manage_staff', Component: PgMigrateTab },
];

/** The retired menu keys, and the section each one now opens. */
export const RETIRED_SECURITY_TABS: Record<string, string> = {
  security_dashboard: 'dashboard',
  ip_whitelist: 'ip',
  server_monitor: 'server',
  pg_migrate: 'migrate',
};

export default function SecurityCenterTab({ notify }: { notify: NotifyFn }) {
  return (
    <SectionedTab
      sections={SECURITY_SECTIONS}
      notify={notify}
      basePath="security_center"
      emptyMessage="لا توجد لوحات أمان مسموح لك بالاطلاع عليها."
    />
  );
}
