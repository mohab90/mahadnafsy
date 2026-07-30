import { useState } from 'react';
import type { MutableRefObject } from 'react';
import type { Bundle, Course, TestimonialItem, Therapist } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

const bundlePayload = (bundle: Bundle): Record<string, unknown> => ({
  id: bundle.id,
  title: bundle.title,
  title_en: bundle.titleEn || null,
  slug: bundle.slug || null,
  short_description: bundle.shortDescription || '',
  description: bundle.description,
  thumbnail: bundle.thumbnail || '',
  video_url: bundle.videoUrl || null,
  price_egp: bundle.price?.EGP || 0,
  price_sar: bundle.price?.SAR || 0,
  price_usd: bundle.price?.USD || 0,
  orig_price_egp: bundle.originalPrice?.EGP || 0,
  orig_price_sar: bundle.originalPrice?.SAR || 0,
  orig_price_usd: bundle.originalPrice?.USD || 0,
  details_content_json: bundle.detailsContent ? JSON.stringify(bundle.detailsContent) : null,
  is_published: 1,
  sort_order: 0,
  course_ids: bundle.courses.map(course => course.id),
});

export function useCatalogState(
  initialCourses: Course[],
  initialBundles: Bundle[],
  initialTherapists: Therapist[],
  initialTestimonials: TestimonialItem[],
  lastWriteRef: MutableRefObject<number>,
  track: Track,
) {
  const [courses, setCourses] = useState(initialCourses);
  const [bundles, setBundles] = useState(initialBundles);
  const [therapists, setTherapists] = useState(initialTherapists);
  const [testimonials, setTestimonials] = useState(initialTestimonials);

  const persist = async (request: Promise<unknown>, field: string, name?: string) => {
    try { await request; return true; }
    catch {
      window.dispatchEvent(new CustomEvent('site-persist-error', { detail: { field, name } }));
      return false;
    }
  };

  const addCourse = async (course: Course) => {
    lastWriteRef.current = Date.now();
    const codes = courses.map(item => Number.parseInt(item.courseCode || '', 10)).filter(code => Number.isFinite(code) && code >= 3000);
    const item = course.courseCode ? course : { ...course, courseCode: String(codes.length ? Math.max(...codes) + 1 : 3000) };
    if (!await persist(mysqlAdmin.saveCourse(item as unknown as Record<string, unknown>), 'course', item.title)) return false;
    setCourses(current => [item, ...current.filter(row => row.id !== item.id)]);
    track('create', 'course', item.title);
    return true;
  };

  const updateCourse = async (course: Course) => {
    lastWriteRef.current = Date.now();
    if (!await persist(mysqlAdmin.saveCourse(course as unknown as Record<string, unknown>), 'course', course.title)) return false;
    setCourses(current => current.map(row => row.id === course.id ? course : row));
    setBundles(current => current.map(bundle => ({ ...bundle, courses: bundle.courses.map(row => row.id === course.id ? course : row) })));
    track('update', 'course', course.title);
    return true;
  };

  const deleteCourse = async (id: string) => {
    lastWriteRef.current = Date.now();
    const item = courses.find(row => row.id === id);
    if (!await persist(mysqlAdmin.deleteCourse(id), 'course', item?.title)) return false;
    setCourses(current => current.filter(row => row.id !== id));
    setBundles(current => current.map(bundle => ({ ...bundle, courses: bundle.courses.filter(row => row.id !== id) })));
    track('delete', 'course', id);
    return true;
  };

  const addTherapist = async (item: Therapist) => {
    lastWriteRef.current = Date.now();
    if (!await persist(mysqlAdmin.saveTherapist(item as unknown as Record<string, unknown>), 'therapist', item.name)) return false;
    setTherapists(current => [item, ...current.filter(row => row.id !== item.id)]);
    track('create', 'therapist', item.name);
    return true;
  };

  const updateTherapist = async (item: Therapist) => {
    lastWriteRef.current = Date.now();
    const previous = therapists.find(row => row.id === item.id);
    if (!await persist(mysqlAdmin.saveTherapist(item as unknown as Record<string, unknown>), 'therapist', item.name)) return false;
    setTherapists(current => current.map(row => row.id === item.id ? item : row));
    if (previous && previous.name !== item.name) {
      setCourses(current => current.map(course => course.instructor === previous.name ? { ...course, instructor: item.name } : course));
    }
    track('update', 'therapist', item.name);
    return true;
  };

  const deleteTherapist = async (id: string) => {
    lastWriteRef.current = Date.now();
    const item = therapists.find(row => row.id === id);
    if (!await persist(mysqlAdmin.deleteTherapist(id), 'therapist', item?.name)) return false;
    setTherapists(current => current.filter(row => row.id !== id));
    track('delete', 'therapist', item?.name || id);
    return true;
  };

  const addBundle = async (item: Bundle) => {
    lastWriteRef.current = Date.now();
    if (!await persist(mysqlAdmin.saveBundle(bundlePayload(item)), 'bundle', item.title)) return false;
    setBundles(current => [item, ...current.filter(row => row.id !== item.id)]);
    track('create', 'bundle', item.title);
    return true;
  };

  const updateBundle = async (item: Bundle) => {
    lastWriteRef.current = Date.now();
    if (!await persist(mysqlAdmin.saveBundle(bundlePayload(item)), 'bundle', item.title)) return false;
    setBundles(current => current.map(row => row.id === item.id ? item : row));
    track('update', 'bundle', item.title);
    return true;
  };

  const deleteBundle = async (id: string) => {
    lastWriteRef.current = Date.now();
    const item = bundles.find(row => row.id === id);
    if (!await persist(mysqlAdmin.deleteBundle(id), 'bundle', item?.title)) return false;
    setBundles(current => current.filter(row => row.id !== id));
    track('delete', 'bundle', id);
    return true;
  };

  const addTestimonial = async (item: TestimonialItem) => {
    lastWriteRef.current = Date.now();
    if (!await persist(mysqlAdmin.saveTestimonial(item as unknown as Record<string, unknown>), 'testimonial', item.name)) return false;
    setTestimonials(current => [item, ...current.filter(row => row.id !== item.id)]);
    track('create', 'testimonial', item.name);
    return true;
  };

  const updateTestimonial = async (item: TestimonialItem) => {
    lastWriteRef.current = Date.now();
    if (!await persist(mysqlAdmin.saveTestimonial(item as unknown as Record<string, unknown>), 'testimonial', item.name)) return false;
    setTestimonials(current => current.map(row => row.id === item.id ? item : row));
    track('update', 'testimonial', item.name);
    return true;
  };

  const deleteTestimonial = async (id: number) => {
    lastWriteRef.current = Date.now();
    if (!await persist(mysqlAdmin.deleteTestimonial(String(id)), 'testimonial', String(id))) return false;
    setTestimonials(current => current.filter(row => row.id !== id));
    track('delete', 'testimonial', String(id));
    return true;
  };

  return {
    courses, setCourses, addCourse, updateCourse, deleteCourse,
    bundles, setBundles, addBundle, updateBundle, deleteBundle,
    therapists, setTherapists, addTherapist, updateTherapist, deleteTherapist,
    testimonials, setTestimonials, addTestimonial, updateTestimonial, deleteTestimonial,
  };
}
