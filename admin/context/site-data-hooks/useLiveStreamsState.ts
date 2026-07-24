import { useState } from 'react';
import type { LiveStream } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;
type PersistOrRevert = (apiCall: Promise<unknown>, revert: () => void, detail: { field: string; name?: string }) => void;

export function useLiveStreamsState(initialLiveStreams: LiveStream[], persistOrRevert: PersistOrRevert, track: Track) {
  const [liveStreams, setLiveStreams] = useState<LiveStream[]>(initialLiveStreams);

  const addLiveStream = (item: LiveStream) => {
    setLiveStreams((prev) => [item, ...prev]);
    persistOrRevert(
      mysqlAdmin.saveLiveStream(item as unknown as Record<string,unknown>),
      () => setLiveStreams((prev) => prev.filter((s) => s.id !== item.id)),
      { field: 'liveStream', name: item.title }
    );
    track('create', 'liveStream', item.title);
  };

  const updateLiveStream = (item: LiveStream) => {
    const prevStream = liveStreams.find((s) => s.id === item.id);
    setLiveStreams((prev) => prev.map((s) => (s.id === item.id ? item : s)));
    persistOrRevert(
      mysqlAdmin.saveLiveStream(item as unknown as Record<string,unknown>),
      () => { if (prevStream) setLiveStreams((prev) => prev.map((s) => (s.id === item.id ? prevStream : s))); },
      { field: 'liveStream', name: item.title }
    );
    track('update', 'liveStream', item.title);
  };

  const deleteLiveStream = (id: string) => {
    const removed = liveStreams.find((s) => s.id === id);
    setLiveStreams((prev) => prev.filter((s) => s.id !== id));
    persistOrRevert(
      mysqlAdmin.deleteLiveStream(id),
      () => { if (removed) setLiveStreams((prev) => [removed, ...prev]); },
      { field: 'liveStream', name: removed?.title }
    );
    track('delete', 'liveStream', id);
  };

  return { liveStreams, setLiveStreams, addLiveStream, updateLiveStream, deleteLiveStream };
}
