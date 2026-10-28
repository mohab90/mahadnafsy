import { compressImage } from '../../../shared/imageCompress';
import { mysqlAdmin } from '../../lib/mysqlapi';

// «حساب محاضر»: the lecturer's own portal talks to /api/staff/lecturer/* (api/routes/lecturer-portal.js) — every answer is
// the signed-in lecturer's own.

export type Notify = (type: 'success' | 'error' | 'info', text: string) => void;

export type Overview = {
  profile: { staffId: string; name: string; role: string; phone: string; consultation: { id: string; enabled: boolean } | null };
  /** What this one login can do: lives and courses, consultations, a branch round's attendance — and whether the system makes the video rooms. */
  capabilities: { lecturer: boolean; consultant: boolean; branchRounds: boolean; systemMeetings: boolean };
  lives: { upcoming: number; liveNow: number; next: { id: string; title: string; at: string } | null };
  consultations: { pending: number; upcoming: number; urgent: number };
  consultationsEnabled: boolean;
  students: { online: number; rounds: number };
  rating: { instructor: number | null; course: number | null; count: number };
  earnings: { waiting: number; approved: number; paid: number; retention: number };
  unreadNotifications: number;
  performance: Performance;
  onboarding: { steps: Array<{ id: string; label: string; done: boolean; tab: string }>; done: number; total: number };
};

export type Performance = {
  attendanceRate: number | null; retentionRate: number | null; retainedClients: number; clients: number;
  consultationCompletionRate: number | null; completedConsultations: number; cancelledConsultations: number;
  liveCount: number; avgLiveAttendance: number | null;
};

export type Live = {
  id: string; title: string; scheduledAt: string; durationMinutes?: number; streamUrl: string; platform?: string;
  visibility: string; targetCourseIds: string[]; status: 'upcoming' | 'live' | 'ended'; description?: string;
  attendees: number; recordingUrl?: string; announcedAt?: string | null;
  /** The lecturer's own start link, when the system made the room. */
  hostUrl?: string;
};
export type Course = { id: string; title: string };

export type Slot = { id?: string; day: string; startTime: string; endTime: string; label?: string; meetingLink?: string; timezone?: string };
export type Availability = {
  enabled: boolean; hasProfile: boolean; sessionDurationMinutes?: number; slots: Slot[];
  blocked: Array<{ id: string; date: string; reason: string }>;
};

export type LecturerConsultation = {
  id: string; clientName: string; clientPhone: string; sessionType: string; sessionDate: string; status: string; notes: string;
  amount: number | null; currency: string | null; minutes: number | null; meetingLink: string; hostLink?: string; systemMade?: boolean; createdAt: string; source: string | null; paid: boolean;
  sessionTime?: string; pendingReschedule: { id: string; by: 'lecturer' | 'client'; at: string; reason: string } | null;
};

export type Reviews = {
  summary: {
    instructorScore: number | null; materialScore: number | null; deliveryScore: number | null; roundRatings: number;
    courseStars: number | null; courseRatings: number; distribution: Array<{ stars: number; count: number }>;
    consultationStars: number | null; consultationRatings: number;
  };
  items: Array<{ id: string; kind: 'round' | 'course' | 'consultation'; score: number; outOf: number; note: string; course: string; client: string; at: string }>;
};

export type Students = {
  online: Array<{ id: string; name: string; courseId: string; course: string; since: string; progress: number }>;
  rounds: Array<{ id: string; name: string; roundId: string; round: string; course: string; attended: number; held: number }>;
  lives: Array<{ id: string; title: string; at: string; attended: number }>;
  roundsList: Array<{ id: string; code: string; status: string; currentLecture: number; day: string; slot: string; branch: string; startDate: string; courseTitle: string; attendees: number }>;
  courses: Course[];
};

export type Earnings = {
  totals: { waiting: number; approved: number; paid: number; retention: number };
  byType: Array<{ type: string; label: string; count: number; total: number }>;
  fees: Array<{ id: string; type: string; label: string; amount: number; currency: string; status: string; month: number | null; year: number | null; course: string; note: string; hours: number | null; createdAt: string; paidAt: string | null }>;
  payslips: Array<{ month: number; year: number; status: string; net: number; commission: number; bonus: number }>;
};

export type RoundAttendance = {
  round: { id: string; code: string; status: string; course: string; session: number };
  attendees: Array<{ subscriberId: string; name: string; attended: number; sessions: number[] }>;
};

export type LecturerNotification = { id: string; type: string; title: string; message: string; read: boolean; at: string };

export type LecturerProfile = {
  staffId: string; name: string; role: string; phone: string;
  consultation: { id: string; enabled: boolean; title: string; specialty: string; bio: string; image: string; sessionDurationMinutes: number } | null;
};

export type CommunityPost = {
  id: string; title: string; body: string; authorName: string; authorRole: string; authorImage?: string; createdAt: string; likes: number;
  tag: string; pinned?: boolean; commentsList: Array<{ id: string; author: string; body: string; at: string }>;
};

const get = <T>(path: string) => mysqlAdmin.adminGet<T>(`/staff/lecturer/${path}`);

