import { useState } from 'react';
import type { MutableRefObject } from 'react';
import type { NotificationBroadcast } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

// setNotifications is also written directly by triggerAutomation's notify_admin
// action (defined in the main provider), so it's returned alongside the CRUD fns.
export function useNotificationsState(
  initialNotifications: NotificationBroadcast[],
  lastLocalConfigWriteRef: MutableRefObject<number>,
  track: Track,
) {
  const [notifications, setNotifications] = useState<NotificationBroadcast[]>(initialNotifications);

  const persistNotificationsToConfig = (items: NotificationBroadcast[]) => void mysqlAdmin.saveNotifications(items as unknown[]).catch(() => {});

  const addNotification = (item: NotificationBroadcast) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = [item, ...notifications];
    setNotifications(next);
    persistNotificationsToConfig(next);
    track('create', 'notification', item.title);
  };

  const updateNotification = (item: NotificationBroadcast) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = notifications.map((n) => (n.id === item.id ? item : n));
    setNotifications(next);
    persistNotificationsToConfig(next);
    track('update', 'notification', item.title);
  };

  const deleteNotification = (id: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = notifications.filter((n) => n.id !== id);
    setNotifications(next);
    persistNotificationsToConfig(next);
    track('delete', 'notification', id);
  };

  return { notifications, setNotifications, addNotification, updateNotification, deleteNotification };
}
