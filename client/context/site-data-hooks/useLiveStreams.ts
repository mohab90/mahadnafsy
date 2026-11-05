import { useEffect, useState } from 'react';
import type { LiveStream } from '../../types';
import { mysqlCatalog, mysqlClient } from '../../lib/mysqlapi';
import { studentPiece } from '../../lib/studentExtras';

/** Published live streams; all management remains in the admin app. */
export function useLiveStreams(initialLiveStreams: LiveStream[], authUserUid?: string, isAdmin = false, enabled = true) {
  const [liveStreams, setLiveStreams] = useState<LiveStream[]>(initialLiveStreams);

  useEffect(() => {
    if (!authUserUid || isAdmin) {
      if (!authUserUid) setLiveStreams([]);
      return;
    }
    if (!enabled) return;
    let cancelled = false;
    void studentPiece(authUserUid, () => mysqlClient.getStudentExtras(), 'liveStreams', () => mysqlCatalog.listLiveStreams()).then((rows) => {
      if (!cancelled) setLiveStreams(rows as unknown as LiveStream[]);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [authUserUid, isAdmin, enabled]);

  return { liveStreams };
}
