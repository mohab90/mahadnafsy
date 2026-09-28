import { useState } from 'react';
import type { CommunityPostItem, CommunityLibraryItem, CommunityVideoItem, CommunityEventItem } from '../../types';
import { mysqlAdmin, mysqlCatalog } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

export function useCommunityState(
  initialCommunityPosts: CommunityPostItem[],
  initialCommunityLibraryItems: CommunityLibraryItem[],
  initialCommunityVideos: CommunityVideoItem[],
  initialCommunityEvents: CommunityEventItem[],
  track: Track,
) {
  const [communityPosts, setCommunityPosts] = useState<CommunityPostItem[]>(initialCommunityPosts);
  const [communityLibraryItems, setCommunityLibraryItems] = useState<CommunityLibraryItem[]>(initialCommunityLibraryItems);
  const [communityVideos, setCommunityVideos] = useState<CommunityVideoItem[]>(initialCommunityVideos);
  const [communityEvents, setCommunityEvents] = useState<CommunityEventItem[]>(initialCommunityEvents);

  const persist = async (
    request: Promise<unknown>,
    commit: () => void,
    action: 'create' | 'update' | 'delete',
    entity: string,
    label: string,
  ) => {
    try {
      await request;
      commit();
      track(action, entity, label);
      return true;
    } catch {
      window.dispatchEvent(new CustomEvent('site-persist-error', {
        detail: { field: entity, name: label },
      }));
      return false;
    }
  };

  const addCommunityPost = (item: CommunityPostItem) => persist(
    mysqlAdmin.saveCommunityPost(item as unknown as Record<string, unknown>),
    () => setCommunityPosts((prev) => [item, ...prev]),
    'create', 'community_post', item.title,
  );
  const updateCommunityPost = (item: CommunityPostItem) => persist(
    mysqlAdmin.saveCommunityPost(item as unknown as Record<string, unknown>),
    () => setCommunityPosts((prev) => prev.map((row) => row.id === item.id ? item : row)),
    'update', 'community_post', item.title,
  );
  const deleteCommunityPost = (id: string) => persist(
    mysqlAdmin.deleteCommunityPost(id),
    () => setCommunityPosts((prev) => prev.filter((row) => row.id !== id)),
    'delete', 'community_post', id,
  );

  const addCommunityLibraryItem = (item: CommunityLibraryItem) => persist(
    mysqlAdmin.saveCommunityLibraryItem(item as unknown as Record<string, unknown>),
    () => setCommunityLibraryItems((prev) => [item, ...prev]),
    'create', 'community_library', item.title,
  );
  const updateCommunityLibraryItem = (item: CommunityLibraryItem) => persist(
    mysqlAdmin.saveCommunityLibraryItem(item as unknown as Record<string, unknown>),
    () => setCommunityLibraryItems((prev) => prev.map((row) => row.id === item.id ? item : row)),
    'update', 'community_library', item.title,
  );
  const deleteCommunityLibraryItem = (id: string) => persist(
    mysqlAdmin.deleteCommunityLibraryItem(id),
    () => setCommunityLibraryItems((prev) => prev.filter((row) => row.id !== id)),
    'delete', 'community_library', id,
  );

  const addCommunityVideo = (item: CommunityVideoItem) => persist(
    mysqlAdmin.saveCommunityVideo(item as unknown as Record<string, unknown>),
    () => setCommunityVideos((prev) => [item, ...prev]),
    'create', 'community_video', item.title,
  );
  const updateCommunityVideo = (item: CommunityVideoItem) => persist(
    mysqlAdmin.saveCommunityVideo(item as unknown as Record<string, unknown>),
    () => setCommunityVideos((prev) => prev.map((row) => row.id === item.id ? item : row)),
    'update', 'community_video', item.title,
  );
  const deleteCommunityVideo = (id: string) => persist(
    mysqlAdmin.deleteCommunityVideo(id),
    () => setCommunityVideos((prev) => prev.filter((row) => row.id !== id)),
    'delete', 'community_video', id,
  );

  // The server names a new event's address (its slug); keep it, so «نسخ
  // اللينك» works without reloading.
  const saveEvent = (item: CommunityEventItem, action: 'create' | 'update') => {
    let saved = item;
    return persist(
      mysqlAdmin.saveCommunityEvent(item as unknown as Record<string, unknown>)
        .then((result) => { saved = { ...item, slug: (result as { slug?: string }).slug || item.slug }; }),
      () => setCommunityEvents((prev) => action === 'create'
        ? [saved, ...prev]
        : prev.map((row) => row.id === item.id ? { ...row, ...saved } : row)),
      action, 'community_event', item.title,
    );
  };
  const addCommunityEvent = (item: CommunityEventItem) => saveEvent(item, 'create');
  const updateCommunityEvent = (item: CommunityEventItem) => saveEvent(item, 'update');

  // The moderation list again. It was read once when the panel loaded, so a
  // post written while the panel was open never reached it: the post from
  // 03:32 on 28 September sat pending behind a list loaded at 21:44 the night
  // before.
  const refreshCommunityPosts = async () => {
    try {
      const rows = await mysqlCatalog.listCommunityPosts() as unknown as CommunityPostItem[];
      setCommunityPosts(rows);
    } catch {
      // The list on screen stays; the next refresh tries again.
    }
  };
  const deleteCommunityEvent = (id: string) => persist(
    mysqlAdmin.deleteCommunityEvent(id),
    () => setCommunityEvents((prev) => prev.filter((row) => row.id !== id)),
    'delete', 'community_event', id,
  );

  return {
    communityPosts, setCommunityPosts, addCommunityPost, updateCommunityPost, deleteCommunityPost, refreshCommunityPosts,
    communityLibraryItems, setCommunityLibraryItems, addCommunityLibraryItem, updateCommunityLibraryItem, deleteCommunityLibraryItem,
    communityVideos, setCommunityVideos, addCommunityVideo, updateCommunityVideo, deleteCommunityVideo,
    communityEvents, setCommunityEvents, addCommunityEvent, updateCommunityEvent, deleteCommunityEvent,
  };
}
