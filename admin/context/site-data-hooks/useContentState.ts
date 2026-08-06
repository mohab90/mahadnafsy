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
    keys: string[],
    action: 'create' | 'update' | 'delete',
    mutate: (current: Record<string, string>) => Record<string, string>,
  ) => {
    const label = keys.length === 1 ? keys[0] : `${keys[0]} (+${keys.length - 1})`;
    lastLocalConfigWriteRef.current = Date.now();
    const queued = contentWriteQueueRef.current.then(async () => {
      const next = mutate(contentRef.current);
      try {
        await mysqlAdmin.saveContent(next as Record<string, unknown>);
        contentRef.current = next;
        setContent(next);
        if (keys.some((k) => BRAND_KEYS.includes(k))) applyBrandTheme(next);
        track(action, 'content', label);
        return true;
      } catch {
        window.dispatchEvent(new CustomEvent('site-persist-error', {
          detail: { field: 'content', name: label },
        }));
        return false;
      }
    });
    contentWriteQueueRef.current = queued;
    return queued;
  };

  const setContentValue = (key: string, value: string) =>
    queueContentMutation([key], 'update', (current) => ({ ...current, [key]: value }));

  /**
   * Save a whole form in one request.
   *
   * Every editor used to map its fields through setContentValue, which posts
   * the entire content document once per field — the policies page fired 27
   * sequential full-document writes for one click. Any of them failing left the
   * page half-saved while the earlier ones had already reported success, which
   * is what "بيقول تم الحفظ والموقع مش بيتغير" looked like from the outside.
   * One mutation, one POST, one truthful answer.
   */
  const setContentValues = (entries: Record<string, string>) => {
    const keys = Object.keys(entries);
    if (!keys.length) return Promise.resolve(true);
    return queueContentMutation(keys, 'update', (current) => ({ ...current, ...entries }));
  };

  const addContentKey = (key: string, value: string) =>
    queueContentMutation([key], 'create', (current) => ({ ...current, [key]: value }));

  const removeContentKey = (key: string) =>
    queueContentMutation([key], 'delete', (current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });

  return { content, setContent, contentRef, setContentValue, setContentValues, mergeContent, addContentKey, removeContentKey };
}
