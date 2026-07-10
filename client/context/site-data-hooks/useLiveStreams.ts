import { useState } from 'react';
import type { LiveStream } from '../../types';

type Track = (action: string, entity: string, label: string) => void;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const persistLiveStreamToCollection = (_stream: LiveStream) => { /* PG-only — no Firestore write */ };

export function useLiveStreams(initialLiveStreams: LiveStream[], track: Track) {
  const [liveStreams, setLiveStreams] = useState<LiveStream[]>(initialLiveStreams);

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
    track('delete', 'liveStream', id);
  };

  const resetLiveStreams = () => setLiveStreams([]);

  return { liveStreams, addLiveStream, updateLiveStream, deleteLiveStream, resetLiveStreams };
}
