import { useState } from 'react';
import type { ContactMessage } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

export function useContactMessagesState(initialContactMessages: ContactMessage[], track: Track) {
  const [contactMessages, setContactMessages] = useState<ContactMessage[]>(initialContactMessages);

  const persistContactMessageToCollection = (item: ContactMessage) => {
    // status/note changes persist to the contact_messages table
    void mysqlAdmin.updateContactMessage(item.id, item.status, (item as unknown as { adminNote?: string }).adminNote).catch(() => {});
  };

  const addContactMessage = (item: ContactMessage) => {
    setContactMessages((prev) => [item, ...prev]);
    persistContactMessageToCollection(item);
    track('create', 'contactMessage', item.name);
  };
  const updateContactMessage = (item: ContactMessage) => {
    setContactMessages((prev) => prev.map((x) => (x.id === item.id ? item : x)));
    persistContactMessageToCollection(item);
    track('update', 'contactMessage', item.name);
  };
  const deleteContactMessage = (id: string) => {
    setContactMessages((prev) => prev.filter((x) => x.id !== id));
    void mysqlAdmin.deleteContactMessage(id).catch(() => {}); // was local-only → messages came back on refresh
    track('delete', 'contactMessage', id);
  };

  return { contactMessages, setContactMessages, addContactMessage, updateContactMessage, deleteContactMessage };
}
