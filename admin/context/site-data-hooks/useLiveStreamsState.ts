import { useState } from 'react';
import type { LiveStream } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

export function useLiveStreamsState(initialLiveStreams: LiveStream[], track: Track) {
  const [liveStreams, setLiveStreams] = useState<LiveStream[]>(initialLiveStreams);

  const persistLiveStreamToCollection = (stream: LiveStream) => {
    void mysqlAdmin.saveLiveStream(stream as unknown as Record<string,unknown>).catch(() => {});
  };

  const addLiveStream = (item: LiveStream) => {
    setLiveStreams((prev) => [item, ...prev]);
    persistLiveStreamToCollection(item);
    track('create', 'liveStream', item.title);
  };

  const updateLiveStream = (item: LiveStream) => {
    setLiveStreams((prev) => prev.map((s) => (s.id === item.id ? item : s)));
    persistLiveStreamToCollection(item);
    track('update', 'liveStream', item.title);
  };

  const deleteLiveStream = (id: string) => {
    setLiveStreams((prev) => prev.filter((s) => s.id !== id));
    void mysqlAdmin.deleteLiveStream(id).catch(() => {});
    track('delete', 'liveStream', id);
  };

  return { liveStreams, setLiveStreams, addLiveStream, updateLiveStream, deleteLiveStream };
}
