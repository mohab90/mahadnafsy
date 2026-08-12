// ══════════════════════════════════════════════════════════════
// lib/mysqlapi.ts — MySQL REST API client (complete)
// ══════════════════════════════════════════════════════════════

import { AuthUser } from '../types';

// Relative by default — always targets whatever origin actually served the page
// (Nginx-proxied in every real deploy). A hardcoded absolute production URL here
// would silently point a misconfigured dev/staging build at real prod data.
const API_BASE = import.meta.env.VITE_API_URL || '/api';

function getToken(): string | null {
  return localStorage.getItem('mahad-token');
}

// Was 30s with up to 2 retries (3 total attempts) and 3-5s backoff between each —
// worst case ~98s of pure waiting on a single failed endpoint, and since the home
// page fires ~12 of these in parallel, any transient hiccup turned into a 3x
// request-storm exactly when the server was already struggling. A real deploy
// restart recovers in ~1s (measured), so this window only needs to be short.
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RETRIES = 1;
const RETRY_BACKOFF_MS = 1_000;
class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function apiFetch<T>(path: string, options: RequestInit = {}, auth = false, _retry = 0): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (auth) { const t = getToken(); if (t) headers['Authorization'] = `Bearer ${t}`; }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include', signal: controller.signal });
    clearTimeout(timeoutId);
    // Auto-retry on 502/503/504 (server restarting) — 1 extra attempt only.
    if ((res.status === 502 || res.status === 503 || res.status === 504) && _retry < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS));
      return apiFetch<T>(path, options, auth, _retry + 1);
    }
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new ApiError(b.error || `HTTP ${res.status}`, res.status); }
    return res.json() as Promise<T>;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    // Retry on network failure (TypeError: Failed to fetch) — 1 extra attempt only.
    if (err instanceof TypeError && _retry < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS));
      return apiFetch<T>(path, options, auth, _retry + 1);
    }
    throw err;
  }
}

type QueuedProgress = { lectureId: string; pct: number; watchSeconds?: number };
const isRetryableProgressError = (error: unknown) =>
  error instanceof TypeError ||
  (error instanceof DOMException && error.name === 'AbortError') ||
  (error instanceof ApiError && (error.status === 408 || error.status === 429 || error.status >= 500));
const progressQueueKey = () => {
  const token = getToken() || '';
  let identity = token || 'anonymous';
  try {
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    const subject = payload.uid || payload.email;
    if (subject) identity = `${payload.tenant_id || payload.tenantId || ''}:${subject}`;
  } catch { /* malformed/legacy token: hash the token itself */ }
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index++) hash = Math.imul(hash ^ identity.charCodeAt(index), 16777619);
  return `mahad-progress-queue:${(hash >>> 0).toString(36)}`;
};
const readProgressQueue = (): QueuedProgress[] => {
  try { return JSON.parse(localStorage.getItem(progressQueueKey()) || '[]') as QueuedProgress[]; } catch { return []; }
};
const writeProgressQueue = (items: QueuedProgress[]) => {
  try { localStorage.setItem(progressQueueKey(), JSON.stringify(items.slice(-200))); } catch { /* storage unavailable */ }
};
const queueProgress = (lectureId: string, pct: number, watchSeconds = 0) => {
  const queued = readProgressQueue();
  const current = queued.find(item => item.lectureId === lectureId);
  if (current) {
    current.pct = Math.max(current.pct, pct);
    current.watchSeconds = Math.max(current.watchSeconds || 0, watchSeconds);
  } else queued.push({ lectureId, pct, watchSeconds });
  writeProgressQueue(queued);
};
export async function flushLectureProgressQueue() {
  const queued = readProgressQueue();
  if (!queued.length || !getToken()) return 0;
  const remaining: QueuedProgress[] = [];
  let synced = 0;
  for (const item of queued) {
    try {
      await apiFetch('/me/progress', { method: 'PATCH', body: JSON.stringify(item) }, true);
      synced++;
    } catch (error) {
      if (isRetryableProgressError(error)) remaining.push(item);
    }
  }
  writeProgressQueue(remaining);
  if (synced && typeof window !== 'undefined') window.dispatchEvent(new Event('mahad-progress-synced'));
  return synced;
}
async function saveLectureProgress(lectureId: string, pct: number, watchSeconds = 0) {
  try {
    const result = await apiFetch<{ ok: boolean }>('/me/progress', {
      method: 'PATCH', body: JSON.stringify({ lectureId, pct, watchSeconds }),
    }, true);
    void flushLectureProgressQueue();
    return { ...result, queued: false };
  } catch (error) {
    if (isRetryableProgressError(error)) {
      queueProgress(lectureId, pct, watchSeconds);
      return { ok: false, queued: true };
    }
    throw error;
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { void flushLectureProgressQueue(); });
  setTimeout(() => { void flushLectureProgressQueue(); }, 0);
}

type AR = Record<string, unknown>;

