import { useEffect, useMemo, useRef, useState } from 'react';
import { mysqlAdmin } from '../../lib/mysqlapi';
import { CRM_CHANGED_EVENT } from '../../lib/crmChanged';
import type { SubscriberItem } from '../../types';

/**
 * A few clients, by id, from the server (GET /api/staff/subscribers?ids=): the round's attendees a row opens on, the client
 * a payment is for. A screen that shows a handful of clients asks for them instead of holding the branch's whole list
 * (the Dokki schedule streamed 7,400 clients with their payments to look up a dozen). The server answers only the ones the
 * person may see; the rest come back missing and the caller falls back to what it already knows (a round keeps its
 * attendees' names and phones).
 */
const CHUNK = 100;

export async function fetchClientsByIds(ids: readonly string[]): Promise<SubscriberItem[]> {
  const wanted = [...new Set(ids.filter(Boolean))];
  const chunks: string[][] = [];
  for (let i = 0; i < wanted.length; i += CHUNK) chunks.push(wanted.slice(i, i + CHUNK));
  const answers = await Promise.all(chunks.map(chunk =>
    mysqlAdmin.adminGet<SubscriberItem[]>(`/staff/subscribers?ids=${encodeURIComponent(chunk.join(','))}&limit=${CHUNK}`)));
  return answers.flat().map(row => ({ ...row, enrolledCourseIds: Array.isArray(row.enrolledCourseIds) ? row.enrolledCourseIds : [] }));
}

/**
 * The clients with these ids, as the server has them now: asked for when an id appears, asked for again when anything
 * is written (lib/crmChanged.ts). Ids the person may not see are simply absent.
 */
export function useClientsByIds(ids: readonly string[]): SubscriberItem[] {
  const held = useRef(new Map<string, SubscriberItem>());
  const [version, setVersion] = useState(0);
  const key = useMemo(() => [...new Set(ids.filter(Boolean))].sort().join(','), [ids]);
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    const wanted = key ? key.split(',') : [];
    const missing = wanted.filter(id => !held.current.has(id));
    if (missing.length === 0) return undefined;
    let cancelled = false;
    fetchClientsByIds(missing)
      .then(rows => {
        if (cancelled) return;
        rows.forEach(row => held.current.set(row.id, row));
        setVersion(current => current + 1);
      })
      .catch(() => { /* what the caller already shows stays */ });
    return () => { cancelled = true; };
  }, [key]);

  // A write anywhere: the clients on screen are read again, once for a burst of writes.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChanged = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const wanted = keyRef.current ? keyRef.current.split(',') : [];
        if (wanted.length === 0) { held.current.clear(); return; }
        fetchClientsByIds(wanted)
          .then(rows => {
            held.current = new Map(rows.map(row => [row.id, row]));
            setVersion(current => current + 1);
          })
          .catch(() => { /* the next write asks again */ });
      }, 300);
    };
    window.addEventListener(CRM_CHANGED_EVENT, onChanged);
    return () => { clearTimeout(timer); window.removeEventListener(CRM_CHANGED_EVENT, onChanged); };
  }, []);

  // held is a ref the fetches fill; version is what says it changed, so it stands in for it here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (key ? key.split(',') : []).map(id => held.current.get(id)).filter((row): row is SubscriberItem => Boolean(row)), [key, version]);
}
