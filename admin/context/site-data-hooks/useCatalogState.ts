import { useState } from 'react';
import type { MutableRefObject } from 'react';
import type { Course, Bundle, Therapist, TestimonialItem } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;
type PersistOrRevert = (apiCall: Promise<unknown>, revert: () => void, detail: { field: string; name?: string }) => void;

// Courses/bundles/therapists/testimonials are cross-entangled (course update touches
// embedding bundles, therapist rename touches courses by instructor name), so they're
// kept together as one "catalog" domain rather than split further.
export function useCatalogState(
  initialCourses: Course[],
  initialBundles: Bundle[],
  initialTherapists: Therapist[],
  initialTestimonials: TestimonialItem[],
  lastLocalConfigWriteRef: MutableRefObject<number>,
  persistOrRevert: PersistOrRevert,
  track: Track,
) {
  const [courses, setCourses] = useState<Course[]>(initialCourses);
  const [bundles, setBundles] = useState<Bundle[]>(initialBundles);
  const [therapists, setTherapists] = useState<Therapist[]>(initialTherapists);
  const [testimonials, setTestimonials] = useState<TestimonialItem[]>(initialTestimonials);

  // Write a single course/bundle document to its Firestore collection.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistCourseToCollection = (_course: Course) => { /* PG-only — no Firestore write */ };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistBundleToCollection = (_bundle: Bundle) => { /* PG-only — no Firestore write */ };

  // Write the full therapists/testimonials array directly to siteData/config immediately.
  // Called from every mutation so changes appear on the website without waiting for the
  // debounced config persist (which can be skipped by the echo-loop guard).
  const _persistConfigField = (field: string, value: unknown) => {
    lastLocalConfigWriteRef.current = Date.now();
    void mysqlAdmin.saveSettings({ [field]: JSON.parse(JSON.stringify(value)) } as Record<string,unknown>).catch(() => {});
  };
  const persistTherapistsToConfig = (updatedTherapists: Therapist[]) => _persistConfigField('therapists', updatedTherapists);
  const persistTestimonialsToConfig = (items: TestimonialItem[]) => _persistConfigField('testimonials', items);

  const addCourse = (course: Course) => {
    lastLocalConfigWriteRef.current = Date.now();
    const prevCourses = courses;
    let resolvedCourse = course;
    setCourses((prev) => {
      if (course.courseCode) {
        resolvedCourse = course;
        return [course, ...prev];
      }
      const maxCode = prev
        .map((c) => parseInt(c.courseCode || '0', 10))
        .filter((n) => !isNaN(n) && n >= 3000);
      const nextCode = maxCode.length > 0 ? Math.max(...maxCode) + 1 : 3000;
      resolvedCourse = { ...course, courseCode: String(nextCode) };
      return [resolvedCourse, ...prev];
    });
    // Write after state update so resolvedCourse is fully set
    setTimeout(() => persistCourseToCollection(resolvedCourse), 0);
    persistOrRevert(
      mysqlAdmin.saveCourse(resolvedCourse as unknown as Record<string,unknown>),
      () => setCourses(prevCourses),
      { field: 'course', name: resolvedCourse.title }
    );
    track('create', 'course', resolvedCourse.title);
  };

  const updateCourse = (course: Course) => {
    lastLocalConfigWriteRef.current = Date.now();
    const prevCourses = courses;
    const prevBundles = bundles;
    setCourses((prev) => prev.map((item) => (item.id === course.id ? course : item)));
    // Update all bundles that embed this course
    setBundles((prev) => {
      const updated = prev.map((bundle) => {
        const hasCourse = bundle.courses.some(c => c.id === course.id);
        if (!hasCourse) return bundle;
        const newBundle = { ...bundle, courses: bundle.courses.map((c) => (c.id === course.id ? course : c)) };
        persistBundleToCollection(newBundle);
        return newBundle;
      });
      return updated;
    });
    persistCourseToCollection(course);
    persistOrRevert(
      mysqlAdmin.saveCourse(course as unknown as Record<string,unknown>),
      () => { setCourses(prevCourses); setBundles(prevBundles); },
      { field: 'course', name: course.title }
    );
    track('update', 'course', course.title);
  };

  const deleteCourse = (id: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    const prevCourses = courses;
    const prevBundles = bundles;
    const removed = courses.find((item) => item.id === id);
    setCourses((prev) => prev.filter((item) => item.id !== id));
    persistOrRevert(
      mysqlAdmin.deleteCourse(id),
      () => { setCourses(prevCourses); setBundles(prevBundles); },
      { field: 'course', name: removed?.title }
    );
    // Remove course from bundles that embed it
    setBundles((prev) => {
      return prev.map((bundle) => {
        if (!bundle.courses.some(c => c.id === id)) return bundle;
        const newBundle = { ...bundle, courses: bundle.courses.filter((c) => c.id !== id) };
        persistBundleToCollection(newBundle);
        return newBundle;
      });
    });
    track('delete', 'course', id);
  };

  const addTherapist = (therapist: Therapist) => {
    lastLocalConfigWriteRef.current = Date.now();
    const prevTherapists = therapists;
    const nextTherapists = [therapist, ...therapists];
    setTherapists(nextTherapists);
    persistTherapistsToConfig(nextTherapists);
    persistOrRevert(
      mysqlAdmin.saveTherapist(therapist as unknown as Record<string,unknown>),
      () => { setTherapists(prevTherapists); persistTherapistsToConfig(prevTherapists); },
      { field: 'therapist', name: therapist.name }
    );
    track('create', 'therapist', therapist.name);
  };

  const updateTherapist = (therapist: Therapist) => {
    lastLocalConfigWriteRef.current = Date.now();
    const prevTherapists = therapists;
    const prevCourses = courses;
    const old = therapists.find((item) => item.id === therapist.id);
    const nextTherapists = therapists.map((item) => (item.id === therapist.id ? therapist : item));
    if (old && old.name !== therapist.name) {
      setCourses((coursesPrev) => {
        const updated = coursesPrev.map((c) => (c.instructor === old.name ? { ...c, instructor: therapist.name } : c));
        // Persist any courses that changed instructor name to their collection documents
        updated.filter(c => c.instructor === therapist.name && coursesPrev.find(oc => oc.id === c.id)?.instructor === old.name)
          .forEach(c => persistCourseToCollection(c));
        return updated;
      });
    }
    setTherapists(nextTherapists);
    persistTherapistsToConfig(nextTherapists);
    persistOrRevert(
      mysqlAdmin.saveTherapist(therapist as unknown as Record<string,unknown>),
      () => { setTherapists(prevTherapists); persistTherapistsToConfig(prevTherapists); setCourses(prevCourses); },
      { field: 'therapist', name: therapist.name }
    );
    track('update', 'therapist', therapist.name);
  };

  const deleteTherapist = (id: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    const prevTherapists = therapists;
    const target = therapists.find((item) => item.id === id);
    const nextTherapists = therapists.filter((item) => item.id !== id);
    setTherapists(nextTherapists);
    persistTherapistsToConfig(nextTherapists);
    persistOrRevert(
      mysqlAdmin.deleteTherapist(id),
      () => { setTherapists(prevTherapists); persistTherapistsToConfig(prevTherapists); },
      { field: 'therapist', name: target?.name }
    );
    if (target) {
      track('delete', 'therapist', target.name);
    }
  };

  const bundleToServerPayload = (bundle: Bundle): Record<string, unknown> => ({
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
    course_ids: bundle.courses.map((c) => c.id),
  });

  const addBundle = (bundle: Bundle) => {
    lastLocalConfigWriteRef.current = Date.now();
    const prevBundles = bundles;
    setBundles((prev) => [bundle, ...prev]);
    persistBundleToCollection(bundle);
    persistOrRevert(
      mysqlAdmin.saveBundle(bundleToServerPayload(bundle)),
      () => setBundles(prevBundles),
      { field: 'bundle', name: bundle.title }
    );
    track('create', 'bundle', bundle.title);
  };

  const updateBundle = (bundle: Bundle) => {
    lastLocalConfigWriteRef.current = Date.now();
    const prevBundles = bundles;
    setBundles((prev) => prev.map((item) => (item.id === bundle.id ? bundle : item)));
    persistBundleToCollection(bundle);
    persistOrRevert(
      mysqlAdmin.saveBundle(bundleToServerPayload(bundle)),
      () => setBundles(prevBundles),
      { field: 'bundle', name: bundle.title }
    );
    track('update', 'bundle', bundle.title);
  };

  const deleteBundle = (id: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    const prevBundles = bundles;
    const removed = bundles.find((item) => item.id === id);
    setBundles((prev) => prev.filter((item) => item.id !== id));
    persistOrRevert(
      mysqlAdmin.deleteBundle(id),
      () => setBundles(prevBundles),
      { field: 'bundle', name: removed?.title }
    );
    track('delete', 'bundle', id);
  };

  const addTestimonial = (item: TestimonialItem) => {
    lastLocalConfigWriteRef.current = Date.now();
    const prevTestimonials = testimonials;
    const next = [item, ...testimonials];
    setTestimonials(next);
    persistTestimonialsToConfig(next);
    persistOrRevert(
      mysqlAdmin.saveTestimonial(item as unknown as Record<string,unknown>),
      () => { setTestimonials(prevTestimonials); persistTestimonialsToConfig(prevTestimonials); },
      { field: 'testimonial', name: item.name }
    );
    track('create', 'testimonial', item.name);
  };

  const updateTestimonial = (item: TestimonialItem) => {
    lastLocalConfigWriteRef.current = Date.now();
    const prevTestimonials = testimonials;
    const next = testimonials.map((row) => (row.id === item.id ? item : row));
    setTestimonials(next);
    persistTestimonialsToConfig(next);
    persistOrRevert(
      mysqlAdmin.saveTestimonial(item as unknown as Record<string,unknown>),
      () => { setTestimonials(prevTestimonials); persistTestimonialsToConfig(prevTestimonials); },
      { field: 'testimonial', name: item.name }
    );
    track('update', 'testimonial', item.name);
  };

  const deleteTestimonial = (id: number) => {
    lastLocalConfigWriteRef.current = Date.now();
    const prevTestimonials = testimonials;
    const next = testimonials.filter((row) => row.id !== id);
    setTestimonials(next);
    persistTestimonialsToConfig(next);
    persistOrRevert(
      mysqlAdmin.deleteTestimonial(String(id)),
      () => { setTestimonials(prevTestimonials); persistTestimonialsToConfig(prevTestimonials); },
      { field: 'testimonial', name: String(id) }
    );
    track('delete', 'testimonial', String(id));
  };

  return {
    courses, setCourses, addCourse, updateCourse, deleteCourse,
    bundles, setBundles, addBundle, updateBundle, deleteBundle,
    therapists, setTherapists, addTherapist, updateTherapist, deleteTherapist,
    testimonials, setTestimonials, addTestimonial, updateTestimonial, deleteTestimonial,
  };
}
