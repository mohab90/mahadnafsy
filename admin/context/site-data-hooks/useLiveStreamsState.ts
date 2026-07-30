import { useState } from 'react';
import type { LiveStream } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

export function useLiveStreamsState(initialStreams: LiveStream[], track: Track) {
  const [liveStreams, setLiveStreams] = useState(initialStreams);

  const persist = async (request: Promise<unknown>, name?: string) => {
    try { await request; return true; }
    catch {
      window.dispatchEvent(new CustomEvent('site-persist-error', { detail: { field: 'liveStream', name } }));
      return false;
    }
  };

  const addLiveStream = async (item: LiveStream) => {
    if (!await persist(mysqlAdmin.saveLiveStream(item as unknown as Record<string, unknown>), item.title)) return false;
    setLiveStreams(current => [item, ...current.filter(row => row.id !== item.id)]);
    track('create', 'liveStream', item.title);
    return true;
  };

  const updateLiveStream = async (item: LiveStream) => {
    if (!await persist(mysqlAdmin.saveLiveStream(item as unknown as Record<string, unknown>), item.title)) return false;
    setLiveStreams(current => current.map(row => row.id === item.id ? item : row));
    track('update', 'liveStream', item.title);
    return true;
  };

  const deleteLiveStream = async (id: string) => {
    const item = liveStreams.find(row => row.id === id);
    if (!await persist(mysqlAdmin.deleteLiveStream(id), item?.title)) return false;
    setLiveStreams(current => current.filter(row => row.id !== id));
    track('delete', 'liveStream', id);
    return true;
  };

  return { liveStreams, setLiveStreams, addLiveStream, updateLiveStream, deleteLiveStream };
}
