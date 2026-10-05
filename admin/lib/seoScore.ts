// How well a course or track page is set up for search — a score out of 10 and
// what to do next.
//
// «في صفحه الكورس او المسار يكون في نظام تقييم seo كام من 10 للصفحه وايه
// المقترحات لتقويتها». Every check reads what the public page actually sends to
// Google: CourseDetails / BundleDetails put seo_title (else the title) in
// <title>, seo_description (else the short description) in the meta
// description, and the slug in the address. The weights add up to 100 and the
// score is that over 10, so a check's weight is how much it moves the score.

export interface SeoInput {
  kind: 'course' | 'bundle';
  title: string;
  titleEn?: string;
  seoTitle?: string;
  seoDescription?: string;
  /** Comma separated; the first one is the page's focus keyword. */
  seoKeywords?: string;
  slug?: string;
  shortDescription?: string;
  description?: string;
  thumbnail?: string;
  videoUrl?: string;
  /** Modules of a course, or courses of a track. */
  outlineCount?: number;
  hasPrice?: boolean;
  instructor?: string;
  published?: boolean;
}

export type SeoState = 'good' | 'partial' | 'bad';

export interface SeoCheck {
  id: string;
  label: string;
  weight: number;
  earned: number;
  state: SeoState;
  /** What to do, when the check is not full marks. */
  tip?: string;
}

export interface SeoReport {
  /** 0–10, one decimal. */
  score: number;
  grade: string;
  checks: SeoCheck[];
  /** What Google would show. */
  snippet: { title: string; description: string; path: string };
}

const clean = (value?: string | null) => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** Arabic spelled the way a searcher types it: no tashkeel, one alef, ه for ة, ي for ى. */
export function normalizeForSearch(value?: string | null): string {
  return clean(value)
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');
}

export const wordCount = (value?: string | null) => clean(value).split(' ').filter(Boolean).length;

export const focusKeyword = (keywords?: string | null) =>
  String(keywords ?? '').split(/[,،]/).map(k => k.trim()).find(Boolean) ?? '';

const contains = (text: string, keyword: string) => !!keyword && normalizeForSearch(text).includes(normalizeForSearch(keyword));

function check(id: string, label: string, weight: number, state: SeoState, tip?: string): SeoCheck {
  const earned = state === 'good' ? weight : state === 'partial' ? Math.round(weight / 2) : 0;
  return { id, label, weight, earned, state, tip: state === 'good' ? undefined : tip };
}

