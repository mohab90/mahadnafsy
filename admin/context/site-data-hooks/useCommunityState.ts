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

  const persistCommunityPostToCollection = (post: CommunityPostItem) => {
    void mysqlAdmin.saveCommunityPost(post as unknown as Record<string,unknown>).catch(() => {});
  };
  const persistCommunityLibraryItemToCollection = (item: CommunityLibraryItem) => {
    void mysqlAdmin.saveCommunityLibraryItem(item as unknown as Record<string,unknown>).catch(() => {});
  };
  const persistCommunityVideoToCollection = (video: CommunityVideoItem) => {
    void mysqlAdmin.saveCommunityVideo(video as unknown as Record<string,unknown>).catch(() => {});
  };
  const persistCommunityEventToCollection = (event: CommunityEventItem) => {
    void mysqlAdmin.saveCommunityEvent(event as unknown as Record<string,unknown>).catch(() => {});
  };

  const addCommunityPost = (item: CommunityPostItem) => {
    setCommunityPosts((prev) => [item, ...prev]);
    persistCommunityPostToCollection(item);
    track('create', 'community_post', item.title);
  };

  const updateCommunityPost = (item: CommunityPostItem) => {
    setCommunityPosts((prev) => prev.map((row) => (row.id === item.id ? item : row)));
    persistCommunityPostToCollection(item);
    track('update', 'community_post', item.title);
  };

  const deleteCommunityPost = (id: string) => {
    setCommunityPosts((prev) => prev.filter((row) => row.id !== id));
    void mysqlAdmin.deleteCommunityPost(id).catch(() => {});
    track('delete', 'community_post', id);
  };

  const addCommunityLibraryItem = (item: CommunityLibraryItem) => {
    setCommunityLibraryItems((prev) => [item, ...prev]);
    persistCommunityLibraryItemToCollection(item);
    track('create', 'community_library', item.title);
  };

  const updateCommunityLibraryItem = (item: CommunityLibraryItem) => {
    setCommunityLibraryItems((prev) => prev.map((row) => (row.id === item.id ? item : row)));
    persistCommunityLibraryItemToCollection(item);
    track('update', 'community_library', item.title);
  };

  const deleteCommunityLibraryItem = (id: string) => {
    setCommunityLibraryItems((prev) => prev.filter((row) => row.id !== id));
    void mysqlAdmin.deleteCommunityLibraryItem(id).catch(() => {});
    track('delete', 'community_library', id);
  };

  const addCommunityVideo = (item: CommunityVideoItem) => {
    setCommunityVideos((prev) => [item, ...prev]);
    persistCommunityVideoToCollection(item);
    track('create', 'community_video', item.title);
  };

  const updateCommunityVideo = (item: CommunityVideoItem) => {
    setCommunityVideos((prev) => prev.map((row) => (row.id === item.id ? item : row)));
    persistCommunityVideoToCollection(item);
    track('update', 'community_video', item.title);
  };

  const deleteCommunityVideo = (id: string) => {
    setCommunityVideos((prev) => prev.filter((row) => row.id !== id));
    void mysqlAdmin.deleteCommunityVideo(id).catch(() => {});
    track('delete', 'community_video', id);
  };

  const addCommunityEvent = (item: CommunityEventItem) => {
    setCommunityEvents((prev) => [item, ...prev]);
    persistCommunityEventToCollection(item);
    track('create', 'community_event', item.title);
  };

  const updateCommunityEvent = (item: CommunityEventItem) => {
    setCommunityEvents((prev) => prev.map((row) => (row.id === item.id ? item : row)));
    persistCommunityEventToCollection(item);
    track('update', 'community_event', item.title);
  };

  const deleteCommunityEvent = (id: string) => {
    setCommunityEvents((prev) => prev.filter((row) => row.id !== id));
    void mysqlAdmin.deleteCommunityEvent(id).catch(() => {});
    track('delete', 'community_event', id);
  };

  return {
    communityPosts, setCommunityPosts, addCommunityPost, updateCommunityPost, deleteCommunityPost,
    communityLibraryItems, setCommunityLibraryItems, addCommunityLibraryItem, updateCommunityLibraryItem, deleteCommunityLibraryItem,
    communityVideos, setCommunityVideos, addCommunityVideo, updateCommunityVideo, deleteCommunityVideo,
    communityEvents, setCommunityEvents, addCommunityEvent, updateCommunityEvent, deleteCommunityEvent,
  };
}
