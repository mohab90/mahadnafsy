import { BUNDLES, COURSES, TESTIMONIALS, THERAPISTS } from '../constants';
import type {
  ActivityLogItem,
  CommunityEventItem,
  CommunityLibraryItem,
  CommunityPostItem,
  CommunityVideoItem,
  ConsultationItem,
  CourseChapterItem,
  CourseLectureItem,
  DiscountRule,
  LeadItem,
  NotificationBroadcast,
  OrderItem,
  StaffMember,
  SubscriberItem,
} from '../types';

import { defaultContent } from '../../shared/siteContentDefaults';
export { defaultContent };

export const defaultSubscribers: SubscriberItem[] = [];

export const defaultLeads: LeadItem[] = [];

export const defaultStaffMembers: StaffMember[] = [];

export const defaultConsultations: ConsultationItem[] = [];

export const defaultLectures: CourseLectureItem[] = COURSES.flatMap((course) =>
  course.modules.map((moduleTitle, idx) => ({
    id: `lec-${course.id}-${idx + 1}`,
    courseId: course.id,
    title: moduleTitle,
    lectureType: 'recorded' as const,
    videoUrl: `https://example.com/lecture/${course.id}/${idx + 1}`,
    duration: '45 دقيقة',
    order: idx + 1,
  }))
);

export const defaultCommunityPosts: CommunityPostItem[] = [];

export const defaultCommunityLibraryItems: CommunityLibraryItem[] = [];

export const defaultCommunityVideos: CommunityVideoItem[] = [];

export const defaultCommunityEvents: CommunityEventItem[] = [];

// NOTE: seedData is used ONLY on the very first run when no saved data exists.
// Once real data is loaded from Firestore or localStorage, seedData is never used again.
// Do NOT add real production records here — they will be overwritten on next Firestore sync.
export const seedData = {
  courses: COURSES,
  bundles: BUNDLES,
  therapists: THERAPISTS,
  testimonials: TESTIMONIALS,
  subscribers: defaultSubscribers,
  leads: defaultLeads,
  staffMembers: defaultStaffMembers,
  consultations: defaultConsultations,
  lectures: defaultLectures,
  chapters: [] as CourseChapterItem[],
  orders: [] as OrderItem[],
  communityPosts: defaultCommunityPosts,
  communityLibraryItems: defaultCommunityLibraryItems,
  communityVideos: defaultCommunityVideos,
  communityEvents: defaultCommunityEvents,
  content: defaultContent,
  activityLogs: [] as ActivityLogItem[],
  discounts: [] as DiscountRule[],
  notifications: [] as NotificationBroadcast[],
};
