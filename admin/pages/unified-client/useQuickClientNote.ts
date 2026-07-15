import { useEffect, useMemo, useState } from 'react';

export function useQuickClientNote(clientCode: string) {
  const noteKey = useMemo(() => `client-note-${clientCode}`, [clientCode]);
  const [quickNote, setQuickNote] = useState('');

  useEffect(() => {
    try {
      setQuickNote(localStorage.getItem(noteKey) || '');
    } catch {
      setQuickNote('');
    }
  }, [noteKey]);

  const saveQuickNote = (value: string) => {
    setQuickNote(value);
    try {
      localStorage.setItem(noteKey, value);
    } catch {
      // localStorage can be unavailable in privacy modes; note editing should not crash the profile.
    }
  };

  return { quickNote, saveQuickNote };
}
