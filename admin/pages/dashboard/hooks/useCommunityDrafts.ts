import { useState } from 'react';

// Community-tab editor drafts (post/library/video/event forms) + their
// open/editing-id flags, lifted out of the Dashboard god-hub. Pure UI state
// (no effects) — returns identical names so the component body is unchanged
// apart from the single destructure that replaces these 16 useState lines.
export function useCommunityDrafts() {
  const [communityPostDraft, setCommunityPostDraft] = useState({
    title: '',
    body: '',
    tag: 'نقاش عام',
    authorName: 'إدارة المنصة',
    authorRole: 'Admin',
    authorImage: '',
    pinned: false,
  });
  const [isCommunityPostFormOpen, setIsCommunityPostFormOpen] = useState(false);
  const [communityLibraryDraft, setCommunityLibraryDraft] = useState({
    title: '',
    description: '',
    fileType: 'PDF',
    fileSize: '',
    downloadUrl: '',
  });
  const [isCommunityLibraryFormOpen, setIsCommunityLibraryFormOpen] = useState(false);
  const [communityVideoDraft, setCommunityVideoDraft] = useState({
    title: '',
    duration: '',
    viewsLabel: '',
    thumbnail: '',
    videoUrl: '',
    description: '',
  });
  const [isCommunityVideoFormOpen, setIsCommunityVideoFormOpen] = useState(false);
  const [communityEventDraft, setCommunityEventDraft] = useState({
    dateLabel: '',
    title: '',
    eventType: 'ندوة',
    speaker: '',
    platform: 'Zoom',
    eventDate: '',
    description: '',
  });
  const [isCommunityEventFormOpen, setIsCommunityEventFormOpen] = useState(false);
  const [editingCommunityPostId, setEditingCommunityPostId] = useState('');
  const [editingCommunityLibraryId, setEditingCommunityLibraryId] = useState('');
  const [editingCommunityVideoId, setEditingCommunityVideoId] = useState('');
  const [editingCommunityEventId, setEditingCommunityEventId] = useState('');

  return {
    communityPostDraft, setCommunityPostDraft,
    isCommunityPostFormOpen, setIsCommunityPostFormOpen,
    communityLibraryDraft, setCommunityLibraryDraft,
    isCommunityLibraryFormOpen, setIsCommunityLibraryFormOpen,
    communityVideoDraft, setCommunityVideoDraft,
    isCommunityVideoFormOpen, setIsCommunityVideoFormOpen,
    communityEventDraft, setCommunityEventDraft,
    isCommunityEventFormOpen, setIsCommunityEventFormOpen,
    editingCommunityPostId, setEditingCommunityPostId,
    editingCommunityLibraryId, setEditingCommunityLibraryId,
    editingCommunityVideoId, setEditingCommunityVideoId,
    editingCommunityEventId, setEditingCommunityEventId,
  };
}
