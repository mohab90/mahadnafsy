import { useRef, useState } from 'react';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

/** Site content/copy (hero text, page copy, etc.) — keyed string map synced to siteData/config. */
export function useSiteContent(initialContent: Record<string, string>, defaultContent: Record<string, string>, track: Track) {
  const [content, setContent] = useState<Record<string, string>>(initialContent);
  const contentRef = useRef<Record<string, string>>(initialContent);
  const lastLocalConfigWriteRef = useRef(0);

  const persistContentToConfig = (c: Record<string, string>) => void mysqlAdmin.saveContent(c as Record<string, unknown>).catch(() => {});

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

  const resetContent = () => {
    setContent(defaultContent);
    contentRef.current = defaultContent;
  };

  return { content, mergeContent, setContentValue, addContentKey, removeContentKey, resetContent };
}
