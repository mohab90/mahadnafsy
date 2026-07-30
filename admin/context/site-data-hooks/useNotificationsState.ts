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

  const addNotification = async (item: NotificationBroadcast) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = [item, ...notifications];
    await mysqlAdmin.saveNotifications(next as unknown[]);
    setNotifications(next);
    track('create', 'notification', item.title);
  };

  const updateNotification = async (item: NotificationBroadcast) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = notifications.map((n) => (n.id === item.id ? item : n));
    await mysqlAdmin.saveNotifications(next as unknown[]);
    setNotifications(next);
    track('update', 'notification', item.title);
  };

  const deleteNotification = async (id: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = notifications.filter((n) => n.id !== id);
    await mysqlAdmin.saveNotifications(next as unknown[]);
    setNotifications(next);
    track('delete', 'notification', id);
  };

  return { notifications, setNotifications, addNotification, updateNotification, deleteNotification };
}
