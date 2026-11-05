import { useState } from 'react';
import type { LiveStream } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

export function useLiveStreamsState(initialStreams: LiveStream[], track: Track) {
  const [liveStreams, setLiveStreams] = useState(initialStreams);

  const persist = async <T,>(request: Promise<T>, name?: string): Promise<{ ok: true; response: T } | { ok: false }> => {
    try { return { ok: true, response: await request }; }
    catch {
      window.dispatchEvent(new CustomEvent('site-persist-error', { detail: { field: 'liveStream', name } }));
      return { ok: false };
    }
  };
  // a live saved with no link comes back with the one the system made (the server's answer), not the empty one that was typed
  const withServerLink = (item: LiveStream, response: { streamUrl?: string } | undefined): LiveStream => (response?.streamUrl ? { ...item, streamUrl: response.streamUrl } : item);

  const addLiveStream = async (item: LiveStream) => {
    const result = await persist(mysqlAdmin.saveLiveStream(item as unknown as Record<string, unknown>), item.title);
    if (!result.ok) return false;
    const saved = withServerLink(item, result.response);
    setLiveStreams(current => [saved, ...current.filter(row => row.id !== item.id)]);
    track('create', 'liveStream', item.title);
    return true;
  };

  const updateLiveStream = async (item: LiveStream) => {
    const result = await persist(mysqlAdmin.saveLiveStream(item as unknown as Record<string, unknown>), item.title);
    if (!result.ok) return false;
    const saved = withServerLink(item, result.response);
    setLiveStreams(current => current.map(row => row.id === item.id ? saved : row));
    track('update', 'liveStream', item.title);
    return true;
  };

  const deleteLiveStream = async (id: string) => {
    const item = liveStreams.find(row => row.id === id);
    if (!(await persist(mysqlAdmin.deleteLiveStream(id), item?.title)).ok) return false;
    setLiveStreams(current => current.filter(row => row.id !== id));
    track('delete', 'liveStream', id);
    return true;
  };

  return { liveStreams, setLiveStreams, addLiveStream, updateLiveStream, deleteLiveStream };
}
