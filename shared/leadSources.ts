/**
 * One lead source, one name.
 *
 * «في صفحة العملاء المحتملين في المصادر في كمية كبيرة مكررة وملهاش لزمة» (16 Oct 2026). A lead's source is
 * free text — typed by hand, written by a sheet's tab name, an ad platform, an integration — so the filter
 * on the leads page listed every spelling it had ever met: «فيسبوك», «Facebook», «facebook », «FB Ads»,
 * «فيسبوك ليدز»… each its own line, each matching only its own leads.
 *
 * Two spellings are one source when they are the same words once case, hamza, the ya/alef-maqsura, digits,
 * punctuation and the well-known rails' English and Arabic names are put on one footing. Anything that is
 * a different word stays a different source: this never guesses that «الصحة النفسية» is something else.
 */
const WORDS: [RegExp, string][] = [
  [/\b(?:face ?book|fb|meta)\b|فيس ?بوك|فيسبوك|فيس/g, 'facebook'],
  [/\b(?:insta(?:gram)?|ig)\b|انستا?غرام|انستجرام|انستا/g, 'instagram'],
  [/\b(?:whats ?app|wa)\b|واتس ?اب|واتساب|واتس/g, 'whatsapp'],
  [/\b(?:google|gmail)\b|جوجل|قوقل|غوغل/g, 'google'],
  [/\b(?:tik ?tok)\b|تيك ?توك/g, 'tiktok'],
  [/\b(?:website|web ?site|site|web)\b|الموقع|موقع/g, 'website'],
  [/\b(?:leads?)\b|ليدز|ليد/g, 'leads'],
  [/\b(?:ads?|advert\w*)\b|اعلانات|اعلان/g, 'ads'],
];

const latin = (value: string) => value
  .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

/** The identity of a source: equal keys are the same source. Empty for no source. */
export function sourceKey(raw: string | null | undefined): string {
  let text = latin(String(raw ?? ''))
    .replace(/[‎‏‪-‮]/g, '')
    .replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[ً-ٟـ]/g, '')
    .toLowerCase();
  text = text.replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  for (const [pattern, word] of WORDS) text = text.replace(pattern, word);
  const seen = new Set<string>();
  return text.split(' ').filter(word => word && !seen.has(word) && seen.add(word)).join(' ');
}

export type SourceGroup = { key: string; name: string; total: number; variants: { name: string; count: number }[] };

/**
 * The sources behind `counts` (spelling → leads), merged by identity: the group's name is the spelling
 * `preferred` lists (the CRM's own list), else the one with most leads; biggest group first.
 */
export function groupSources(counts: Record<string, number>, preferred: string[] = []): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const [rawName, count] of Object.entries(counts)) {
    const name = rawName.trim();
    const key = sourceKey(name);
    if (!key) continue;
    const group = groups.get(key) || { key, name, total: 0, variants: [] };
    group.total += Number(count) || 0;
    group.variants.push({ name: rawName, count: Number(count) || 0 });
    groups.set(key, group);
  }
  const wanted = new Map(preferred.map(name => [sourceKey(name), name.trim()]));
  return [...groups.values()].map(group => {
    const best = [...group.variants].sort((a, b) => b.count - a.count || a.name.length - b.name.length)[0];
    return { ...group, name: wanted.get(group.key) || best.name.trim() };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ar'));
}
