import { create } from 'zustand';
import { CommunityPostItem, CommunityLibraryItem, CommunityVideoItem, CommunityEventItem } from '../types';
import { mysqlAdmin } from '../lib/mysqlapi';

const logPersistError = (what: string) => (err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`[useCommunityStore] failed to persist ${what}:`, err);
};

interface CommunityState {
  communityPosts: CommunityPostItem[];
  communityLibraryItems: CommunityLibraryItem[];
  communityVideos: CommunityVideoItem[];
  communityEvents: CommunityEventItem[];

  setCommunityPosts: (posts: CommunityPostItem[]) => void;
  setCommunityLibraryItems: (items: CommunityLibraryItem[]) => void;
  setCommunityVideos: (videos: CommunityVideoItem[]) => void;
  setCommunityEvents: (events: CommunityEventItem[]) => void;

  addCommunityPost: (item: CommunityPostItem) => void;
  updateCommunityPost: (item: CommunityPostItem) => void;
  deleteCommunityPost: (id: string) => void;

  addCommunityLibraryItem: (item: CommunityLibraryItem) => void;
  updateCommunityLibraryItem: (item: CommunityLibraryItem) => void;
  deleteCommunityLibraryItem: (id: string) => void;

  addCommunityVideo: (item: CommunityVideoItem) => void;
  updateCommunityVideo: (item: CommunityVideoItem) => void;
  deleteCommunityVideo: (id: string) => void;

  addCommunityEvent: (item: CommunityEventItem) => void;
  updateCommunityEvent: (item: CommunityEventItem) => void;
  deleteCommunityEvent: (id: string) => void;
}

export const useCommunityStore = create<CommunityState>((set) => ({
  communityPosts: [],
  communityLibraryItems: [],
  communityVideos: [],
  communityEvents: [],

  setCommunityPosts: (communityPosts) => set({ communityPosts }),
  setCommunityLibraryItems: (communityLibraryItems) => set({ communityLibraryItems }),
  setCommunityVideos: (communityVideos) => set({ communityVideos }),
  setCommunityEvents: (communityEvents) => set({ communityEvents }),

  addCommunityPost: (item) => {
    set((state) => ({ communityPosts: [item, ...state.communityPosts] }));
    void mysqlAdmin.saveCommunityPost(item as unknown as Record<string, unknown>).catch(logPersistError('community post'));
  },
  updateCommunityPost: (item) => {
    set((state) => ({ communityPosts: state.communityPosts.map((p) => (p.id === item.id ? item : p)) }));
    void mysqlAdmin.saveCommunityPost(item as unknown as Record<string, unknown>).catch(logPersistError('community post'));
  },
  deleteCommunityPost: (id) => set((state) => ({ communityPosts: state.communityPosts.filter((p) => p.id !== id) })),

  addCommunityLibraryItem: (item) => {
    set((state) => ({ communityLibraryItems: [item, ...state.communityLibraryItems] }));
    void mysqlAdmin.saveCommunityLibraryItem(item as unknown as Record<string, unknown>).catch(logPersistError('community library item'));
  },
  updateCommunityLibraryItem: (item) => {
    set((state) => ({ communityLibraryItems: state.communityLibraryItems.map((p) => (p.id === item.id ? item : p)) }));
    void mysqlAdmin.saveCommunityLibraryItem(item as unknown as Record<string, unknown>).catch(logPersistError('community library item'));
  },
  deleteCommunityLibraryItem: (id) => set((state) => ({ communityLibraryItems: state.communityLibraryItems.filter((p) => p.id !== id) })),

  addCommunityVideo: (item) => {
    set((state) => ({ communityVideos: [item, ...state.communityVideos] }));
    void mysqlAdmin.saveCommunityVideo(item as unknown as Record<string, unknown>).catch(logPersistError('community video'));
  },
  updateCommunityVideo: (item) => {
    set((state) => ({ communityVideos: state.communityVideos.map((p) => (p.id === item.id ? item : p)) }));
    void mysqlAdmin.saveCommunityVideo(item as unknown as Record<string, unknown>).catch(logPersistError('community video'));
  },
  deleteCommunityVideo: (id) => set((state) => ({ communityVideos: state.communityVideos.filter((p) => p.id !== id) })),

  addCommunityEvent: (item) => {
    set((state) => ({
      communityEvents: [item, ...state.communityEvents].sort((a, b) => (b.eventDate || b.dateLabel || '').localeCompare(a.eventDate || a.dateLabel || ''))
    }));
    void mysqlAdmin.saveCommunityEvent(item as unknown as Record<string, unknown>).catch(logPersistError('community event'));
  },
  updateCommunityEvent: (item) => {
    set((state) => ({
      communityEvents: state.communityEvents.map((p) => (p.id === item.id ? item : p)).sort((a, b) => (b.eventDate || b.dateLabel || '').localeCompare(a.eventDate || a.dateLabel || ''))
    }));
    void mysqlAdmin.saveCommunityEvent(item as unknown as Record<string, unknown>).catch(logPersistError('community event'));
  },
  deleteCommunityEvent: (id) => set((state) => ({ communityEvents: state.communityEvents.filter((p) => p.id !== id) })),
}));
