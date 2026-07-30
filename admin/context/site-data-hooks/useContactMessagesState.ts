import { useState } from 'react';
import type { ContactMessage } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

const reportFailure = (name: string) => window.dispatchEvent(new CustomEvent('site-persist-error', {
  detail: { field: 'contactMessage', name },
}));

export function useContactMessagesState(initialContactMessages: ContactMessage[], track: Track) {
  const [contactMessages, setContactMessages] = useState<ContactMessage[]>(initialContactMessages);

  const persistContactMessage = async (item: ContactMessage) => {
    try {
      await mysqlAdmin.updateContactMessage(item.id, item.status, item.adminNote);
      setContactMessages((prev) => prev.some((row) => row.id === item.id)
        ? prev.map((row) => row.id === item.id ? item : row)
        : [item, ...prev]);
      return true;
    } catch {
      reportFailure(item.name);
      return false;
    }
  };

  const addContactMessage = async (item: ContactMessage) => {
    if (!await persistContactMessage(item)) return false;
    track('create', 'contactMessage', item.name);
    return true;
  };

  const updateContactMessage = async (item: ContactMessage) => {
    if (!await persistContactMessage(item)) return false;
    track('update', 'contactMessage', item.name);
    return true;
  };

  const deleteContactMessage = async (id: string) => {
    try {
      await mysqlAdmin.deleteContactMessage(id);
      setContactMessages((prev) => prev.filter((item) => item.id !== id));
      track('delete', 'contactMessage', id);
      return true;
    } catch {
      reportFailure(id);
      return false;
    }
  };

  return { contactMessages, setContactMessages, addContactMessage, updateContactMessage, deleteContactMessage };
}
