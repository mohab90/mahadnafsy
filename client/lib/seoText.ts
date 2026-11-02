/**
 * The title and description a course page gets when its seo_title / seo_description are empty. The same rules as
 * api/lib/seoPages.js (courseTitle, courseDescription), which writes them into the HTML a crawler fetches — the app must say the
 * same thing once it runs, or Google sees one title in the page's source and another in the rendered page.
 * api/tests/courseSeoTextsMatch.test.js compares the two.
 */
import { seoSummary } from './useSeo';

const SITE_NAME = 'معهد الدراسات النفسية';

type CourseSeoSource = {
  title: string;
  seo_title?: string;
  seo_description?: string;
  shortDescription?: string;
  description?: string;
  level?: string;
  hours?: number | null;
};

export function courseSeoTitle(course: CourseSeoSource): string {
  const title = String(course.title || '').trim();
  if (course.seo_title) return `${course.seo_title} | ${SITE_NAME}`;
  const full = `${title} | دبلومة معتمدة أونلاين | ${SITE_NAME}`;
  return full.length <= 72 ? full : `${title} | ${SITE_NAME}`;
}

export function courseSeoDescription(course: CourseSeoSource): string {
  const title = String(course.title || '').trim();
  const written = course.seo_description || seoSummary(course.shortDescription || course.description, '');
  if (written) return written;
  const level = String(course.level || '').trim();
  const hours = Number(course.hours) > 0 ? `${Math.round(Number(course.hours))} ساعة تدريبية` : '';
  const facts = [level && `المستوى: ${level}`, hours].filter(Boolean).join(' · ');
  return `${title} — دبلومة معتمدة أونلاين من ${SITE_NAME}${facts ? ` (${facts})` : ''}. سجّل الآن وابدأ التعلّم مع شهادة معتمدة.`;
}
