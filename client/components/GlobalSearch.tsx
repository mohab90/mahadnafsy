import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, Layers3, Loader2, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

type SearchItem = {
  id: string;
  slug?: string;
  title: string;
  shortDescription?: string;
  thumbnail?: string;
  category?: string;
};

type SearchResults = { courses: SearchItem[]; bundles: SearchItem[] };
const EMPTY_RESULTS: SearchResults = { courses: [], bundles: [] };

const GlobalSearch: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults(EMPTY_RESULTS);
      setError('');
      return;
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults(EMPTY_RESULTS);
      setError('');
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'تعذر تنفيذ البحث حاليًا.');
        setResults({
          courses: Array.isArray(data.courses) ? data.courses : [],
          bundles: Array.isArray(data.bundles) ? data.bundles : [],
        });
      } catch (cause) {
        if ((cause as Error).name !== 'AbortError') {
          setError(cause instanceof Error ? cause.message : 'تعذر تنفيذ البحث حاليًا.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const close = () => setOpen(false);
  const select = (path: string) => {
    close();
    navigate(path);
  };
  const total = results.courses.length + results.bundles.length;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-600 transition hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
        title="البحث في الموقع">
        <Search size={17} /><span className="hidden xl:inline">بحث</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-20" dir="rtl">
          <button type="button" aria-label="إغلاق البحث" onClick={close} className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" />
          <div className="relative z-10 flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl">
            <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-4">
              <Search className="text-gray-400" size={22} />
              <input ref={inputRef} type="search" value={query} onChange={event => setQuery(event.target.value)}
                className="flex-1 bg-transparent text-base text-gray-800 outline-none placeholder:text-gray-400"
                placeholder="ابحث عن كورس أو باقة..." />
              <button type="button" onClick={close} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X size={22} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {loading && <div className="flex justify-center py-10 text-primary-600"><Loader2 size={30} className="animate-spin" /></div>}
              {!loading && query.trim().length === 1 && <p className="py-10 text-center text-sm text-gray-500">اكتب حرفين على الأقل للبحث.</p>}
              {!loading && error && <p className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
              {!loading && !error && query.trim().length >= 2 && total === 0 && <p className="py-10 text-center text-sm text-gray-500">لا توجد نتائج مطابقة.</p>}
              {!loading && !error && total > 0 && (
                <div className="space-y-6">
                  <ResultSection title="الكورسات" icon={<BookOpen size={16} />} items={results.courses} onSelect={item => select(`/course/${item.slug || item.id}`)} />
                  <ResultSection title="المسارات والباقات" icon={<Layers3 size={16} />} items={results.bundles} onSelect={item => select(`/bundle/${item.slug || item.id}`)} />
                </div>
              )}
            </div>
            <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 text-center text-xs text-gray-400">Ctrl + K للفتح، وEsc للإغلاق</div>
          </div>
        </div>
      )}
    </>
  );
};

const ResultSection: React.FC<{ title: string; icon: React.ReactNode; items: SearchItem[]; onSelect: (item: SearchItem) => void }> = ({ title, icon, items, onSelect }) => {
  if (!items.length) return null;
  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 px-2 text-xs font-bold text-gray-500">{icon}{title}</h3>
      <div className="space-y-2">
        {items.map(item => (
          <button type="button" key={`${title}-${item.id}`} onClick={() => onSelect(item)} className="flex w-full items-start gap-3 rounded-xl p-2 text-right transition hover:bg-gray-50">
            {item.thumbnail ? <img src={item.thumbnail} alt="" loading="lazy" decoding="async" className="h-14 w-14 rounded-lg border border-gray-100 object-cover" /> : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">{icon}</span>}
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-gray-800">{item.title}</span><span className="mt-1 block line-clamp-2 text-xs text-gray-500">{item.shortDescription || item.category || ''}</span></span>
          </button>
        ))}
      </div>
    </section>
  );
};

export default GlobalSearch;
