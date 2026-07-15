import React from 'react';

import type { TabKey } from './navigation';
import OnlineClientsTab from './tabs/OnlineClientsTab';

type DashboardClientTabsProps = {
  activeTab: TabKey;
  canViewDaqqiClients: boolean;
  onlineClientsProps: React.ComponentProps<typeof OnlineClientsTab>;
};

export function DashboardClientTabs({
  activeTab,
  canViewDaqqiClients,
  onlineClientsProps,
}: DashboardClientTabsProps) {
  if (activeTab !== 'online_clients' && !(activeTab === 'daqqi_clients' && canViewDaqqiClients)) {
    return null;
  }

  return <OnlineClientsTab {...onlineClientsProps} />;
}