// ── Public catalog ────────────────────────────────────────────────────────────
export const mysqlCatalog = {
  getClientContext: () => apiFetch<{
    countryCode: string;
    currency: 'EGP' | 'SAR' | 'USD';
    branch: 'ONLINE_EGYPT' | 'ONLINE_SAUDI' | 'ONLINE_ABROAD';
    source: string;
    locationResolved: true;
  }>('/public/client-context'),
  listCourses: (limit = 500, offset = 0) => apiFetch<AR[]>(`/courses?limit=${limit}&offset=${offset}`),
  getCourse: (idOrSlug: string) => apiFetch<AR & { lectures?: AR[]; chapters?: AR[] }>(`/courses/${encodeURIComponent(idOrSlug)}`),
  listBundles: (limit = 200) => apiFetch<AR[]>(`/bundles?limit=${limit}`),
  listLectures: (limit = 5000, offset = 0) => apiFetch<AR[]>(`/lectures?limit=${limit}&offset=${offset}`),
  listChapters: (limit = 1000) => apiFetch<AR[]>(`/chapters?limit=${limit}`),
  listTherapists: (limit = 100) => apiFetch<AR[]>(`/therapists?limit=${limit}`),
  listTestimonials: () => apiFetch<AR[]>('/testimonials'),
  listQuizzes: (limit = 200) => apiFetch<AR[]>(`/quizzes?limit=${limit}`, {}, true),
  listLiveStreams: (limit = 200) => apiFetch<AR[]>(`/live-streams?limit=${limit}`),
  listDiscounts: () => apiFetch<AR[]>('/discounts'),
  listCommunityPosts: () => apiFetch<AR[]>('/community/posts'),
  listCommunityLibrary: () => apiFetch<AR[]>('/community/library'),
  listCommunityVideos: () => apiFetch<AR[]>('/community/videos'),
  listCommunityEvents: () => apiFetch<AR[]>('/community/events'),
  getSiteContent: () => apiFetch<Record<string, string>>('/content'),
};

