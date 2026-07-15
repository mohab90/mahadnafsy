import type { Bundle, Course } from '../../types';

export type CourseBookingMap = Record<string, { paidEGP: number; expectedEGP?: number; discount?: number }>;

export type InstallmentBookingInfo = {
  expectedEGP: number;
  paidEGP: number;
  remainingEGP: number;
  currency: 'EGP';
  title: string;
};

export function getInstallmentBookingInfo(params: {
  courseIdOrBundle: string;
  bundles: Bundle[];
  courses: Course[];
  bookingMap: CourseBookingMap;
  confirmedHistory: Array<{ bundleId?: string; amount: number }>;
}): InstallmentBookingInfo {
  const { courseIdOrBundle, bundles, courses, bookingMap, confirmedHistory } = params;
  if (!courseIdOrBundle) {
    return { expectedEGP: 0, paidEGP: 0, remainingEGP: 0, currency: 'EGP', title: '' };
  }

  if (courseIdOrBundle.startsWith('bundle:')) {
    const bundleId = courseIdOrBundle.replace('bundle:', '');
    const bundle = bundles.find(item => item.id === bundleId);
    const bundleCourseIds = (bundle?.courses || []).map(course => course.id);
    const paidViaBundle = confirmedHistory
      .filter(payment => payment.bundleId === bundleId)
      .reduce((sum, payment) => sum + payment.amount, 0);
    const paidViaCourses = bundleCourseIds.reduce((sum, courseId) => sum + (bookingMap[courseId]?.paidEGP || 0), 0);
    const paidEGP = paidViaBundle + paidViaCourses;
    const expectedFromCourses = bundleCourseIds.reduce((sum, courseId) => sum + (bookingMap[courseId]?.expectedEGP || 0), 0);
    const bundleEGPPrice = (bundle?.price as unknown as Record<string, number>)?.EGP || 0;
    const expectedEGP = expectedFromCourses || bundleEGPPrice;
    return {
      expectedEGP,
      paidEGP,
      remainingEGP: Math.max(0, expectedEGP - paidEGP),
      currency: 'EGP',
      title: bundle?.title || '',
    };
  }

  const booking = bookingMap[courseIdOrBundle];
  const course = courses.find(item => item.id === courseIdOrBundle);
  const expectedEGP = booking?.expectedEGP || course?.price.EGP || 0;
  const paidEGP = booking?.paidEGP || 0;
  return {
    expectedEGP,
    paidEGP,
    remainingEGP: Math.max(0, expectedEGP - paidEGP),
    currency: 'EGP',
    title: course?.title || '',
  };
}
