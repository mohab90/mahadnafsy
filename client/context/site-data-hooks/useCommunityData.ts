import { useState } from 'react';
import type { CommunityPostItem, CommunityLibraryItem, CommunityVideoItem, CommunityEventItem } from '../../types';
import { mysqlClient, mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

/** Community domain: discussion posts, library items, videos, events. */
export function useCommunityData(
  initialPosts: CommunityPostItem[],
  initialLibrary: CommunityLibraryItem[],
  initialVideos: CommunityVideoItem[],
  initialEvents: CommunityEventItem[],
  isAdmin: boolean,
  track: Track,
) {
  const [communityPosts, setCommunityPosts] = useState<CommunityPostItem[]>(initialPosts);
  const [communityLibraryItems, setCommunityLibraryItems] = useState<CommunityLibraryItem[]>(initialLibrary);
  const [communityVideos, setCommunityVideos] = useState<CommunityVideoItem[]>(initialVideos);
  const [communityEvents, setCommunityEvents] = useState<CommunityEventItem[]>(initialEvents);

  const persistCommunityPostToCollection = (post: CommunityPostItem) => {
    // Admins write via the admin endpoint (full control + status). Customers post via the
    // auth-gated customer endpoint, which forces status='pending' for moderation. Routing a
    // customer to the admin endpoint would 403 and the post would silently vanish.
    if (isAdmin) {
      void mysqlAdmin.saveCommunityPost(post as unknown as Record<string, unknown>).catch(() => {});
    } else {
      void mysqlClient.createCommunityPost(post as unknown as Record<string, unknown>).catch(() => {});
    }
  };

  const persistCommunityLibraryItemToCollection = (item: CommunityLibraryItem) => {
    void mysqlAdmin.saveCommunityLibraryItem(item as unknown as Record<string, unknown>).catch(() => {});
  };

  const persistCommunityVideoToCollection = (video: CommunityVideoItem) => {
    void mysqlAdmin.saveCommunityVideo(video as unknown as Record<string, unknown>).catch(() => {});
  };

  const persistCommunityEventToCollection = (event: CommunityEventItem) => {
    void mysqlAdmin.saveCommunityEvent(event as unknown as Record<string, unknown>).catch(() => {});
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

  const resetCommunity = (defaults: {
    posts: CommunityPostItem[]; library: CommunityLibraryItem[]; videos: CommunityVideoItem[]; events: CommunityEventItem[];
  }) => {
    setCommunityPosts(defaults.posts);
    setCommunityLibraryItems(defaults.library);
    setCommunityVideos(defaults.videos);
    setCommunityEvents(defaults.events);
  };

  return {
    communityPosts, setCommunityPosts,
    communityLibraryItems, setCommunityLibraryItems,
    communityVideos, setCommunityVideos,
    communityEvents, setCommunityEvents,
    addCommunityPost, updateCommunityPost, deleteCommunityPost,
    addCommunityLibraryItem, updateCommunityLibraryItem, deleteCommunityLibraryItem,
    addCommunityVideo, updateCommunityVideo, deleteCommunityVideo,
    addCommunityEvent, updateCommunityEvent, deleteCommunityEvent,
    resetCommunity,
  };
}
