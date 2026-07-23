import { useEffect, useRef, useState } from 'react';

// Content/CMS editor draft state (All-Content search + edits, policy page
// drafts, homepage-offer course selector, institute-gallery upload input),
// lifted out of the Dashboard god-hub. Pure UI state plus the one small
// effect that keeps offerSelectedCourseId in sync with the persisted
// content value — returns identical names so the component body is
// unchanged apart from the single destructure that replaces these lines.
export function useContentEditorDrafts(content: Record<string, string>) {
  const [searchText, setSearchText] = useState('');
  const [newContentKey, setNewContentKey] = useState('');
  const [newContentValue, setNewContentValue] = useState('');
  const [contentEdits, setContentEdits] = useState<Record<string, string>>({}); // local drafts for the All-Content tab
  const [policyDrafts, setPolicyDrafts] = useState<Record<string, string>>({});
  const [offerSelectedCourseId, setOfferSelectedCourseId] = useState(() => content['offer.courseId'] || '');
  useEffect(() => {
    if (content['offer.courseId']) setOfferSelectedCourseId(content['offer.courseId']);
  }, [content['offer.courseId']]);
  const [instituteGalleryUrlInput, setInstituteGalleryUrlInput] = useState('');
  const instituteGalleryUploadRef = useRef<HTMLInputElement | null>(null);

  return {
    searchText, setSearchText,
    newContentKey, setNewContentKey,
    newContentValue, setNewContentValue,
    contentEdits, setContentEdits,
    policyDrafts, setPolicyDrafts,
    offerSelectedCourseId, setOfferSelectedCourseId,
    instituteGalleryUrlInput, setInstituteGalleryUrlInput,
    instituteGalleryUploadRef,
  };
}
