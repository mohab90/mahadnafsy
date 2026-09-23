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
  // Read out of `content` once: as a subscript in the dependency array it could
  // not be checked statically, and depending on `content` itself would reset the
  // selector whenever any unrelated content key changed.
  const offerCourseId = content['offer.courseId'];
  const [offerSelectedCourseId, setOfferSelectedCourseId] = useState(() => offerCourseId || '');
  useEffect(() => {
    if (offerCourseId) setOfferSelectedCourseId(offerCourseId);
  }, [offerCourseId]);
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
