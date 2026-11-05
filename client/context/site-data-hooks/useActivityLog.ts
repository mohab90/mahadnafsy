import { useState } from 'react';
import type { ActivityLogItem, AuthUser } from '../../types';
import { buildActivityLog } from '../../../shared/activityLogEntry';

/**
 * `track()` is called by nearly every mutation across the provider, so this hook
 * is constructed first and `track` is threaded into the other domain hooks that need it.
 */
export function useActivityLog(authUser: AuthUser | null | undefined, initialActivityLogs: ActivityLogItem[]) {
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>(initialActivityLogs);

  const track = (action: string, entity: string, label: string) => {
    setActivityLogs((prev) => [buildActivityLog(authUser, action, entity, label), ...prev]);
  };

  const resetActivityLogs = () => setActivityLogs([]);

  return { activityLogs, track, resetActivityLogs };
}
