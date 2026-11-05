import { useEffect, useState } from 'react';
import type { NotificationBroadcast } from '../../types';
import { mysqlClient } from '../../lib/mysqlapi';

/** Customer broadcasts loaded from the tenant notification settings endpoint. */
export function useNotifications(
  initialNotifications: NotificationBroadcast[],
  authUserUid?: string,
  isAdmin = false,
  // Asked for by the screens that show them (the student dashboard), not by every page: one request less on each other page.
  enabled = true,
) {
  const [notifications, setNotifications] = useState<NotificationBroadcast[]>(initialNotifications);
  const [readIds, setReadIds] = useState<string[]>([]);

  useEffect(() => {
    if (!authUserUid || isAdmin) {
      setNotifications([]);
      return;
    }
    if (!enabled) return;
    let cancelled = false;
    void mysqlClient.getBroadcastNotifications().then((result) => {
      if (!cancelled) {
        setNotifications(result.notifications as unknown as NotificationBroadcast[]);
        setReadIds(result.readIds);
      }
    }).catch(() => {
      if (!cancelled) { setNotifications([]); setReadIds([]); }
    });
    return () => { cancelled = true; };
  }, [authUserUid, isAdmin, enabled]);

  const markRead = async (id: string) => {
    try {
      await mysqlClient.markBroadcastNotificationRead(id);
      setReadIds(current => current.includes(id) ? current : [...current, id]);
      return true;
    } catch {
      return false;
    }
  };

  const markAllRead = async () => {
    try {
      await mysqlClient.markAllBroadcastNotificationsRead();
      setReadIds(notifications.map(item => item.id));
      return true;
    } catch {
      return false;
    }
  };

  return { notifications, readIds, markRead, markAllRead };
}