export const lecturerApi = {
  overview: () => get<Overview>('overview'),
  lives: () => get<{ lives: Live[]; courses: Course[]; meeting: { systemMade: boolean } }>('lives'),
  startConsultation: (id: string) => mysqlAdmin.adminPost<{ hostLink: string }>(`/staff/lecturer/consultations/${encodeURIComponent(id)}/start`, {}),
  createLive: (body: Record<string, unknown>) => mysqlAdmin.adminPost<{ id: string }>('/staff/lecturer/lives', body),
  updateLive: (id: string, body: Record<string, unknown>) => mysqlAdmin.adminPatch(`/staff/lecturer/lives/${encodeURIComponent(id)}`, body),
  deleteLive: (id: string) => mysqlAdmin.adminDelete(`/staff/lecturer/lives/${encodeURIComponent(id)}`),
  setLiveStatus: (id: string, status: 'LIVE' | 'ENDED', recordingUrl = '') =>
    mysqlAdmin.adminPatch(`/staff/me/live-streams/${encodeURIComponent(id)}/status`, { status, recordingUrl }),
  communityLive: (body: Record<string, unknown>) => mysqlAdmin.adminPost<{ id: string; postId: string; hostUrl?: string | null }>('/staff/lecturer/community-live', body),
  availability: () => get<Availability>('availability'),
  saveSlots: (slots: Slot[]) => mysqlAdmin.adminPut('/staff/lecturer/availability/slots', { slots }),
  blockDay: (date: string, reason: string) => mysqlAdmin.adminPost<{ alreadyBooked: number }>('/staff/lecturer/availability/blocked', { date, reason }),
  unblockDay: (id: string) => mysqlAdmin.adminDelete(`/staff/lecturer/availability/blocked/${encodeURIComponent(id)}`),
  consultations: () => get<LecturerConsultation[]>('consultations'),
  proposeReschedule: (id: string, body: { date: string; slotId: string; reason: string }) =>
    mysqlAdmin.adminPost(`/staff/lecturer/consultations/${encodeURIComponent(id)}/reschedule`, body),
  answerReschedule: (id: string, answer: 'accept' | 'decline', note = '') =>
    mysqlAdmin.adminPost(`/staff/lecturer/reschedules/${encodeURIComponent(id)}/answer`, { answer, note }),
  updateConsultation: (id: string, body: Record<string, unknown>) => mysqlAdmin.adminPatch(`/staff/lecturer/consultations/${encodeURIComponent(id)}`, body),
  reviews: () => get<Reviews>('reviews'),
  students: () => get<Students>('students'),
  earnings: (month?: number, year?: number) => get<Earnings>(`earnings${month && year ? `?month=${month}&year=${year}` : ''}`),
  notifications: () => get<LecturerNotification[]>('notifications'),
  readNotifications: () => mysqlAdmin.adminPost('/staff/lecturer/notifications/read', {}),
  profile: () => get<LecturerProfile>('profile'),
  saveProfile: (body: Record<string, unknown>) => mysqlAdmin.adminPatch('/staff/lecturer/profile', body),
  communityPosts: () => mysqlAdmin.adminGet<CommunityPost[]>('/community/posts'),
  communityLibrary: () => mysqlAdmin.adminGet<Array<{ id: string; title: string; description?: string; downloadUrl?: string; fileType?: string; category?: string }>>('/community/library'),
  communityVideos: () => mysqlAdmin.adminGet<Array<{ id: string; title: string; description?: string; video_url?: string; videoUrl?: string; duration?: string }>>('/community/videos'),
  communityEvents: () => mysqlAdmin.adminGet<Array<{ id: string; title: string; description?: string; date_label?: string; dateLabel?: string; slug?: string }>>('/community/events'),
  post: (body: Record<string, unknown>) => mysqlAdmin.adminPost<{ id: string }>('/staff/lecturer/community/posts', body),
  comment: (postId: string, body: string) => mysqlAdmin.adminPost(`/staff/lecturer/community/posts/${encodeURIComponent(postId)}/comments`, { body }),
  like: (postId: string) => mysqlAdmin.adminPost(`/staff/lecturer/community/posts/${encodeURIComponent(postId)}/like`, {}),
  deleteComment: (commentId: string) => mysqlAdmin.adminDelete(`/staff/lecturer/community/comments/${encodeURIComponent(commentId)}`),
  uploadPhoto: async (file: File) => {
    const dataUrl = await compressImage(file, 'photo');
    const { url } = await mysqlAdmin.adminPost<{ url: string }>('/staff/lecturer/media/image', { dataUrl });
    return url;
  },
  roundAttendance: (roundId: string) => get<RoundAttendance>(`rounds/${encodeURIComponent(roundId)}/attendance`),
  markAttendance: (roundId: string, subscriberIds: string[]) =>
    mysqlAdmin.adminPost<{ marked: number; already: number; failed: number }>(`/staff/lecturer/rounds/${encodeURIComponent(roundId)}/attendance`, { subscriberIds }),
  unmarkAttendance: (roundId: string, subscriberId: string, session: number) =>
    mysqlAdmin.adminDelete(`/staff/lecturer/rounds/${encodeURIComponent(roundId)}/attendance/${encodeURIComponent(subscriberId)}/${session}`),
  requestPayout: () => mysqlAdmin.adminPost<{ amount: number }>('/staff/lecturer/payout-request', {}),
  deletePost: (postId: string) => mysqlAdmin.adminDelete(`/staff/lecturer/community/posts/${encodeURIComponent(postId)}`),
};

export const money = (value: number, currency = 'EGP') => `${Number(value || 0).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 2 })} ${currency === 'EGP' ? 'ج.م' : currency}`;
export const errorText = (error: unknown, fallback = 'حصلت مشكلة — جرّب تاني') => (error instanceof Error && error.message ? error.message : fallback);

export const DAYS: Array<[string, string]> = [
  ['saturday', 'السبت'], ['sunday', 'الأحد'], ['monday', 'الاثنين'], ['tuesday', 'الثلاثاء'],
  ['wednesday', 'الأربعاء'], ['thursday', 'الخميس'], ['friday', 'الجمعة'],
];
export const dayLabel = (key: string) => DAYS.find(([id]) => id === key)?.[1] || key;
