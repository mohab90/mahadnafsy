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
        // Only the touched keys go up, as a PATCH.
        //
        // This used to PUT the entire document rebuilt from the copy held in
        // memory. The server refuses a PUT that would drop keys — a deliberate
        // guard — so whenever that copy was missing anything the server had
        // (it does not expose every settings key through this endpoint), the
        // write came back 409 and the editor reported "فشل حفظ البيانات".
        // Sending just the change cannot drop anything, and is a few hundred
        // bytes instead of the whole document per keystroke-save.
        const changed: Record<string, unknown> = {};
        for (const k of keys) if (next[k] !== undefined) changed[k] = next[k];
        if (action === 'delete' || Object.keys(changed).length !== keys.length) {
          await mysqlAdmin.saveContent(next as Record<string, unknown>);
        } else {
          await mysqlAdmin.patchContent(changed);
        }
        contentRef.current = next;
        setContent(next);
        if (keys.some((k) => BRAND_KEYS.includes(k))) applyBrandTheme(next);
        track(action, 'content', label);
        return true;
      } catch (err) {
        window.dispatchEvent(new CustomEvent('site-persist-error', {
          detail: { field: 'content', name: label, reason: err instanceof Error ? err.message : String(err) },
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
