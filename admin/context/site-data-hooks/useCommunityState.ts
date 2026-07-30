import { useState } from 'react';
import type { CommunityPostItem, CommunityLibraryItem, CommunityVideoItem, CommunityEventItem } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

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

  const addCommunityEvent = (item: CommunityEventItem) => persist(
    mysqlAdmin.saveCommunityEvent(item as unknown as Record<string, unknown>),
    () => setCommunityEvents((prev) => [item, ...prev]),
    'create', 'community_event', item.title,
  );
  const updateCommunityEvent = (item: CommunityEventItem) => persist(
    mysqlAdmin.saveCommunityEvent(item as unknown as Record<string, unknown>),
    () => setCommunityEvents((prev) => prev.map((row) => row.id === item.id ? item : row)),
    'update', 'community_event', item.title,
  );
  const deleteCommunityEvent = (id: string) => persist(
    mysqlAdmin.deleteCommunityEvent(id),
    () => setCommunityEvents((prev) => prev.filter((row) => row.id !== id)),
    'delete', 'community_event', id,
  );

  return {
    communityPosts, setCommunityPosts, addCommunityPost, updateCommunityPost, deleteCommunityPost,
    communityLibraryItems, setCommunityLibraryItems, addCommunityLibraryItem, updateCommunityLibraryItem, deleteCommunityLibraryItem,
    communityVideos, setCommunityVideos, addCommunityVideo, updateCommunityVideo, deleteCommunityVideo,
    communityEvents, setCommunityEvents, addCommunityEvent, updateCommunityEvent, deleteCommunityEvent,
  };
}
