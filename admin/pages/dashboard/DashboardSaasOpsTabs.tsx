import React, { Suspense } from 'react';

import { TabErrorBoundary } from '../../../shared/ui/TabErrorBoundary';
import type { StaffPermission } from '../../types';
import type { TabKey } from './navigation';
import {
  AdminAiSettingsTab,
  AskAITab,
  AutomationTab,
  MessagingAgentTab,
  PgMigrateTab,
  ServerMonitorTab,
} from './lazyTabs';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

type DashboardSaasOpsTabsProps = {
  activeTab: TabKey;
  notify: NotifyFn;
  isAdmin: boolean;
  hasPermission: (permission: StaffPermission) => boolean;
  setActiveTab: (tab: TabKey) => void;
};

function Spinner({ tone }: { tone: 'indigo' | 'violet' | 'sky' }) {
  const toneClass = {
    indigo: 'border-indigo-500',
    violet: 'border-violet-500',
    sky: 'border-sky-500',
  }[tone];

  return (
    <div className="flex items-center justify-center p-16">
      <span className={`h-6 w-6 animate-spin rounded-full border-2 border-t-transparent ${toneClass}`} />
    </div>
  );
}

function LoadingText({ padded = false }: { padded?: boolean }) {
  return <div className={`${padded ? 'p-8' : 'py-8'} text-center text-gray-400`}>جاري التحميل...</div>;
}

export function DashboardSaasOpsTabs({
  activeTab,
  notify,
  isAdmin,
  hasPermission,
  setActiveTab,
}: DashboardSaasOpsTabsProps) {
  if (activeTab === 'ask_ai') {
    return (
      <Suspense fallback={<Spinner tone="indigo" />}>
        <AskAITab notify={notify} />
      </Suspense>
    );
  }

  if (activeTab === 'automation') {
    return (
      <Suspense fallback={<Spinner tone="violet" />}>
        <AutomationTab notify={notify} setActiveTab={(tab) => setActiveTab(tab as TabKey)} />
      </Suspense>
    );
  }

  if (activeTab === 'messaging_agent') {
    return (
      <Suspense fallback={<Spinner tone="sky" />}>
        <MessagingAgentTab notify={notify} />
      </Suspense>
    );
  }

  if (activeTab === 'admin_ai_settings') {
    return (
      <Suspense fallback={<LoadingText />}>
        <AdminAiSettingsTab notify={notify} />
      </Suspense>
    );
  }

  if (activeTab === 'pg_migrate' && (isAdmin || hasPermission('manage_staff'))) {
    return (
      <Suspense fallback={<LoadingText padded />}>
        <PgMigrateTab />
      </Suspense>
    );
  }

  if (activeTab === 'server_monitor' && isAdmin) {
    return (
      <Suspense fallback={<LoadingText padded />}>
        <TabErrorBoundary>
          <ServerMonitorTab notify={notify} />
        </TabErrorBoundary>
      </Suspense>
    );
  }

  return null;
}
