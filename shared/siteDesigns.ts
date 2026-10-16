/**
 * The site's designs and the home page's hero variants — one list read by the
 * public site (what to draw) and by the panel (what can be chosen), so a design
 * added here appears in both.
 *
 * Content keys:
 *   site.design            which home page design the site shows (DESIGNS ids)
 *   home.hero.mode         'rotate' (a different hero on each visit) or one variant id
 *   home.hero.<id>.enabled 'false' takes a variant out of the rotation
 *   home.hero.<id>.badge / .title / .highlight / .subtitle / .primaryCta / .secondaryCta
 */

export type SiteDesignId = 'modern' | 'classic';

export const DESIGNS: { id: SiteDesignId; label: string; description: string }[] = [
  { id: 'modern', label: 'التصميم الجديد', description: 'الصفحة الرئيسية الجديدة: هيدر متغير، صور الخريجين، حاسبة الدفع، والسلايدات الجديدة.' },
  { id: 'classic', label: 'التصميم الكلاسيكي', description: 'الصفحة الرئيسية زي ما كانت قبل التحديث.' },
];

export const DEFAULT_DESIGN: SiteDesignId = 'modern';

export const siteDesign = (content: Record<string, string | undefined>): SiteDesignId => {
  const id = content['site.design'];
  return DESIGNS.some(d => d.id === id) ? (id as SiteDesignId) : DEFAULT_DESIGN;
};

export type HeroVariantId = 'white' | 'red' | 'dark';

export type HeroText = {
  badge: string;
  title: string;
  /** The words of the title drawn in the accent colour (must appear in the title). */
  highlight: string;
  subtitle: string;
  primaryCta: string;
  secondaryCta: string;
};

export const HERO_VARIANTS: { id: HeroVariantId; label: string; tone: string; defaults: HeroText }[] = [
  {
    id: 'white',
    label: 'الأبيض — ثلاث خريجين',
    tone: 'خلفية فاتحة، وثلاث صور لخريجين بشهاداتهم',
    defaults: {
      badge: 'مستقبلك المهني يبدأ من هنا',
      title: 'ابدأ مسارك المهني في الصحة النفسية بتدريب نظري وعملي مع أفضل دكاترة علم النفس وبشهادة معتمدة',
      highlight: 'الصحة النفسية',
      subtitle: 'المنصة الأكاديمية الأولى عربياً لتعليم الصحة النفسية والعلاج النفسي. دبلومات معتمدة، وتدريب عملي مع نخبة الخبراء.',
      primaryCta: 'احجز مكانك الآن',
      secondaryCta: 'تصفح الدبلومات',
    },
  },
  {
    id: 'red',
    label: 'الأحمر — خريجة بشهاداتها',
    tone: 'خلفية حمراء غامقة، وخريجة بشهاداتها',
    defaults: {
      badge: 'التسجيل مفتوح الآن',
      title: 'دبلومات في العلاج والإرشاد النفسي على إيد دكاترة بيمارسوا المهنة',
      highlight: 'العلاج والإرشاد النفسي',
      subtitle: 'تدريب عملي على حالات، وإشراف مباشر، وشهادة معتمدة بكود تحقق أي جهة تقدر تتأكد منه.',
      primaryCta: 'احجز مكانك الآن',
      secondaryCta: 'تصفح الدبلومات',
    },
  },
  {
    id: 'dark',
    label: 'الأسود — خريج بشهاداته',
    tone: 'خلفية سوداء ولمسة دهبي، وخريج بشهاداته',
    defaults: {
      badge: 'آلاف الخريجين بدأوا من هنا',
      title: 'الخطوة الجاية في مشوارك المهني تبدأ بشهادة معتمدة',
      highlight: 'بشهادة معتمدة',
      subtitle: 'اختار برنامجك، ادرس أونلاين أو في الفرع، وادفع كاش بخصم أكبر أو قسّط على راحتك.',
      primaryCta: 'احجز مكانك الآن',
      secondaryCta: 'شوف البرامج',
    },
  },
];

// The white variant also answers to the hero keys the page used before variants existed.
const LEGACY_WHITE: Partial<Record<keyof HeroText, string>> = {
  badge: 'home.hero.badge',
  subtitle: 'home.heroSubtitle',
  secondaryCta: 'home.hero.primaryCta',
};

/** The text of one variant: what the panel saved, else the default. */
export function heroText(content: Record<string, string | undefined>, id: HeroVariantId): HeroText {
  const variant = HERO_VARIANTS.find(v => v.id === id) || HERO_VARIANTS[0];
  const out = { ...variant.defaults };
  for (const field of Object.keys(out) as (keyof HeroText)[]) {
    const own = content[`home.hero.${id}.${field}`];
    const legacy = id === 'white' && LEGACY_WHITE[field] ? content[LEGACY_WHITE[field] as string] : undefined;
    const value = (own || legacy || '').trim();
    if (value) out[field] = value;
  }
  return out;
}

/** The variants that may be shown: the one the panel fixed, or every enabled one. */
export function heroChoices(content: Record<string, string | undefined>): HeroVariantId[] {
  const mode = content['home.hero.mode'];
  if (HERO_VARIANTS.some(v => v.id === mode)) return [mode as HeroVariantId];
  const enabled = HERO_VARIANTS.filter(v => content[`home.hero.${v.id}.enabled`] !== 'false').map(v => v.id);
  return enabled.length ? enabled : ['white'];
}

/** The next variant after `last` among `choices`, so a refresh never repeats the one just seen. */
export function nextHero(choices: HeroVariantId[], last: string | null | undefined, random = Math.random): HeroVariantId {
  if (choices.length === 1) return choices[0];
  const at = choices.indexOf(last as HeroVariantId);
  if (at === -1) return choices[Math.floor(random() * choices.length) % choices.length];
  return choices[(at + 1) % choices.length];
}
