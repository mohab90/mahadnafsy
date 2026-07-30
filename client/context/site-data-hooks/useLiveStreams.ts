import { useEffect, useState } from 'react';
import type { LiveStream } from '../../types';
import { mysqlCatalog } from '../../lib/mysqlapi';

/** Published live streams; all management remains in the admin app. */
export function useLiveStreams(initialLiveStreams: LiveStream[], authUserUid?: string, isAdmin = false) {
  const [liveStreams, setLiveStreams] = useState<LiveStream[]>(initialLiveStreams);

  useEffect(() => {
    if (!authUserUid || isAdmin) {
      if (!authUserUid) setLiveStreams([]);
      return;
    }
    let cancelled = false;
    void mysqlCatalog.listLiveStreams().then((rows) => {
      if (!cancelled) setLiveStreams(rows as unknown as LiveStream[]);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [authUserUid, isAdmin]);

  return { liveStreams };
}
