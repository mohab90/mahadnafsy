import React, { useCallback, useEffect, useState } from 'react';
import { mysqlAdmin } from '../../lib/mysqlapi';
import { useVisibleInterval } from '../../../shared/useVisibleInterval';

export type NotifRow = { id: string; type: string; title: string; message: string; data_json?: string | null; read_at: string | null; created_at: string };

/**
 * In-app notifications bell: 60s polling while the tab is in front, for
 * click-outside-to-close. Extracted verbatim from Dashboard.tsx — the block was
 * already contiguous, so the internal hook order is identical to before.
 */
export function useNotificationsBell(enabled: boolean) {
  const [notifRows, setNotifRows] = useState<NotifRow[]>([]);
  const [notifUnread, setNotifUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  // A failed poll used to leave the counter on its last number with nothing to
  // say it had stopped updating; the bell shows this and offers a retry.
  const [notifError, setNotifError] = useState(false);
  const notifRef = React.useRef<HTMLDivElement>(null);

  const refreshNotifs = useCallback(() => {
    mysqlAdmin.getNotifications().then(res => {
      const r = res as { rows: NotifRow[]; unread: number };
      setNotifRows(r.rows || []);
      setNotifUnread(r.unread || 0);
      setNotifError(false);
    }).catch(() => setNotifError(true));
  }, []);
  useVisibleInterval(refreshNotifs, 60000, enabled);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    if (notifOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [notifOpen]);

  return { notifRows, setNotifRows, notifUnread, setNotifUnread, notifOpen, setNotifOpen, notifRef, notifError, refreshNotifs };
}
