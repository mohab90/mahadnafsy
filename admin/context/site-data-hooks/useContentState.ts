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
  const contentWriteQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));

  const mergeContent = (incoming: Record<string, string>) => {
    contentRef.current = { ...contentRef.current, ...incoming };
    setContent(contentRef.current);
  };

  const queueContentMutation = (
    key: string,
    action: 'create' | 'update' | 'delete',
    mutate: (current: Record<string, string>) => Record<string, string>,
  ) => {
    lastLocalConfigWriteRef.current = Date.now();
    const queued = contentWriteQueueRef.current.then(async () => {
      const next = mutate(contentRef.current);
      try {
        await mysqlAdmin.saveContent(next as Record<string, unknown>);
        contentRef.current = next;
        setContent(next);
        if (BRAND_KEYS.includes(key)) applyBrandTheme(next);
        track(action, 'content', key);
        return true;
      } catch {
        window.dispatchEvent(new CustomEvent('site-persist-error', {
          detail: { field: 'content', name: key },
        }));
        return false;
      }
    });
    contentWriteQueueRef.current = queued;
    return queued;
  };

  const setContentValue = (key: string, value: string) =>
    queueContentMutation(key, 'update', (current) => ({ ...current, [key]: value }));

  const addContentKey = (key: string, value: string) =>
    queueContentMutation(key, 'create', (current) => ({ ...current, [key]: value }));

  const removeContentKey = (key: string) =>
    queueContentMutation(key, 'delete', (current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });

  return { content, setContent, contentRef, setContentValue, mergeContent, addContentKey, removeContentKey };
}
