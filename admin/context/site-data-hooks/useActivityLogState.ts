import { useState } from 'react';
import type { ActivityLogItem, AuthUser } from '../../types';
import { buildActivityLog } from '../../../shared/activityLogEntry';

// `track` is called by nearly every CRUD function across domains — kept as a single
// shared hook so all domain hooks can accept it as a plain parameter.
export function useActivityLogState(authUser: AuthUser | null | undefined, initialActivityLogs: ActivityLogItem[]) {
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>(initialActivityLogs);

  const track = (action: string, entity: string, label: string) => {
    setActivityLogs((prev) => [buildActivityLog(authUser, action, entity, label), ...prev]);
  };

  return { activityLogs, setActivityLogs, track };
}
