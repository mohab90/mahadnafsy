import { useRef, useState } from 'react';
import type { NotificationBroadcast } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

export function useNotifications(initialNotifications: NotificationBroadcast[], track: Track) {
  const [notifications, setNotifications] = useState<NotificationBroadcast[]>(initialNotifications);
  const lastLocalConfigWriteRef = useRef(0);

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

  const resetNotifications = () => setNotifications([]);

  // setNotifications is also exposed raw: triggerAutomation's notify_admin action
  // pushes a synthetic notification directly, without going through addNotification's
  // persist/track side effects — preserved as-is from the pre-extraction behavior.
  return { notifications, setNotifications, addNotification, updateNotification, deleteNotification, resetNotifications };
}
