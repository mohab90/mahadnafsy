// A contact saved from the dialog is the server's at once, but the client's list is only re-read on a reload. The page keeps what it was just told
// (the hero's «آخر تواصل» and the tab's count) until the list brings the same contact itself.
import { useEffect, useState } from 'react';
import type { CommunicationRecord } from '../../types';

export type SavedContact = { id: string; type: string; date: string; notes?: string | null; outcome?: string | null; nextFollowUp?: string | null };

export function useSavedContacts(subscriberId: string | undefined, listed: CommunicationRecord[]) {
  const [saved, setSaved] = useState<CommunicationRecord[]>([]);
  useEffect(() => { setSaved([]); }, [subscriberId]);
  const remember = (entry: SavedContact) => setSaved(held => [...held, {
    id: entry.id, type: entry.type as CommunicationRecord['type'], date: entry.date, notes: entry.notes || '', outcome: entry.outcome || undefined, nextFollowUp: entry.nextFollowUp || undefined,
  }]);
  const pending = saved.filter(contact => !listed.some(c => c.id === contact.id));
  return { pending, remember };
}
