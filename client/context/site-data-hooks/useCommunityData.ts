import { useState } from 'react';
import type { CommunityPostItem, CommunityLibraryItem, CommunityVideoItem, CommunityEventItem, CommunityComment } from '../../types';
import { mysqlClient } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

/** Community domain: discussion posts, library items, videos, events. */
export function useCommunityData(
  initialPosts: CommunityPostItem[],
  initialLibrary: CommunityLibraryItem[],
  initialVideos: CommunityVideoItem[],
  initialEvents: CommunityEventItem[],
  track: Track,
) {
  const [communityPosts, setCommunityPosts] = useState<CommunityPostItem[]>(initialPosts);
  const [communityLibraryItems, setCommunityLibraryItems] = useState<CommunityLibraryItem[]>(initialLibrary);
  const [communityVideos, setCommunityVideos] = useState<CommunityVideoItem[]>(initialVideos);
  const [communityEvents, setCommunityEvents] = useState<CommunityEventItem[]>(initialEvents);

  const addCommunityPost = async (item: CommunityPostItem) => {
    const saved = await mysqlClient.createCommunityPost(item as unknown as Record<string, unknown>);
    const response = saved as { id?: string; status?: CommunityPostItem['status'] };
    setCommunityPosts((prev) => [{
      ...item,
      id: response.id || item.id,
      status: response.status || item.status,
      isOwner: true,
    }, ...prev]);
    track('create', 'community_post', item.title);
  };

  const updateCommunityPost = async (item: CommunityPostItem) => {
    const saved = await mysqlClient.updateCommunityPost(item.id, item as unknown as Record<string, unknown>);
    const response = saved as { status?: CommunityPostItem['status'] };
    setCommunityPosts((prev) => prev.map((row) => (
      row.id === item.id ? { ...item, status: response.status || item.status } : row
    )));
    track('update', 'community_post', item.title);
  };

  const deleteCommunityPost = async (id: string) => {
    await mysqlClient.deleteCommunityPost(id);
    setCommunityPosts((prev) => prev.filter((row) => row.id !== id));
    track('delete', 'community_post', id);
  };

  const toggleCommunityPostLike = async (id: string) => {
    const result = await mysqlClient.toggleCommunityPostLike(id);
    setCommunityPosts((prev) => prev.map((row) => (
      row.id === id ? { ...row, likes: result.likes } : row
    )));
    return { liked: result.liked, likes: result.likes };
  };

  const addCommunityPostComment = async (id: string, body: string): Promise<CommunityComment> => {
    const result = await mysqlClient.addCommunityPostComment(id, body);
    setCommunityPosts((prev) => prev.map((row) => row.id === id ? {
      ...row,
      comments: row.comments + 1,
      commentsList: [...(row.commentsList || []), result.comment],
    } : row));
    track('create', 'community_comment', id);
    return result.comment;
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
    toggleCommunityPostLike, addCommunityPostComment,
    resetCommunity,
  };
}
