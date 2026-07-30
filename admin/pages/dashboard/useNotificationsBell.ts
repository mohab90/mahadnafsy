import React, { useEffect, useState } from 'react';
import { mysqlAdmin } from '../../lib/mysqlapi';

export type NotifRow = { id: string; type: string; title: string; message: string; read_at: string | null; created_at: string };

/**
 * In-app notifications bell: 60s polling for authorised admin/staff users +
 * click-outside-to-close. Extracted verbatim from Dashboard.tsx — the block was
 * already contiguous, so the internal hook order is identical to before.
 */
export function useNotificationsBell(enabled: boolean) {
  const [notifRows, setNotifRows] = useState<NotifRow[]>([]);
  const [notifUnread, setNotifUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;
    const loadNotifs = () => {
      mysqlAdmin.getNotifications().then(res => {
        const r = res as { rows: NotifRow[]; unread: number };
        setNotifRows(r.rows || []);
        setNotifUnread(r.unread || 0);
      }).catch(() => {});
    };
    loadNotifs();
    const iv = setInterval(loadNotifs, 60000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    if (notifOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [notifOpen]);

  return { notifRows, setNotifRows, notifUnread, setNotifUnread, notifOpen, setNotifOpen, notifRef };
}
