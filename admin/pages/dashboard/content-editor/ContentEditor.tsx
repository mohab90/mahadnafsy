import { useCallback, useEffect, useId, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { CheckCircle2, Loader2, Save, Search, Undo2, X } from 'lucide-react';

import { FieldControl } from './FieldControl';
import { siteDefault } from './siteDefaults';
import type { EditorApi, EditorField, EditorSection, NotifyFn, SectionSlot } from './types';

type ContentMap = Record<string, string>;

export type ContentEditorProps = {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  sections: EditorSection[];
  content: ContentMap;
  /**
   * Where the unsaved edits live. Pass the dashboard's shared drafts to keep
   * them while the admin opens another page; leave out to keep them here.
   */
  drafts?: ContentMap;
  setDrafts?: Dispatch<SetStateAction<ContentMap>>;
  /** Saves every changed key of the page at once — one setContentValues call. */
  onSave: (entries: ContentMap) => Promise<boolean>;
  notify: NotifyFn;
  successMessage?: string;
  /** What the site shows for a key while it is empty; defaults to the known site text. */
  defaultFor?: (key: string) => string;
  /** Drawn at the end of the header, beside the search. */
  headerExtra?: ReactNode;
  /** Hide the section index (pages of one or two sections). */
  hideIndex?: boolean;
};

const norm = (text: string) => text
  .toLowerCase()
  .replace(/[أإآ]/g, 'ا')
  .replace(/ة/g, 'ه')
  .replace(/ى/g, 'ي')
  .replace(/[\u064B-\u0652\u0640]/g, '')
  .trim();

const renderSlot = (slot: SectionSlot | undefined, api: EditorApi) =>
  typeof slot === 'function' ? slot(api) : slot;

/**
 * «صفحة محتوى المعهد … محتاجه تطوير كبير بحيث تكون اسهل في الاستخدام».
 *
 * Each page of the content hub used to be one long grid of inputs labelled by
 * their raw keys, with its own «حفظ» button at the top — easy to edit a field
 * at the bottom and leave without saving. This draws a page as titled sections
 * with an index and a search, every field with its site default as the
 * placeholder, and one save bar that appears the moment something changes and
 * saves the whole page in a single request.
 */
export function ContentEditor({
  title,
  subtitle,
  icon,
  sections,
  content,
  drafts: outerDrafts,
  setDrafts: setOuterDrafts,
  onSave,
  notify,
  successMessage = 'اتحفظ — التعديلات ظاهرة في الموقع دلوقتي.',
  defaultFor = siteDefault,
  headerExtra,
  hideIndex,
}: ContentEditorProps) {
  const [innerDrafts, setInnerDrafts] = useState<ContentMap>({});
  const drafts = outerDrafts ?? innerDrafts;
  const setDrafts = setOuterDrafts ?? setInnerDrafts;
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeId, setActiveId] = useState(sections[0]?.id || '');
  const uid = useId().replace(/:/g, '');
  const anchor = (id: string) => `ce-${uid}-${id}`;

  /** Every key this page saves, fields and section-owned keys alike. */
  const ownKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const section of sections) {
      for (const field of section.fields) keys.add(field.key);
      for (const key of section.keys || []) keys.add(key);
    }
    return [...keys];
  }, [sections]);

  const saved = useCallback((key: string) => content[key] ?? '', [content]);
  const isDirty = useCallback(
    (key: string) => drafts[key] !== undefined && drafts[key] !== saved(key),
    [drafts, saved],
  );
  const dirtyKeys = useMemo(() => ownKeys.filter(isDirty), [ownKeys, isDirty]);

  const api = useMemo<EditorApi>(() => ({
    value: key => drafts[key] ?? saved(key),
    set: (key, value) => setDrafts(prev => ({ ...prev, [key]: value })),
    isDirty,
  }), [drafts, saved, setDrafts, isDirty]);

  const discard = useCallback(() => {
    setDrafts(prev => {
      const next = { ...prev };
      for (const key of ownKeys) delete next[key];
      return next;
    });
  }, [ownKeys, setDrafts]);

  const save = async () => {
    if (!dirtyKeys.length || saving) return;
    const entries = Object.fromEntries(dirtyKeys.map(key => [key, drafts[key]]));
    setSaving(true);
    const ok = await onSave(entries);
    setSaving(false);
    if (!ok) {
      notify('error', 'تعذر الحفظ على السيرفر — التعديلات لسه موجودة، جرّب تاني.');
      return;
    }
    setDrafts(prev => {
      const next = { ...prev };
      for (const key of Object.keys(entries)) delete next[key];
      return next;
    });
    notify('success', successMessage);
  };

  // Leaving the panel with edits on screen asks first.
  useEffect(() => {
    if (!dirtyKeys.length) return undefined;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirtyKeys.length]);

  const q = norm(query);
  const visible = useMemo(() => sections
    .map(section => {
      if (!q) return { section, fields: section.fields, all: true };
      const sectionHit = norm(`${section.title} ${section.hint || ''} ${section.keywords || ''}`).includes(q);
      const fields = sectionHit
        ? section.fields
        : section.fields.filter((field: EditorField) => norm(`${field.label} ${field.hint || ''} ${field.key}`).includes(q));
      return { section, fields, all: sectionHit };
    })
    .filter(entry => entry.all || entry.fields.length), [sections, q]);

  const visibleIds = visible.map(entry => entry.section.id).join('|');

  // The index follows the section on screen.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(entries => {
      const top = entries.filter(entry => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setActiveId(top.target.getAttribute('data-section') || '');
    }, { rootMargin: '-10% 0px -70% 0px' });
    for (const id of visibleIds.split('|')) {
      const el = id ? document.getElementById(anchor(id)) : null;
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
    // Keyed on the ids on screen rather than `visible`: a page that builds its
    // sections inline hands over a new array on every keystroke. anchor is
    // derived from uid, which never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleIds, uid]);

  const jump = (id: string) => {
    setActiveId(id);
    document.getElementById(anchor(id))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const dirtyIn = (section: EditorSection) =>
    section.fields.some(field => isDirty(field.key)) || (section.keys || []).some(isDirty);

  const showIndex = !hideIndex && sections.length > 2;

  return (
    <div className="space-y-4" dir="rtl">
      <header className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {icon && <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-primary-50 text-primary-700">{icon}</span>}
            <div className="min-w-0">
              <h2 className="text-lg font-extrabold text-gray-900">{title}</h2>
              {subtitle && <p className="mt-0.5 text-sm leading-6 text-gray-500">{subtitle}</p>}
            </div>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
            dirtyKeys.length ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
          }`}>
            {dirtyKeys.length ? <>{dirtyKeys.length} تعديل مش محفوظ</> : <><CheckCircle2 size={13} /> كل التعديلات محفوظة</>}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="relative min-w-[220px] flex-1">
            <span className="sr-only">دوّر على خانة</span>
            <Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="دوّر على خانة… (مثلاً: عنوان، فيديو، سعر)"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-9 text-sm [&::-webkit-search-cancel-button]:hidden focus:border-primary-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="امسح البحث"
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700">
                <X size={14} />
              </button>
            )}
          </label>
          {headerExtra}
        </div>
      </header>

      {showIndex && (
        <nav aria-label="أقسام الصفحة" className="flex gap-2 overflow-x-auto pb-1 lg:hidden">
          {visible.map(({ section }) => (
            <button key={section.id} type="button" onClick={() => jump(section.id)}
              className={`flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                activeId === section.id ? 'border-primary-200 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600'
              }`}>
              {dirtyIn(section) && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
              {section.title}
            </button>
          ))}
        </nav>
      )}

      <div className={showIndex ? 'lg:grid lg:grid-cols-[230px_minmax(0,1fr)] lg:items-start lg:gap-5' : ''}>
        {showIndex && (
          <nav aria-label="أقسام الصفحة" className="sticky top-4 hidden max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-2 shadow-sm lg:block">
            <p className="px-2 pb-1 pt-1.5 text-[11px] font-bold text-gray-400">أقسام الصفحة بالترتيب</p>
            {visible.map(({ section }, index) => (
              <button key={section.id} type="button" onClick={() => jump(section.id)}
                className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-right text-[13px] font-bold transition ${
                  activeId === section.id ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}>
                <span className={`grid h-5 w-5 flex-none place-items-center rounded-md text-[10px] ${
                  activeId === section.id ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-500'
                }`}>{index + 1}</span>
                <span className="min-w-0 flex-1 truncate">{section.title}</span>
                {dirtyIn(section) && <span className="h-2 w-2 flex-none rounded-full bg-amber-400" title="فيه تعديل مش محفوظ" />}
              </button>
            ))}
          </nav>
        )}

        <div className="min-w-0 space-y-4">
          {visible.length === 0 && (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
              مفيش خانة اسمها «{query}» في الصفحة دي.
            </div>
          )}
          {visible.map(({ section, fields }) => (
            <section
              key={section.id}
              id={anchor(section.id)}
              data-section={section.id}
              className="scroll-mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5"
            >
              <div className="mb-4 flex items-start gap-3">
                {section.icon && <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-gray-50 text-gray-600">{section.icon}</span>}
                <div className="min-w-0">
                  <h3 className="flex items-center gap-2 font-extrabold text-gray-900">
                    {section.title}
                    {dirtyIn(section) && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">متعدل</span>}
                  </h3>
                  {section.hint && <p className="mt-0.5 text-xs leading-5 text-gray-500">{section.hint}</p>}
                </div>
              </div>
              {section.before && <div className="mb-4">{renderSlot(section.before, api)}</div>}
              {fields.length > 0 && (
                <div className="grid grid-cols-1 gap-x-5 gap-y-5 md:grid-cols-2">
                  {fields.map(field => (
                    <FieldControl
                      key={field.key}
                      field={field}
                      value={api.value(field.key)}
                      defaultText={defaultFor(field.key)}
                      dirty={isDirty(field.key)}
                      onChange={value => api.set(field.key, value)}
                    />
                  ))}
                </div>
              )}
              {section.after && <div className="mt-4">{renderSlot(section.after, api)}</div>}
            </section>
          ))}
        </div>
      </div>

      {dirtyKeys.length > 0 && (
        <div className="sticky bottom-3 z-30">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-800 bg-gray-900 px-4 py-3 text-white shadow-2xl">
            <span className="flex items-center gap-2 text-sm font-bold">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              فيه {dirtyKeys.length} تعديل مش محفوظ
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={discard} disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold text-gray-300 transition hover:bg-white/10 hover:text-white disabled:opacity-50">
                <Undo2 size={15} /> تجاهل
              </button>
              <button type="button" onClick={() => void save()} disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-5 py-2 text-sm font-extrabold text-white transition hover:bg-primary-700 disabled:opacity-60">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} حفظ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
