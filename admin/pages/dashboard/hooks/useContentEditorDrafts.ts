import { useEffect, useRef, useState } from 'react';

// Content/CMS editor draft state (All-Content search + edits, policy page
// drafts, institute-gallery upload input), lifted out of the Dashboard god-hub.
// The homepage-offer course selector lives in DashboardHomeOfferPanel, the one
// screen that reads it.
export function useContentEditorDrafts(content: Record<string, string>) {
  const [searchText, setSearchText] = useState('');
  const [newContentKey, setNewContentKey] = useState('');
  const [newContentValue, setNewContentValue] = useState('');
  const [contentEdits, setContentEdits] = useState<Record<string, string>>({}); // local drafts for the All-Content tab
  const [policyDrafts, setPolicyDrafts] = useState<Record<string, string>>({});
  const [instituteGalleryUrlInput, setInstituteGalleryUrlInput] = useState('');
  const instituteGalleryUploadRef = useRef<HTMLInputElement | null>(null);

  return {
    searchText, setSearchText,
    newContentKey, setNewContentKey,
    newContentValue, setNewContentValue,
    contentEdits, setContentEdits,
    policyDrafts, setPolicyDrafts,
    instituteGalleryUrlInput, setInstituteGalleryUrlInput,
    instituteGalleryUploadRef,
  };
}