export function scoreSeo(input: SeoInput): SeoReport {
  const isCourse = input.kind === 'course';
  const noun = isCourse ? 'الكورس' : 'المسار';
  const shownTitle = clean(input.seoTitle) || clean(input.title);
  const shownDescription = clean(input.seoDescription) || clean(input.shortDescription);
  const keyword = focusKeyword(input.seoKeywords);
  const slug = String(input.slug ?? '').trim();
  const body = clean(input.description);
  const words = wordCount(body);
  const checks: SeoCheck[] = [];

  // Google cuts a title near 60 characters; under 30 wastes the line.
  const titleLength = shownTitle.length;
  const titleOk = titleLength >= 30 && titleLength <= 65;
  checks.push(check('title', `عنوان البحث (${titleLength} حرف)`, 12,
    titleOk && clean(input.seoTitle) ? 'good' : titleOk || (titleLength >= 20 && titleLength <= 80) ? 'partial' : 'bad',
    !clean(input.seoTitle)
      ? `اكتب «عنوان SEO» خاص بين 30 و60 حرف — دلوقتي جوجل بيعرض اسم ${noun} زي ما هو.`
      : titleLength > 65 ? 'العنوان أطول من 60 حرف وجوجل هيقصّه — اختصره.' : 'العنوان قصير — زوّد عليه فايدة أو اسم المعهد لحد 30–60 حرف.'));

  // The meta description is the two lines under the title in the results.
  const descLength = shownDescription.length;
  const descOk = descLength >= 110 && descLength <= 165;
  checks.push(check('description', `وصف البحث (${descLength} حرف)`, 12,
    descOk && clean(input.seoDescription) ? 'good' : descOk || (descLength >= 70 && descLength <= 220) ? 'partial' : 'bad',
    !clean(input.seoDescription)
      ? 'اكتب «وصف SEO» من 120 لـ160 حرف فيه الكلمة المفتاحية ودعوة للتسجيل.'
      : descLength > 165 ? 'الوصف أطول من 160 حرف وهيتقص في نتائج البحث.' : 'الوصف قصير — خليه 120–160 حرف.'));

  checks.push(check('keyword', keyword ? `الكلمة المفتاحية: «${keyword}»` : 'الكلمة المفتاحية', 8,
    keyword ? 'good' : 'bad',
    'اكتب الكلمات المفتاحية مفصولة بفاصلة، وأول كلمة هي اللي الصفحة بتنافس عليها (مثلاً: دبلومة العلاج المعرفي السلوكي).'));

  checks.push(check('keyword_title', 'الكلمة المفتاحية في العنوان', 8,
    contains(shownTitle, keyword) ? 'good' : 'bad',
    keyword ? `حط «${keyword}» في عنوان البحث، ويفضّل في أوله.` : 'حدد كلمة مفتاحية الأول.'));

  checks.push(check('keyword_description', 'الكلمة المفتاحية في الوصف', 6,
    contains(shownDescription, keyword) ? 'good' : contains(body, keyword) ? 'partial' : 'bad',
    keyword ? `اذكر «${keyword}» في وصف البحث.` : 'حدد كلمة مفتاحية الأول.'));

  // A short Latin slug reads cleanly when shared; an Arabic one becomes %D8%…
  const latinSlug = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
  checks.push(check('slug', slug ? `الرابط: /${slug}` : 'رابط الصفحة (slug)', 8,
    latinSlug && slug.length <= 60 ? 'good' : slug ? 'partial' : 'bad',
    !slug ? `اكتب رابط إنجليزي قصير ${isCourse ? 'للكورس' : 'للمسار'} زي cbt-diploma — من غيره الرابط بيبقى رقم.`
      : !latinSlug ? 'خلي الرابط حروف إنجليزي صغيرة وأرقام وشرطات بس (الحروف العربي بتتحول لرموز طويلة).'
        : 'الرابط طويل — خليه أقل من 60 حرف.'));

  checks.push(check('content', `محتوى الصفحة (${words} كلمة)`, 12,
    words >= 300 ? 'good' : words >= 150 ? 'partial' : 'bad',
    `الوصف الكامل ${words} كلمة — جوجل بيفضّل 300 كلمة أو أكتر: مين ${isCourse ? 'الكورس' : 'المسار'} ده ليه، هتتعلم إيه، الشهادة، ومين المحاضر.`));

  checks.push(check('image', 'صورة الغلاف', 8, clean(input.thumbnail) ? 'good' : 'bad',
    'ارفع صورة غلاف — هي اللي بتظهر في مشاركة الرابط على فيسبوك وواتساب ونتائج الصور.'));

  checks.push(check('video', 'فيديو تعريفي', 5, clean(input.videoUrl) ? 'good' : 'bad',
    'ضيف فيديو تعريفي (يوتيوب) — بيطوّل وقت الزائر في الصفحة.'));

  const outline = input.outlineCount ?? 0;
  const outlineGoal = isCourse ? 3 : 2;
  checks.push(check('outline', isCourse ? `محاور الكورس (${outline})` : `كورسات المسار (${outline})`, 7,
    outline >= outlineGoal ? 'good' : outline > 0 ? 'partial' : 'bad',
    isCourse ? 'اكتب 3 محاور على الأقل في منهج الكورس — بتظهر كعناوين في الصفحة.' : 'المسار محتاج كورسين على الأقل.'));

  checks.push(check('title_en', 'الاسم بالإنجليزي', 4, clean(input.titleEn) ? 'good' : 'bad',
    'اكتب الاسم بالإنجليزي — ناس كتير بتدوّر بالإنجليزي (CBT Diploma مثلاً).'));

  checks.push(check('price', 'السعر', 4, input.hasPrice ? 'good' : 'bad',
    'حدد سعر — جوجل بيعرض السعر في نتيجة الكورس لو موجود.'));

  if (isCourse) {
    checks.push(check('instructor', 'المحاضر', 4, clean(input.instructor) ? 'good' : 'bad',
      'اكتب اسم المحاضر — الناس بتدوّر بأسماء المحاضرين.'));
  } else {
    checks.push(check('short', 'الوصف القصير', 4, wordCount(input.shortDescription) >= 8 ? 'good' : clean(input.shortDescription) ? 'partial' : 'bad',
      'اكتب وصف قصير جملة كاملة (8 كلمات أو أكتر) — بيظهر تحت العنوان.'));
  }

  checks.push(check('published', 'منشور في الموقع', 2, input.published ? 'good' : 'bad',
    `${noun} مش منشور — جوجل مش هيشوف الصفحة لحد ما تنشرها.`));

  const total = checks.reduce((sum, c) => sum + c.weight, 0);
  const earned = checks.reduce((sum, c) => sum + c.earned, 0);
  const score = Math.round((earned / total) * 100) / 10;
  const grade = score >= 8.5 ? 'ممتاز' : score >= 7 ? 'جيد' : score >= 5 ? 'متوسط' : 'ضعيف';
  return {
    score,
    grade,
    checks,
    snippet: {
      title: shownTitle,
      description: shownDescription,
      path: `${isCourse ? '/course/' : '/bundle/'}${slug || '…'}`,
    },
  };
}
