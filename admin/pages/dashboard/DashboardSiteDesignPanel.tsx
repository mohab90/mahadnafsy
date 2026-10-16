import { useCallback, useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import { AlertTriangle, Check, LayoutTemplate, Monitor, Palette, Shuffle, Sparkles } from 'lucide-react';

import {
  DEFAULT_DESIGN, DESIGNS, HERO_VARIANTS, heroChoices, heroText,
  type HeroText, type HeroVariantId, type SiteDesignId,
} from '../../../shared/siteDesigns';
import { useStaticData } from '../../context/siteDataSlices';
import { ContentEditor } from './content-editor/ContentEditor';
import { siteDefault } from './content-editor/siteDefaults';
import type { EditorApi, EditorSection } from './content-editor/types';
import { classicHeroFields, heroKey, siteDesignFields } from './contentFields';

type NotifyFn = (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;

// ── Small pictures of each design, so the choice is not between two names ──

function ModernMock() {
  return (
    <div className="flex h-full flex-col gap-1.5 bg-white p-2">
      <div className="flex flex-1 items-center gap-2 rounded-md p-2" style={{ background: 'linear-gradient(135deg,#9f1239,#4c0519)' }}>
        <div className="flex-1 space-y-1">
          <div className="h-1.5 w-1/3 rounded-full bg-[#f3c969]" />
          <div className="h-2 w-5/6 rounded-full bg-white" />
          <div className="h-2 w-2/3 rounded-full bg-white/80" />
          <div className="mt-1 flex gap-1"><div className="h-2.5 w-8 rounded bg-white" /><div className="h-2.5 w-8 rounded border border-white/60" /></div>
        </div>
        <div className="h-12 w-9 rounded-md bg-white/20" />
      </div>
      <div className="grid grid-cols-4 gap-1">{[0, 1, 2, 3].map(i => <div key={i} className="h-3 rounded bg-gray-100" />)}</div>
      <div className="grid grid-cols-3 gap-1">{[0, 1, 2].map(i => <div key={i} className="h-5 rounded bg-rose-50 ring-1 ring-rose-100" />)}</div>
    </div>
  );
}

function ClassicMock() {
  return (
    <div className="flex h-full flex-col gap-1.5 bg-white p-2">
      <div className="flex flex-1 items-center gap-2 rounded-md bg-gradient-to-l from-slate-50 to-rose-50 p-2">
        <div className="h-12 w-12 rounded-full bg-rose-100" />
        <div className="flex-1 space-y-1">
          <div className="h-1.5 w-1/4 rounded-full bg-rose-300" />
          <div className="h-2 w-4/5 rounded-full bg-gray-700" />
          <div className="h-1.5 w-3/5 rounded-full bg-gray-300" />
          <div className="mt-1 h-2.5 w-10 rounded bg-rose-600" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1">{[0, 1, 2].map(i => <div key={i} className="h-7 rounded bg-gray-50 ring-1 ring-gray-200" />)}</div>
    </div>
  );
}

function GenericMock() {
  return (
    <div className="flex h-full flex-col gap-1.5 bg-white p-2">
      <div className="flex-1 rounded-md bg-gray-100" />
      <div className="grid grid-cols-3 gap-1">{[0, 1, 2].map(i => <div key={i} className="h-6 rounded bg-gray-50 ring-1 ring-gray-200" />)}</div>
    </div>
  );
}

// A design added to shared/siteDesigns.ts shows up here with the generic picture until it gets its own.
const DESIGN_MOCKS: Partial<Record<SiteDesignId, () => ReactElement>> = { modern: ModernMock, classic: ClassicMock };

// ── The hero, small, in each variant's colours ──

type HeroPalette = {
  section: CSSProperties;
  title: string;
  accent: string;
  subtitle: string;
  badge: CSSProperties;
  primary: CSSProperties;
  secondary: CSSProperties;
};

const PALETTES: Record<HeroVariantId, HeroPalette> = {
  white: {
    section: { background: '#faf7f2' },
    title: '#1a0f12',
    accent: '#9f1239',
    subtitle: '#5b4b50',
    badge: { background: '#fff', color: '#9f1239', border: '1px solid #eadfd6' },
    primary: { background: '#9f1239', color: '#fff' },
    secondary: { background: '#fff', color: '#1a0f12', border: '1.5px solid rgba(26,15,18,.15)' },
  },
  red: {
    section: { background: 'linear-gradient(135deg,#9f1239 0%,#881337 45%,#4c0519 100%)' },
    title: '#fff',
    accent: '#f3c969',
    subtitle: 'rgba(255,255,255,.8)',
    badge: { background: 'rgba(255,255,255,.1)', color: '#f3c969', border: '1px solid rgba(255,255,255,.2)' },
    primary: { background: '#fff', color: '#9f1239' },
    secondary: { background: 'transparent', color: '#fff', border: '1.5px solid rgba(255,255,255,.45)' },
  },
  dark: {
    section: { background: '#1a0f12' },
    title: '#fff',
    accent: '#e3b65a',
    subtitle: 'rgba(255,255,255,.7)',
    badge: { background: 'rgba(255,255,255,.06)', color: '#e3b65a', border: '1px solid rgba(227,182,90,.3)' },
    primary: { background: '#e3b65a', color: '#1a0f12' },
    secondary: { background: 'transparent', color: '#fff', border: '1.5px solid rgba(255,255,255,.25)' },
  },
};

function HeroPreview({ id, text, shown }: { id: HeroVariantId; text: HeroText; shown: boolean }) {
  const palette = PALETTES[id];
  const at = text.highlight ? text.title.indexOf(text.highlight) : -1;
  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-2xl p-5 shadow-inner sm:p-6" style={palette.section}>
        {!shown && (
          <span className="absolute left-3 top-3 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-bold text-white">مش ظاهر دلوقتي</span>
        )}
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold" style={palette.badge}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: palette.accent }} />
          {text.badge}
        </span>
        <h4 className="mt-3 max-w-xl text-lg font-black leading-snug sm:text-xl" style={{ color: palette.title }}>
          {at === -1 ? text.title : (
            <>
              {text.title.slice(0, at)}
              <span style={{ color: palette.accent, textDecoration: 'underline', textDecorationThickness: 2, textUnderlineOffset: 6 }}>{text.highlight}</span>
              {text.title.slice(at + text.highlight.length)}
            </>
          )}
        </h4>
        <p className="mt-2 line-clamp-2 max-w-lg text-xs leading-5" style={{ color: palette.subtitle }}>{text.subtitle}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-xl px-3.5 py-2 text-xs font-black" style={palette.primary}>{text.primaryCta}</span>
          <span className="rounded-xl px-3.5 py-2 text-xs font-extrabold" style={palette.secondary}>{text.secondaryCta}</span>
        </div>
      </div>
      {text.highlight && at === -1 && (
        <p className="flex items-center gap-1.5 text-xs font-bold text-amber-700">
          <AlertTriangle size={13} /> «الكلمات الملونة» مش موجودة في العنوان بالظبط، فمش هتتلون — انسخها من العنوان زي ما هي.
        </p>
      )}
    </div>
  );
}

const heroKeyPattern = /^home\.hero\.(white|red|dark)\.(badge|title|highlight|subtitle|primaryCta|secondaryCta)$/;

/**
 * «تصميم الموقع»: which home page design the site shows (shared/siteDesigns.ts
 * DESIGNS — a design added there appears here), and the new design's rotating
 * hero: whether it rotates or stays on one colour, which colours take part, and
 * each colour's own text, previewed live in its own colours.
 */
export function DashboardSiteDesignPanel({ notify }: { notify: NotifyFn }) {
  const { content, setContentValues } = useStaticData();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const merged = useMemo(() => ({ ...content, ...drafts }), [content, drafts]);

  // The placeholder of a hero field is what the site would show with it empty:
  // the variant's default, or for the white hero the classic key it falls back to.
  const defaultFor = useCallback((key: string) => {
    const match = key.match(heroKeyPattern);
    if (!match) return siteDefault(key);
    const id = match[1] as HeroVariantId;
    return heroText({ ...merged, [key]: '' }, id)[match[2] as keyof HeroText];
  }, [merged]);

  const sections = useMemo<EditorSection[]>(() => {
    const byId = (id: string) => siteDesignFields.filter(field => field.section === id);
    return [
      {
        id: 'design',
        title: 'شكل الموقع',
        hint: 'التصميم اللي الزوار بيشوفوه في الصفحة الرئيسية. التغيير بيظهر أول ما تحفظ.',
        icon: <Monitor size={18} />,
        keywords: 'تصميم قديم جديد كلاسيك ثيم',
        keys: ['site.design'],
        fields: [],
        before: (api: EditorApi) => {
          const savedId = DESIGNS.some(d => d.id === content['site.design']) ? content['site.design'] : DEFAULT_DESIGN;
          const picked = DESIGNS.some(d => d.id === api.value('site.design')) ? api.value('site.design') : DEFAULT_DESIGN;
          return (
            <div className="grid gap-3 sm:grid-cols-2">
              {DESIGNS.map(design => {
                const Mock = DESIGN_MOCKS[design.id] || GenericMock;
                const active = picked === design.id;
                return (
                  <button key={design.id} type="button" onClick={() => api.set('site.design', design.id)} aria-pressed={active}
                    className={`group overflow-hidden rounded-2xl border-2 text-right transition ${
                      active ? 'border-primary-500 shadow-md ring-4 ring-primary-100' : 'border-gray-200 hover:border-gray-300'
                    }`}>
                    <div className="h-32 border-b border-gray-100 bg-gray-50 p-3">
                      <div className="h-full overflow-hidden rounded-lg shadow-sm ring-1 ring-gray-200"><Mock /></div>
                    </div>
                    <div className="space-y-1 p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-extrabold text-gray-900">{design.label}</span>
                        {active && <span className="grid h-6 w-6 place-items-center rounded-full bg-primary-600 text-white"><Check size={14} /></span>}
                      </div>
                      <p className="text-xs leading-5 text-gray-500">{design.description}</p>
                      {savedId === design.id
                        ? <span className="inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">الظاهر في الموقع دلوقتي</span>
                        : active && <span className="inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">هيظهر بعد ما تحفظ</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          );
        },
      },
      {
        id: 'heroMode',
        title: 'الهيدر المتغير',
        hint: 'في التصميم الجديد الهيدر ليه تلات ألوان. تقدر تخليه يتغير مع كل زيارة، أو تثبته على لون واحد.',
        icon: <Shuffle size={18} />,
        keywords: 'هيدر هيرو لون ثابت يتغير',
        keys: ['home.hero.mode'],
        fields: [],
        before: (api: EditorApi) => {
          const mode = api.value('home.hero.mode');
          const fixed = HERO_VARIANTS.some(v => v.id === mode) ? mode : 'rotate';
          const choices = heroChoices(merged);
          const allOff = fixed === 'rotate' && HERO_VARIANTS.every(v => api.value(heroKey(v.id, 'enabled')) === 'false');
          const classic = (api.value('site.design') || DEFAULT_DESIGN) === 'classic';
          const options: { id: string; label: string; sub: string; swatch?: CSSProperties }[] = [
            { id: 'rotate', label: 'تتغير مع كل زيارة', sub: 'كل مرة الزائر يفتح الموقع يشوف لون غير اللي شافه' },
            ...HERO_VARIANTS.map(v => ({ id: v.id, label: `ثابت على ${v.label.split(' — ')[0]}`, sub: v.tone, swatch: PALETTES[v.id].section })),
          ];
          return (
            <div className="space-y-3">
              {classic && (
                <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-800">
                  <AlertTriangle size={14} className="mt-0.5 flex-none" /> الموقع على التصميم الكلاسيكي — الهيدر المتغير بيظهر في التصميم الجديد بس. الكلاسيكي ليه هيدر واحد كلامه في آخر الصفحة دي.
                </p>
              )}
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" role="radiogroup" aria-label="الهيدر اللي يظهر">
                {options.map(option => {
                  const active = fixed === option.id;
                  return (
                    <button key={option.id} type="button" role="radio" aria-checked={active}
                      onClick={() => api.set('home.hero.mode', option.id)}
                      className={`flex items-start gap-2.5 rounded-xl border-2 p-3 text-right transition ${
                        active ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'
                      }`}>
                      {option.swatch
                        ? <span className="mt-0.5 h-6 w-6 flex-none rounded-lg ring-1 ring-black/10" style={option.swatch} />
                        : <span className="mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-lg bg-gradient-to-br from-[#faf7f2] via-[#9f1239] to-[#1a0f12] text-white"><Shuffle size={12} /></span>}
                      <span className="min-w-0">
                        <span className="block text-sm font-extrabold text-gray-900">{option.label}</span>
                        <span className="mt-0.5 block text-[11px] leading-4 text-gray-500">{option.sub}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-gray-500">
                هيظهر: <b className="text-gray-800">{choices.map(id => HERO_VARIANTS.find(v => v.id === id)?.label.split(' — ')[0]).join('، ')}</b>
                {fixed === 'rotate' && ' — وتقدر تشيل لون من التبديل من الكارت بتاعه تحت.'}
              </p>
              {allOff && (
                <p className="flex items-center gap-1.5 text-xs font-bold text-amber-700">
                  <AlertTriangle size={13} /> كل الألوان متشالة من التبديل، فالموقع هيعرض الأبيض.
                </p>
              )}
            </div>
          );
        },
      },
      ...HERO_VARIANTS.map(variant => ({
        id: `hero_${variant.id}`,
        title: `هيدر ${variant.label}`,
        hint: `${variant.tone}. سيب أي خانة فاضية عشان يظهر الكلام الأصلي المكتوب باهت.`,
        icon: <Palette size={18} />,
        keywords: 'هيدر هيرو عنوان زرار',
        fields: byId(`hero_${variant.id}`),
        before: <HeroPreview id={variant.id} text={heroText(merged, variant.id)} shown={heroChoices(merged).includes(variant.id)} />,
      })),
      {
        id: 'classic',
        title: 'هيدر التصميم الكلاسيكي',
        hint: 'الكلام اللي في هيدر التصميم الكلاسيكي. تلاتة منهم كمان بيظهروا في الهيدر الأبيض لو خانته فاضية.',
        icon: <LayoutTemplate size={18} />,
        keywords: 'قديم كلاسيك',
        fields: classicHeroFields,
      },
    ];
  }, [content, merged]);

  return (
    <ContentEditor
      title="تصميم الموقع"
      subtitle="اختار شكل الصفحة الرئيسية، وتحكم في الهيدر المتغير وكلام كل لون فيه — المعاينة بتتغير وانت بتكتب."
      icon={<Sparkles size={20} />}
      sections={sections}
      content={content}
      drafts={drafts}
      setDrafts={setDrafts}
      onSave={entries => setContentValues(entries)}
      notify={notify}
      defaultFor={defaultFor}
      successMessage="اتحفظ — الموقع هيظهر بالتصميم والهيدر الجداد."
    />
  );
}
