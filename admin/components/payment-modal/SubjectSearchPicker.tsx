import { useEffect, useState } from 'react';

/** «العميل» for a screen with no list of clients: a search box over the server, and what it found to pick from. */
export function SubjectSearchPicker({ subjectId, subjectName, search, onPick }: {
  subjectId: string; subjectName: string;
  search: (term: string) => Promise<{ id: string; name: string; clientCode?: string }[]>;
  onPick: (id: string) => void;
}) {
  const [term, setTerm] = useState('');
  const [found, setFound] = useState<{ id: string; name: string; clientCode?: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      search(term.trim()).then(rows => { if (!cancelled) setFound(rows); }).catch(() => { if (!cancelled) setFound([]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [term, search]);
  const options = subjectId && !found.some(row => row.id === subjectId) ? [{ id: subjectId, name: subjectName }, ...found] : found;
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-bold text-gray-700">العميل <span className="text-red-500">*</span></label>
      <input type="text" value={term} onChange={event => setTerm(event.target.value)} placeholder="ابحث بالاسم أو رقم التليفون أو الكود"
        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-primary-400 focus:outline-none" />
      <select value={subjectId} onChange={event => onPick(event.target.value)}
        className={`w-full border-2 rounded-xl px-3 py-2 text-sm font-semibold ${!subjectId ? 'border-red-400 bg-red-50 text-red-700' : 'border-gray-200 bg-white'}`}>
        <option value="">— اختر العميل —</option>
        {options.map(option => (
          <option key={option.id} value={option.id}>{option.clientCode ? `${option.clientCode} — ${option.name}` : option.name}</option>
        ))}
      </select>
    </div>
  );
}