// ── Non-admin (client) ────────────────────────────────────────────────────────
export const mysqlClient = {
  heartbeat: (name?: string) => apiFetch<{ ok: boolean }>('/me/heartbeat', { method: 'POST', body: JSON.stringify({ name: name || '' }) }, true),
  getMySubscriber: () => apiFetch<AR | null>('/me/subscriber', {}, true),
  getMyPrivacyRequests: () => apiFetch<Array<{
    id: string; request_type: 'erasure'; status: string; reason?: string | null;
    decision_note?: string | null; legal_hold_reason?: string | null;
    due_at: string; completed_at?: string | null; created_at: string;
  }>>('/me/privacy/requests', {}, true),
  requestPrivacyErasure: (reason: string) =>
    apiFetch<{ ok: boolean; id: string; status: string }>(
      '/me/privacy/requests',
      { method: 'POST', body: JSON.stringify({ request_type: 'erasure', reason }) },
      true,
    ),
  downloadMyPrivacyExport: async () => {
    const token = getToken();
    const response = await fetch(`${API_BASE}/me/privacy/export`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new ApiError(body.error || `HTTP ${response.status}`, response.status);
    }
    return response.blob();
  },
  getMyConsultations: () => apiFetch<AR[]>('/me/consultations', {}, true),
  getMyQuizAttempts: () => apiFetch<AR[]>('/me/quiz-attempts', {}, true),
  // Server grades against its own copy of correctIndex (never trusts a client score) — LMS-06.
  submitQuizAttempt: (quizId: string, answers: number[]) =>
    apiFetch<{ ok: boolean; id: string; score: number; passed: boolean; correctCount: number; total: number }>(
      '/me/quiz-attempts', { method: 'POST', body: JSON.stringify({ quizId, answers }) }, true
    ),
  checkIsStaff: () => apiFetch<{ isStaff: boolean; isAdmin: boolean; role?: string; staffId?: string }>('/me/is-staff', {}, true),
  getStaffSelf: () => apiFetch<AR>('/staff/me', {}, true),
  saveLectureProgress,
  // Auth-gated: returns a short-lived media ticket only if enrollment policy allows access.
  getLectureAccess: (lectureId: string) =>
    apiFetch<{ accessible: boolean; video_url?: string; video_kind?: 'embed' | 'hls' | 'video'; expires_in?: number; reason?: string; unlocks_at?: string }>(`/me/lectures/${encodeURIComponent(lectureId)}/access`, {}, true),
  getLectureNote: (lectureId: string) =>
    apiFetch<{ note: string }>(`/me/lecture-notes/${encodeURIComponent(lectureId)}`, {}, true),
  saveLectureNote: (lectureId: string, note: string) =>
    apiFetch<{ ok: boolean }>(`/me/lecture-notes/${encodeURIComponent(lectureId)}`, {
      method: 'PUT', body: JSON.stringify({ note }),
    }, true),
  // Payment proofs
  createPaymentIntent: (data: { order_id: string; provider?: 'manual'; idempotency_key?: string }) =>
    apiFetch<{ ok: boolean; id: string; order_id: string; amount: number; currency: string; status: string }>(
      '/me/payment-intents', { method: 'POST', body: JSON.stringify(data) }, true
    ),
  submitPaymentProof: (data: { order_id: string; payment_intent_id?: string; payment_method: string; proof_image?: string | null; note?: string }) =>
    apiFetch<{ ok: boolean; id: string; payment_intent_id: string; payment_attempt_id: string }>(
      '/me/payment-proof', { method: 'POST', body: JSON.stringify(data) }, true
    ),
  getMyPaymentProofs: () => apiFetch<AR[]>('/me/payment-proofs', {}, true),
  getMyOrders: () => apiFetch<Array<{ id: string; item_id: string | null; item_title: string; type: string; status: string; amount: number; currency: string }>>('/me/orders', {}, true),
  // Course ratings
  getCourseRatings: (courseId: string) => apiFetch<{ avg: number; count: number; myRating: { rating: number; comment: string } | null }>(`/courses/${encodeURIComponent(courseId)}/ratings`, {}, true),
  rateCourse: (courseId: string, rating: number, comment?: string) =>
    apiFetch<{ ok: boolean; avg: number; count: number }>(`/courses/${encodeURIComponent(courseId)}/rate`, { method: 'POST', body: JSON.stringify({ rating, comment }) }, true),
  // Community — customer-created post (saved as pending for admin review)
  createCommunityPost: (o: AR) =>
    apiFetch<{ ok: boolean; id: string; status: string }>('/community/posts', { method: 'POST', body: JSON.stringify(o) }, true),
  // Community — customer edit/delete of THEIR OWN post (MKT-16)
  updateCommunityPost: (id: string, o: AR) =>
    apiFetch<{ ok: boolean; status?: string }>(`/community/posts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(o) }, true),
  deleteCommunityPost: (id: string) =>
    apiFetch<{ ok: boolean }>(`/community/posts/${encodeURIComponent(id)}`, { method: 'DELETE' }, true),
  toggleCommunityPostLike: (id: string) =>
    apiFetch<{ ok: boolean; liked: boolean; likes: number }>(`/community/posts/${encodeURIComponent(id)}/like`, { method: 'POST' }, true),
  addCommunityPostComment: (id: string, body: string) =>
    apiFetch<{ ok: boolean; comment: { id: string; author: string; body: string; at: string } }>(
      `/community/posts/${encodeURIComponent(id)}/comments`,
      { method: 'POST', body: JSON.stringify({ body }) },
      true,
    ),
  getBroadcastNotifications: () =>
    apiFetch<{ notifications: AR[]; readIds: string[] }>('/notifications/broadcasts', {}, true),
  markBroadcastNotificationRead: (id: string) =>
    apiFetch<{ ok: boolean }>(`/notifications/broadcasts/${encodeURIComponent(id)}/read`, { method: 'PATCH', body: '{}' }, true),
  markAllBroadcastNotificationsRead: () =>
    apiFetch<{ ok: boolean }>('/notifications/broadcasts/read-all', { method: 'PATCH', body: '{}' }, true),
  // Certificate request — writes to the certificate_requests table (single source of truth)
  createCertificateRequest: (o: AR) =>
    apiFetch<{ ok: boolean; id: string; status: string; price: number | null; currency: 'EGP' | 'SAR' | 'USD' | null }>('/me/certificate-request', { method: 'POST', body: JSON.stringify(o) }, true),
  // Lecture view tracking
  trackLectureView: (lectureId: string) =>
    apiFetch<{ ok: boolean }>(`/lectures/${encodeURIComponent(lectureId)}/view`, { method: 'POST' }, true),
  // Course completions / digital certificates
  getMyCompletions: () => apiFetch<AR[]>('/me/completions', {}, true),
  getMyTimeline: () => apiFetch<AR[]>('/me/timeline', {}, true),
  verifyCertificate: (code: string) => apiFetch<AR>(`/completions/verify/${encodeURIComponent(code)}`),
  // Referral
  getMyReferralCode: () => apiFetch<{ code: string; uses: number; earnings: number }>('/referral/my-code', {}, true),
  getMyLoyalty: () => apiFetch<{ ok: boolean; balance: number; ledger: AR[] }>('/me/loyalty', {}, true),
  getPushPublicKey: () => apiFetch<{ ok: boolean; enabled: boolean; publicKey: string | null }>('/push/vapid-public-key'),
  subscribePush: (subscription: PushSubscriptionJSON) =>
    apiFetch<{ ok: boolean }>('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription }) }, true),
  sendTestPush: () => apiFetch<{ ok: boolean; sent: number }>('/push/test-send', { method: 'POST', body: JSON.stringify({}) }, true),
};

// ── Admin ─────────────────────────────────────────────────────────────────────
const A = true; // auth flag
const post = (path: string, body: unknown) => apiFetch<{ ok: boolean; id?: string; code?: string }>(path, { method: 'POST', body: JSON.stringify(body) }, A);
const patch = (path: string, body: unknown) => apiFetch<{ ok: boolean }>(path, { method: 'PATCH', body: JSON.stringify(body) }, A);
const del = (path: string) => apiFetch<{ ok: boolean }>(path, { method: 'DELETE' }, A);
const put = (path: string, body: unknown) => apiFetch<{ ok: boolean }>(path, { method: 'PUT', body: JSON.stringify(body) }, A);

export const mysqlAdmin = {
  // ── Generic helpers (for ad-hoc admin endpoints) ──
  adminGet: <T = AR>(path: string) => apiFetch<T>(path, {}, A),
  adminPost: <T = AR>(path: string, body: AR) => apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) }, A),
  adminPatch: <T = AR>(path: string, body: AR) => apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) }, A),
  // ── Users management ──
  listAllUsers:  () => apiFetch<AR[]>('/admin/users', {}, A),
  deactivateUser: (id: string) => apiFetch<{ ok: boolean }>(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }, A),
  // ── List (read) ──
  listAllCourses:          (limit = 500)  => apiFetch<AR[]>(`/admin/courses?limit=${limit}`, {}, A),
  getOnlineUsers:          ()             => apiFetch<AR[]>('/admin/online-users', {}, A),
  listAllTherapists:       ()             => apiFetch<AR[]>('/admin/therapists', {}, A),
  listAllSubscribers:      async (pageSize = 2000): Promise<AR[]> => {
    const all: AR[] = [];
    let offset = 0;
    while (true) {
      const page = await apiFetch<AR[]>(`/admin/subscribers?limit=${pageSize}&offset=${offset}`, {}, A);
      all.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    return all;
  },
  listAllLeads:            async (pageSize = 2000): Promise<AR[]> => {
    const all: AR[] = [];
    let offset = 0;
    while (true) {
      const page = await apiFetch<AR[]>(`/admin/leads?limit=${pageSize}&offset=${offset}`, {}, A);
      all.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    return all;
  },
  listMySubscribers:       () => apiFetch<AR[]>('/staff/my-subscribers', {}, A),
  listMyCollectionClients: () => apiFetch<AR[]>('/staff/my-collection-clients', {}, A),
  listMyDaqqiClients:      () => apiFetch<AR[]>('/staff/my-daqqi-clients', {}, A),
  assignSubscriberCollection: (subId: string, collectionId: string | null, collectionName: string | null) =>
    apiFetch<AR>(`/admin/subscribers/${subId}/assign-collection`, { method: 'PUT', body: JSON.stringify({ collectionId, collectionName }) }, A),
  bulkAssignCollection: () =>
    apiFetch<{ ok: boolean; assigned: number; staffCount: number; staff: string[] }>('/admin/bulk-assign-collection', { method: 'POST', body: '{}' }, A),
  getClientByCode:         (code: string) => apiFetch<{ type: 'subscriber' | 'lead'; data: AR }>(`/staff/client/${encodeURIComponent(code)}`, {}, A),
  enrollmentWelcome:       (payload: { email: string; name: string; courseTitle: string; branch: string; courseIds: string[]; phone?: string }) =>
    apiFetch<{ ok: boolean; newAccount: boolean }>('/staff/enrollment-welcome', { method: 'POST', body: JSON.stringify(payload) }, A),
  updateMyProfile:         (data: { name?: string; phone?: string; image?: string | null }) => apiFetch<AR>('/staff/me', { method: 'PATCH', body: JSON.stringify(data) }, A),
  listAllStaff:            ()             => apiFetch<AR[]>('/admin/staff', {}, A),
  listAllConsultations:    (limit = 500)  => apiFetch<AR[]>(`/admin/consultations?limit=${limit}`, {}, A),
  listAllExpenses:         ()             => apiFetch<AR[]>('/admin/expenses', {}, A),
  listActivityLogs:        (limit = 200)  => apiFetch<AR[]>(`/admin/activity-logs?limit=${limit}`, {}, A),
  listAllOrders:           (limit = 500)  => apiFetch<AR[]>(`/admin/orders?limit=${limit}`, {}, A),
  listAllDaqqiRounds:      ()             => apiFetch<AR[]>('/admin/daqqi-rounds', {}, A),
  listAllJoinUs:           ()             => apiFetch<AR[]>('/admin/join-us', {}, A),
  listAllContactMessages:  ()             => apiFetch<AR[]>('/admin/contact-messages', {}, A),
  listAllCertificateRequests: (limit = 500) => apiFetch<AR[]>(`/admin/certificate-requests?limit=${limit}`, {}, A),
  updateCertificateRequest: (id: string | number, status: string, notes?: string) =>
    patch(`/admin/certificate-requests/${id}`, { status, notes }),
  deleteCertificateRequest: (id: string | number) => del(`/admin/certificate-requests/${id}`),
  listAllInbox:            ()             => apiFetch<AR[]>('/admin/inbox', {}, A),
  listAllAutomationWorkflows: ()          => apiFetch<AR[]>('/admin/automation-workflows', {}, A),
  listAllQuizAttempts:     (limit = 500)  => apiFetch<AR[]>(`/admin/quiz-attempts?limit=${limit}`, {}, A),
  getSettings:             ()             => apiFetch<AR>('/admin/settings', {}, A),
  getContent:              ()             => apiFetch<AR>('/admin/content', {}, A),
  getDiscounts:            ()             => apiFetch<AR[]>('/admin/discounts', {}, A),
  getPayments:             (startDate?: string, endDate?: string) => {
    const p = new URLSearchParams();
    if (startDate) p.set('startDate', startDate);
    if (endDate)   p.set('endDate', endDate);
    return apiFetch<AR[]>(`/admin/payments?${p}`, {}, A);
  },

  // ── Courses ──
  saveCourse:    (o: AR) => post('/admin/courses', o),
  deleteCourse:  (id: string) => del(`/admin/courses/${id}`),

  // ── Bundles ──
  listAllBundles: (limit = 200) => apiFetch<AR[]>(`/admin/bundles?limit=${limit}`, {}, A),
  saveBundle:    (o: AR) => post('/admin/bundles', o),
  deleteBundle:  (id: string) => del(`/admin/bundles/${id}`),

  // ── Therapists ──
  saveTherapist:   (o: AR) => post('/admin/therapists', o),
  deleteTherapist: (id: string) => del(`/admin/therapists/${id}`),

  // ── Testimonials ──
  saveTestimonial:   (o: AR) => post('/admin/testimonials', o),
  deleteTestimonial: (id: string | number) => del(`/admin/testimonials/${id}`),

  // ── Subscribers ──
  saveSubscriber:   (o: AR) => post('/admin/subscribers', o),
  deleteSubscriber: (id: string) => del(`/admin/subscribers/${id}`),

  // ── Leads ──
  saveLead:   (o: AR) => post('/admin/leads', o),
  deleteLead: (id: string) => del(`/admin/leads/${id}`),
  getLeadTimeline: (id: string) => apiFetch<AR[]>(`/admin/leads/${id}/timeline`, {}, A),

  // ── Staff ──
  saveStaff:        (o: AR) => post('/admin/staff', o),
  deleteStaff:      (id: string) => del(`/admin/staff/${id}`),
  createStaffAccount: (o: AR) => post('/admin/staff-account', o),

  // ── Lectures ──
  saveLecture:   (o: AR) => post('/admin/lectures', o),
  deleteLecture: (id: string) => del(`/admin/lectures/${id}`),

  // ── Chapters ──
  saveChapter:   (o: AR) => post('/admin/chapters', o),
  deleteChapter: (id: string) => del(`/admin/chapters/${id}`),

  // ── Consultations ──
  saveConsultation:          (o: AR) => post('/admin/consultations', o),
  updateConsultationStatus:  (id: string, status: string, notes?: string, link?: string) =>
    patch(`/admin/consultations/${id}`, { status, notes, meeting_link: link }),
  deleteConsultation: (id: string) => del(`/admin/consultations/${id}`),

  // ── Orders ──
  saveOrder:         (o: AR) => post('/admin/orders', o),
  updateOrderStatus: (id: string, status: string) => patch(`/admin/orders/${id}`, { status }),
  deleteOrder:       (id: string) => del(`/admin/orders/${id}`),

  // ── Subscriber Payments (payments table) ──
  saveSubscriberPayment: (subscriber_id: string, payment: AR) => post('/admin/subscriber-payments', { subscriber_id, payment }),
  backfillPayments:      () => post('/admin/backfill-payments', {}),

  // ── Credentials (admin reset) ──
  updateSubscriberCredentials: (subscriberId: string, currentEmail: string, opts: { newEmail?: string; newPassword?: string }) =>
    apiFetch<{ ok: boolean }>(`/admin/subscribers/${subscriberId}/credentials`, { method: 'PUT', body: JSON.stringify({ currentEmail, ...opts }) }, A),

  // ── Enrollments ──
  addEnrollment: (subscriber_id: string, course_id: string | null, bundle_id: string | null, access_level: 'full' | 'limited', lecture_limit?: number) =>
    post('/admin/enrollments', { subscriber_id, course_id, bundle_id, access_level, lecture_limit }),
  updateEnrollmentAccess: (subscriber_id: string, course_id: string, access_level: 'full' | 'limited', lecture_limit?: number) =>
    post('/admin/enrollments', { subscriber_id, course_id, bundle_id: null, access_level, lecture_limit }),

  // ── Expenses ──
  saveExpense:   (o: AR) => post('/admin/expenses', o),
  updateExpense: (o: AR) => patch(`/admin/expenses/${o.id}`, o),
  deleteExpense: (id: string) => del(`/admin/expenses/${id}`),

  // ── Daqqi Rounds ──
  saveDaqqiRound:   (o: AR) => post('/admin/daqqi-rounds', o),
  deleteDaqqiRound: (id: string) => del(`/admin/daqqi-rounds/${id}`),

  // ── Join-Us applications ──
  updateJoinUs: (id: string, status: string, notes?: string) => patch(`/admin/join-us/${id}`, { status, notes }),
  deleteJoinUs: (id: string) => del(`/admin/join-us/${id}`),

  // ── Contact Messages ──
  updateContactMessage: (id: string, status: string) => patch(`/admin/contact-messages/${id}`, { status }),
  deleteContactMessage: (id: string) => del(`/admin/contact-messages/${id}`),

  // ── Community ──
  saveCommunityPost:          (o: AR) => post('/admin/community/posts', o),
  deleteCommunityPost:        (id: string) => del(`/admin/community/posts/${id}`),
  saveCommunityLibraryItem:   (o: AR) => post('/admin/community/library', o),
  deleteCommunityLibraryItem: (id: string) => del(`/admin/community/library/${id}`),
  saveCommunityVideo:         (o: AR) => post('/admin/community/videos', o),
  deleteCommunityVideo:       (id: string) => del(`/admin/community/videos/${id}`),
  saveCommunityEvent:         (o: AR) => post('/admin/community/events', o),
  deleteCommunityEvent:       (id: string) => del(`/admin/community/events/${id}`),

  // ── Quizzes ──
  saveQuiz:   (o: AR) => post('/admin/quizzes', o),
  deleteQuiz: (id: string) => del(`/admin/quizzes/${id}`),

  // ── Live Streams ──
  saveLiveStream:   (o: AR) => post('/admin/live-streams', o),
  deleteLiveStream: (id: string) => del(`/admin/live-streams/${id}`),

  // ── Automation Workflows ──
  saveAutomationWorkflow:   (o: AR) => post('/admin/automation-workflows', o),
  deleteAutomationWorkflow: (id: string) => del(`/admin/automation-workflows/${id}`),

  // ── Inbox ──
  saveInboxConversation:   (o: AR) => post('/admin/inbox', o),
  deleteInboxConversation: (id: string) => del(`/admin/inbox/${id}`),

  // ── Activity Logs ──
  logActivity: (log: AR) => post('/admin/activity-logs', log),

  // ── Settings / Content / Discounts / Notifications ──
  saveSettings:      (data: AR) => put('/admin/settings', data),
  saveContent:       (data: AR) => put('/admin/content', data),
  saveDiscounts:     (data: unknown[]) => put('/admin/discounts', data),
  saveNotifications: (data: unknown[]) => put('/admin/notifications', data),

  // ── Payment Proofs ──
  listPaymentProofs: (status?: 'PENDING' | 'APPROVED' | 'REJECTED') =>
    apiFetch<AR[]>(`/admin/payment-proofs${status ? '?status=' + status : ''}`, {}, A),
  getPaymentProofImage: (id: string) => apiFetch<{ image: string }>(`/admin/payment-proofs/${id}/image`, {}, A),
  reviewPaymentProof: (id: string, action: 'approve' | 'reject', reviewer_note?: string) =>
    apiFetch<{ ok: boolean; status: string }>(`/admin/payment-proofs/${id}`, { method: 'PATCH', body: JSON.stringify({ action, reviewer_note }) }, A),

  // ── Atomic client-code counter ──
  issueClientCode: () => apiFetch<{ ok: boolean; code: string }>('/admin/client-code', { method: 'POST', body: '{}' }, A),
  /** Delete subscribers + hide leads whose email matches any staff/admin member */
  cleanupStaffSubscribers: () =>
    apiFetch<{ ok: boolean; deleted: number; hidden: number; emails: string[] }>(
      '/admin/cleanup-staff-subscribers', { method: 'POST', body: '{}' }, A
    ),
  /** Fix auto-created ghost subscribers: remove empties, merge duplicates, assign codes, fix branch */
  fixAutoSubscribers: () =>
    apiFetch<{ ok: boolean; deleted: number; merged: number; coded: number; branchFixed: number }>(
      '/admin/fix-auto-subscribers', { method: 'POST', body: '{}' }, A
    ),
  /** Comprehensive fix: assign missing codes, merge phone-duplicate leads, merge email-duplicate subscribers, fix cross-table duplicate codes */
  fixAllCodes: () =>
    apiFetch<{ ok: boolean; assigned_leads: number; assigned_subs: number; merged_leads: number; merged_subs: number; dup_codes_fixed: number }>(
      '/admin/fix-all-codes', { method: 'POST', body: '{}' }, A
    ),
  /** Assign codes from the MySQL counter to ALL leads/subscribers that are missing a valid code.
   *  Server handles atomicity — never generates codes locally. */
  bulkAssignClientCodes: () =>
    apiFetch<{ ok: boolean; assigned: number; nextCounter?: number; message?: string }>(
      '/admin/bulk-assign-client-codes', { method: 'POST', body: '{}' }, A
    ),
  /** Fast-forward the MySQL counter to MAX existing code + 1 */
  syncClientCodeCounter: () =>
    apiFetch<{ ok: boolean; maxExisting: number; counterNow: number }>(
      '/admin/sync-client-code-counter', { method: 'POST', body: '{}' }, A
    ),

  // ── Leads: bulk CSV import ──
  importLeads: (leads: AR[]) =>
    apiFetch<{ ok: boolean; imported: number; skipped: number; errors: string[] }>(
      '/admin/leads/import', { method: 'POST', body: JSON.stringify({ leads }) }, A
    ),

  // ── Leads: round-robin distribute to sales reps ──
  distributeLeads: (mode: 'unassigned' | 'all' = 'unassigned') =>
    apiFetch<{ ok: boolean; assigned: number; reps?: number }>(
      '/admin/leads/distribute', { method: 'POST', body: JSON.stringify({ mode }) }, A
    ),

  // ── CRM Settings (sources, auto-assign, google sheets) ──
  getCrmSettings: () => apiFetch<Record<string, unknown>>('/admin/crm-settings', {}, A),
  saveCrmSettings: (data: Record<string, unknown>) =>
    apiFetch<{ ok: boolean }>('/admin/crm-settings', { method: 'PUT', body: JSON.stringify(data) }, A),
  syncGoogleSheet: (sheetId: string, gid: string, autoAssign: string) =>
    apiFetch<{ ok: boolean; imported: number; skipped: number; total: number; message?: string }>(
      '/admin/leads/gsheet-sync', { method: 'POST', body: JSON.stringify({ sheetId, gid, autoAssign }) }, A
    ),
  testGoogleSheet: (sheetId: string, gid: string) =>
    apiFetch<{ ok: boolean; accessible: boolean; rows?: number; headers?: string[]; reason?: string; hint?: string }>(
      '/admin/leads/gsheet-test', { method: 'POST', body: JSON.stringify({ sheetId, gid }) }, A
    ),
  syncAllSheets: () =>
    apiFetch<{ ok: boolean; imported: number; skipped: number }>(
      '/admin/leads/gsheet-sync-all', { method: 'POST', body: '{}' }, A
    ),

  // ── WhatsApp ──
  sendWhatsAppBulk: (phones: string[], message: string) =>
    apiFetch<{ ok: boolean; sent: number; failed: number; errors: { phone: string; reason: string }[] }>(
      '/admin/whatsapp-bulk', { method: 'POST', body: JSON.stringify({ phones, message }) }, A
    ),
  sendWhatsApp: (phone: string, message: string) =>
    apiFetch<{ ok: boolean }>('/admin/whatsapp-send', { method: 'POST', body: JSON.stringify({ phone, message }) }, A),
  getWhatsAppConfig: () => apiFetch<{ instanceId: string; hasToken: boolean }>('/admin/whatsapp-config', {}, A),
  saveWhatsAppConfig: (instanceId: string, apiToken: string) =>
    put('/admin/whatsapp-config', { instanceId, apiToken }),

  getFbLeadConfig: () => apiFetch<Record<string, unknown>>('/admin/facebook-lead-ads-config', {}, A),
  saveFbLeadConfig: (cfg: Record<string, unknown>) =>
    apiFetch<{ ok: boolean }>('/admin/facebook-lead-ads-config', { method: 'PUT', body: JSON.stringify(cfg) }, A),

  // ── WhatsApp rep proxy (per-rep personal WA instances) ──
  waProxyChats: (instanceId: string, apiToken: string) =>
    apiFetch<unknown[]>('/admin/whatsapp-proxy/chats', { method: 'POST', body: JSON.stringify({ instanceId, apiToken }) }, A),
  waProxyChatHistory: (instanceId: string, apiToken: string, chatId: string, count = 30) =>
    apiFetch<unknown[]>('/admin/whatsapp-proxy/history', { method: 'POST', body: JSON.stringify({ instanceId, apiToken, chatId, count }) }, A),
  waProxySend: (instanceId: string, apiToken: string, phone: string, message: string) =>
    apiFetch<{ ok: boolean; idMessage?: string }>('/admin/whatsapp-proxy/send', { method: 'POST', body: JSON.stringify({ instanceId, apiToken, phone, message }) }, A),

  // ── Refresh Token ──
  refreshToken: () => apiFetch<{ ok: boolean }>('/auth/refresh', { method: 'POST', body: '{}' }, A),

  // ── Promo Codes ──
  listPromoCodes: () => apiFetch<AR[]>('/admin/promo-codes', {}, A),
  createPromoCode: (data: AR) => apiFetch<{ ok: boolean; id: string }>('/admin/promo-codes', { method: 'POST', body: JSON.stringify(data) }, A),
  updatePromoCode: (id: string, data: AR) => apiFetch<{ ok: boolean }>(`/admin/promo-codes/${id}`, { method: 'PATCH', body: JSON.stringify(data) }, A),
  deletePromoCode: (id: string) => apiFetch<{ ok: boolean }>(`/admin/promo-codes/${id}`, { method: 'DELETE' }, A),

  // ── Notifications ──
  getNotifications: () => apiFetch<{ rows: AR[]; unread: number }>('/admin/notifications', {}, A),
  markAllNotificationsRead: () => apiFetch<{ ok: boolean }>('/admin/notifications/read-all', { method: 'PATCH', body: '{}' }, A),
  markNotificationRead: (id: string) => apiFetch<{ ok: boolean }>(`/admin/notifications/${id}/read`, { method: 'PATCH', body: '{}' }, A),

  // ── Content analytics ──
  getLessonAnalytics: (courseId: string) => apiFetch<AR[]>(`/admin/lesson-analytics/${encodeURIComponent(courseId)}`, {}, A),

  // ── Referrals ──
  listReferrals: () => apiFetch<AR[]>('/admin/referrals', {}, A),
};

// ── Public forms ──────────────────────────────────────────────────────────────
export const mysqlForms = {
  submitContact: (data: AR) => apiFetch<{ ok: boolean; id: string }>('/contact', { method: 'POST', body: JSON.stringify(data) }),
  submitJoinUs: (data: AR) => apiFetch<{ ok: boolean; id: string }>('/join-us', { method: 'POST', body: JSON.stringify(data) }),
  submitRegistration: (data: AR) => apiFetch<{ ok: boolean; id: string; clientCode: string }>('/registrations', { method: 'POST', body: JSON.stringify(data) }),
  submitLead: (data: AR) => apiFetch<{ ok: boolean; id?: string }>('/leads-public', { method: 'POST', body: JSON.stringify(data) }),
};

// ── Paymob payment helpers (gateway suspended — manual payment flow) ─────────
export const mysqlPaymob = {
  /** Reserve order in DB for manual payment tracking */
  reserveOrder: (data: AR) =>
    apiFetch<{ ok: boolean }>('/orders/reserve', { method: 'POST', body: JSON.stringify(data) }),
  /** Paymob gateway suspended — always throws */
  verifyPayment: (_params: Record<string, string>): Promise<never> => {
    return Promise.reject(new Error('بوابة الدفع الإلكتروني غير متاحة حالياً — يرجى التواصل معنا عبر واتساب لإتمام الدفع.'));
  },
};

// ── Custom Auth ───────────────────────────────────────────────────────────────
export const mysqlAuth = {
  login: (email: string, password: string) =>
    apiFetch<{
      ok: boolean;      user?: AuthUser;
      totpRequired?: boolean;
      pendingToken?: string;
    }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (data: { email: string; password: string; name?: string; phone?: string; country?: string; interest?: string; ref?: string }) =>
    apiFetch<{ ok: boolean; user: AuthUser }>('/user/signup', { method: 'POST', body: JSON.stringify(data) }, true),
  me: () => apiFetch<AuthUser>('/auth/me', {}, true),
  updateProfile: (name?: string, nameEn?: string) =>
    apiFetch<{ ok: boolean }>('/auth/update-profile', { method: 'PUT', body: JSON.stringify({ name, nameEn }) }, true),
  updatePassword: (currentPassword: string, newPassword: string) =>
    apiFetch<{ ok: boolean }>('/auth/update-password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) }, true),
  resetPassword: (resetToken: string, newPassword: string) =>
    apiFetch<{ ok: boolean }>('/auth/reset-password', { method: 'POST', body: JSON.stringify({ resetToken, newPassword }) }),
  updateSubscriberCredentials: (subscriberId: string, currentEmail: string, opts: { newEmail?: string; newPassword?: string }) =>
    apiFetch<{ ok: boolean }>(`/admin/subscribers/${subscriberId}/credentials`, { method: 'PUT', body: JSON.stringify({ currentEmail, ...opts }) }, true),
  forgotPassword: (email: string) =>
    apiFetch<{ ok: boolean }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  verifyOtp: (email: string, code: string) =>
    apiFetch<{ ok: boolean; resetToken: string }>('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email, code }) }),
  // WhatsApp sign-in. requestWaOtp always resolves ok:true even for an unknown
  // number — the API deliberately won't reveal which numbers have accounts.
  requestWaOtp: (phone: string) =>
    apiFetch<{ ok: boolean; expiresInMinutes: number }>('/auth/whatsapp/request-otp', { method: 'POST', body: JSON.stringify({ phone }) }),
  /**
   * Verifying a code both signs in and registers: a number with no account gets
   * one here. `name` is used only when the account is being created, so a
   * returning customer can never be renamed by a stale form value.
   * `created` says which of the two just happened.
   */
  verifyWaOtp: (phone: string, code: string, name?: string) =>
    apiFetch<{
      ok: boolean; created: boolean;
      user: { uid: string; email: string; displayName: string; phone: string };
    }>('/auth/whatsapp/verify-otp', { method: 'POST', body: JSON.stringify({ phone, code, name }) }),
  verify2fa: (pendingToken: string, token: string) =>
    apiFetch<{ ok: boolean }>('/auth/2fa/verify', { method: 'POST', body: JSON.stringify({ pendingToken, token }) }),
  logout: () => { localStorage.removeItem('mahad-token'); apiFetch<{ ok: boolean }>('/auth/logout', { method: 'POST' }).catch(() => {}); },
  refreshToken: () => apiFetch<{ ok: boolean }>('/auth/refresh', { method: 'POST', body: '{}' }, true),
};

export async function checkApiHealth(): Promise<boolean> {
  try { return (await fetch(`${API_BASE}/health`)).ok; }
  catch { return false; }
}
