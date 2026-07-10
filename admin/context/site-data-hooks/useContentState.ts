import { useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { mysqlAdmin } from '../../lib/mysqlapi';
import { applyBrandTheme, BRAND_KEYS } from '../../lib/brandTheme';

type Track = (action: string, entity: string, label: string) => void;

export function useContentState(
  initialContent: Record<string, string>,
  lastLocalConfigWriteRef: MutableRefObject<number>,
  track: Track,
) {
  const [content, setContent] = useState<Record<string, string>>(initialContent);
  const contentRef = useRef<Record<string, string>>(initialContent);

  const persistContentToConfig = (c: Record<string, string>) => void mysqlAdmin.saveContent(c as Record<string,unknown>).catch(() => {});

  const mergeContent = (incoming: Record<string, string>) => {
    contentRef.current = { ...contentRef.current, ...incoming };
    setContent(contentRef.current);
  };

  const setContentValue = (key: string, value: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    // Use contentRef (not the stale `content` state) so that calling setContentValue
    // multiple times in the same event handler accumulates all keys correctly instead
    // of each call overwriting the previous one with the same stale base.
    contentRef.current = { ...contentRef.current, [key]: value };
    const next = contentRef.current;
    setContent(next);
    persistContentToConfig(next);
    if (BRAND_KEYS.includes(key)) applyBrandTheme(next); // live brand preview on save
    track('update', 'content', key);
  };

  const addContentKey = (key: string, value: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    contentRef.current = { ...contentRef.current, [key]: value };
    const next = contentRef.current;
    setContent(next);
    persistContentToConfig(next);
    track('create', 'content', key);
  };

  const removeContentKey = (key: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = { ...contentRef.current };
    delete next[key];
    contentRef.current = next;
    setContent(next);
    persistContentToConfig(next);
    track('delete', 'content', key);
  };

  return { content, setContent, contentRef, setContentValue, mergeContent, addContentKey, removeContentKey };
}
