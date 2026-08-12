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

// Was unbounded (no timeout at all — a stuck connection hung forever) with up to
// 2 retries and 3-5s backoff between each. Admin loads the heaviest pages (full
// leads/subscribers tables), so this compounded worst — added a bound + shortened
// the retry storm the same way as the client (see client/lib/mysqlapi.ts).
const REQUEST_TIMEOUT_MS = 15_000; // admin payloads are larger than client's, allow more
const MAX_RETRIES = 1;
const RETRY_BACKOFF_MS = 1_000;

async function apiFetch<T>(path: string, options: RequestInit = {}, auth = false, _retry = 0): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (auth) { const t = getToken(); if (t) headers['Authorization'] = `Bearer ${t}`; }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include', cache: 'no-store', signal: controller.signal });
    clearTimeout(timeoutId);
    // Auto-retry on 502/503/504 (server restarting) — 1 extra attempt only.
    if ((res.status === 502 || res.status === 503 || res.status === 504) && _retry < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS));
      return apiFetch<T>(path, options, auth, _retry + 1);
    }
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `HTTP ${res.status}`); }
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

type AR = Record<string, unknown>;

// ── Public catalog ────────────────────────────────────────────────────────────
export const mysqlCatalog = {
  listCourses: (limit = 500, offset = 0) => apiFetch<AR[]>(`/courses?limit=${limit}&offset=${offset}`),
  listBundles: (limit = 200) => apiFetch<AR[]>(`/bundles?limit=${limit}`),
  listLectures: (limit = 5000, offset = 0) => apiFetch<AR[]>(`/lectures?limit=${limit}&offset=${offset}`),
  listChapters: (limit = 1000) => apiFetch<AR[]>(`/chapters?limit=${limit}`),
  listTherapists: (limit = 100) => apiFetch<AR[]>(`/therapists?limit=${limit}`),
  listTestimonials: () => apiFetch<AR[]>('/testimonials'),
  // Authenticated admin endpoint (not the public /quizzes listing) — the public
  // one strips correctIndex (LMS-05), which the editor needs to display/edit.
  listQuizzes: (limit = 200) => apiFetch<AR[]>(`/admin/quizzes?limit=${limit}`, {}, true),
  listLiveStreams: (limit = 200) => apiFetch<AR[]>(`/live-streams?limit=${limit}`),
  // Admin loads ALL posts (incl. pending/rejected) from the moderation endpoint so they can be reviewed.
  listCommunityPosts: () => apiFetch<AR[]>('/admin/community/posts', {}, true),
  listCommunityLibrary: () => apiFetch<AR[]>('/community/library'),
  listCommunityVideos: () => apiFetch<AR[]>('/community/videos'),
  listCommunityEvents: () => apiFetch<AR[]>('/community/events'),
};

// ── Non-admin (client) ────────────────────────────────────────────────────────
export const mysqlClient = {
  heartbeat: (name?: string) => apiFetch<{ ok: boolean }>('/me/heartbeat', { method: 'POST', body: JSON.stringify({ name: name || '' }) }, true),
  getMySubscriber: () => apiFetch<AR | null>('/me/subscriber', {}, true),
  getMyConsultations: () => apiFetch<AR[]>('/me/consultations', {}, true),
  getMyQuizAttempts: () => apiFetch<AR[]>('/me/quiz-attempts', {}, true),
  checkIsStaff: () => apiFetch<{ isStaff: boolean; isAdmin: boolean; role?: string; staffId?: string }>('/me/is-staff', {}, true),
  getStaffSelf: () => apiFetch<AR>('/staff/me', {}, true),
  getTherapistPortal: () => apiFetch<{ therapist: AR; consultations: AR[] }>('/staff/therapist-portal', {}, true),
  updateTherapistConsultation: (id: string, patch: { status?: string; notes?: string }) =>
    apiFetch<{ ok: boolean }>(`/staff/therapist-portal/consultations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }, true),
  saveLectureProgress: (lectureId: string, pct: number) =>
    apiFetch<{ ok: boolean }>('/me/progress', { method: 'PATCH', body: JSON.stringify({ lectureId, pct }) }, true),
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
  // Lecture view tracking
  trackLectureView: (lectureId: string) =>
    apiFetch<{ ok: boolean }>(`/lectures/${encodeURIComponent(lectureId)}/view`, { method: 'POST' }, true),
  // Course completions / digital certificates
  getMyCompletions: () => apiFetch<AR[]>('/me/completions', {}, true),
  verifyCertificate: (code: string) => apiFetch<AR>(`/completions/verify/${encodeURIComponent(code)}`),
  // Referral
  getMyReferralCode: () => apiFetch<{ code: string; uses: number; earnings: number }>('/referral/my-code', {}, true),
};

// ── Messaging channels ────────────────────────────────────────────────────────
export type MessagingChannelKind = 'whatsapp' | 'messenger';
export type MessagingChannelStatus = 'pending' | 'connected' | 'disconnected' | 'error';

export interface RegistrationItem {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  created_at: string;
  /** 'محلي' (Egyptian mobile) | 'دولي' (kept its own country code) | null (no usable phone) */
  origin: 'محلي' | 'دولي' | null;
}

export interface MessagingChannel {
  id: string;
  kind: MessagingChannelKind;
  provider: 'meta' | 'green-api' | 'wapilot' | 'messenger';
  /** null = the company's own channel; otherwise the employee who owns it */
  owner_staff_id: string | null;
  ownerName?: string | null;
  label: string;
  display_number: string | null;
  status: MessagingChannelStatus;
  last_verified_at: string | null;
  last_error: string | null;
  is_default: 0 | 1;
  is_active: 0 | 1;
  daily_send_limit: number;
  sent_today: number;
  sent_today_date: string | null;
  isConnected: boolean;
  /** Whether credentials are stored — never what they are. */
  hasCredentials: boolean;
}

export interface WapilotInstance {
  uniqueName: string;
  name: string;
  status: string;
  number: string | null;
  displayName: string | null;
  subscriptionStatus: string | null;
  /** A lapsed subscription stops delivery while the session still reports WORKING. */
  subscriptionEndsAt: string | null;
}

export interface MessagingChannelInput {
  kind: MessagingChannelKind;
  provider: string;
  label: string;
  displayNumber?: string;
  credentials?: Record<string, string>;
  ownerStaffId?: string | null;
  dailySendLimit?: number;
  makeDefault?: boolean;
}

export interface WhatsappCampaign {
  id: string;
  name: string;
  message_template: string;
  channel_id: string | null;
  audience: 'leads' | 'subscribers' | 'all' | 'manual' | 'segment';
  audience_filter: Record<string, unknown>;
  throttle_per_minute: number;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled';
  scheduled_at: string | null;
  sent_at: string | null;
  recipient_count: number;
  sent_count: number;
  fail_count: number;
  skipped_count: number;
  variables?: string[];
  created_at: string;
}

export interface WhatsappCampaignInput {
  name: string;
  messageTemplate: string;
  audience?: WhatsappCampaign['audience'];
  audienceFilter?: Record<string, unknown>;
  channelId?: string | null;
  throttlePerMinute?: number;
  scheduledAt?: string | null;
}

export interface WhatsappCampaignPreview {
  recipientCount: number;
  skippedCount: number;
  capReached: boolean;
  estimatedMinutes: number;
  samples: { name: string | null; phone: string; message: string }[];
  skipReasons: { name: string | null; phone: string; reason: string }[];
}

export interface WhatsappCampaignRecipient {
  id: string;
  subject_type: 'lead' | 'subscriber' | 'manual';
  phone: string;
  name: string | null;
  status: 'queued' | 'sent' | 'failed' | 'skipped';
  skip_reason: string | null;
  delivery_status: string | null;
  provider_status: string | null;
  last_error: string | null;
}

// ── Shared inbox ──────────────────────────────────────────────────────────────
export interface InboxConversation {
  lead_id: string | null;
  subscriber_id: string | null;
  name: string | null;
  phone: string | null;
  psid: string | null;
  last_at: string;
  last_message: string | null;
  last_direction: 'IN' | 'OUT';
  inbound_count: number;
  /** false once 24h have passed since the customer last wrote — Meta rejects plain text after that */
  messengerWindowOpen: boolean;
}

export interface InboxMessage {
  id: string;
  type: 'WHATSAPP' | 'MESSENGER' | string;
  direction: 'IN' | 'OUT';
  date: string;
  notes: string;
  staff_name: string | null;
  channel_label: string | null;
}

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
  adminPut: <T = AR>(path: string, body: unknown) => apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) }, A),
  adminDelete: <T = AR>(path: string) => apiFetch<T>(path, { method: 'DELETE' }, A),
  revokeCourseCompletion: (id: string, reason: string) =>
    apiFetch<AR>(`/admin/completions/${encodeURIComponent(id)}/revoke`, {
      method: 'POST', body: JSON.stringify({ reason }),
    }, A),
  reissueCourseCompletion: (id: string, reason: string) =>
    apiFetch<AR>(`/admin/completions/${encodeURIComponent(id)}/reissue`, {
      method: 'POST', body: JSON.stringify({ reason }),
    }, A),
  // ── Users management ──
  listAllUsers:  () => apiFetch<AR[]>('/admin/users', {}, A),
  deactivateUser: (id: string) => apiFetch<{ ok: boolean }>(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }, A),
  checkAccount: (email: string) => apiFetch<AR>(`/admin/check-account?email=${encodeURIComponent(email)}`, {}, A),
  createAccount: (params: { email: string; name?: string; password?: string; phone?: string; courses?: {courseId:string;accessType:string;videoCount?:string}[]; referredBy?: string; firstPayment?: { amount: number; currency: string; paymentMethod?: string; date?: string; transactionId?: string; note?: string; courseId?: string; courseExpected?: number } }) => apiFetch<AR>('/admin/create-account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) }, A),
  getMissingAccountsCount: () => apiFetch<{ total: number }>('/admin/missing-accounts', {}, A),
  bulkCreateAccounts: (limit: number) => apiFetch<AR>('/admin/bulk-create-accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit }) }, A),
  // ── List (read) ──
  listAllCourses:          (limit = 500)  => apiFetch<AR[]>(`/admin/courses?limit=${limit}`, {}, A),
  getOnlineUsers:          ()             => apiFetch<AR[]>('/admin/online-users', {}, A),
  listAllTherapists:       ()             => apiFetch<AR[]>('/admin/therapists', {}, A),
  listSubscribersPage:     (limit = 500, offset = 0, opts?: { q?: string; status?: string }) =>
    apiFetch<AR[]>(`/admin/subscribers?limit=${limit}&offset=${offset}${opts?.q ? `&q=${encodeURIComponent(opts.q)}` : ''}${opts?.status ? `&status=${encodeURIComponent(opts.status)}` : ''}`, {}, A),
  listLeadsPage:           (limit = 500, offset = 0, opts?: { q?: string; status?: string }) =>
    apiFetch<AR[]>(`/admin/leads?limit=${limit}&offset=${offset}${opts?.q ? `&q=${encodeURIComponent(opts.q)}` : ''}${opts?.status ? `&status=${encodeURIComponent(opts.status)}` : ''}`, {}, A),
  // pageSize=5000 matches the server's parseLimit(...,500,5000) hard cap on both
  // endpoints — the largest page the server will ever actually return. At the
  // real prod scale (1164 subscribers, 13173 leads) this cuts the sequential
  // round-trips needed to load everything from 1/7 down to 1/3, since each
  // request already gets the maximum the server allows instead of an arbitrary
  // smaller 2000 that forced extra round trips for no benefit.
  // maxRows caps how much the browser will hold. The default (50k) is far above
  // real prod scale today, so every caller loads everything exactly as before;
  // it only engages at 100k+ to stop the client from trying to buffer the whole
  // table into memory and freezing — past the cap the list/search run
  // server-side and top-line counts come from the /stats aggregate endpoint.
  listAllSubscribers:      async (pageSize = 5000, maxRows = 50000): Promise<AR[]> => {
    const all: AR[] = [];
    let offset = 0;
    while (all.length < maxRows) {
      const page = await apiFetch<AR[]>(`/admin/subscribers?limit=${pageSize}&offset=${offset}`, {}, A);
      all.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    return Number.isFinite(maxRows) ? all.slice(0, maxRows) : all;
  },
  listAllLeads:            async (pageSize = 5000, maxRows = 50000): Promise<AR[]> => {
    const all: AR[] = [];
    let offset = 0;
    while (all.length < maxRows) {
      const page = await apiFetch<AR[]>(`/admin/leads?limit=${pageSize}&offset=${offset}`, {}, A);
      all.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    return Number.isFinite(maxRows) ? all.slice(0, maxRows) : all;
  },
  // Server-side pipeline/KPI aggregates — the whole leads table summarised in one
  // query, so the CRM shows correct counts without loading every row.
  getLeadStats:            (): Promise<{ total: number; byStatus: Record<string, number>; assigned: number; unassigned: number; totalDealValue: number }> =>
    apiFetch(`/admin/leads/stats`, {}, A),
  // Unified endpoint — server auto-scopes by role (replaces my-subscribers / my-collection-clients / my-daqqi-clients)
  listStaffSubscribers:    async (pageSize = 2000): Promise<AR[]> => {
    const all: AR[] = [];
    let offset = 0;
    while (true) {
      const page = await apiFetch<AR[]>(`/staff/subscribers?limit=${pageSize}&offset=${offset}`, {}, A);
      all.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    return all;
  },
  listStaffLeads:          async (pageSize = 2000): Promise<AR[]> => {
    const all: AR[] = [];
    let offset = 0;
    while (true) {
      const page = await apiFetch<AR[]>(`/staff/leads?limit=${pageSize}&offset=${offset}`, {}, A);
      all.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    return all;
  },
  // Legacy kept for backwards compatibility — redirect to unified
  listMySubscribers:       () => apiFetch<AR[]>('/staff/subscribers', {}, A),
  listMyCollectionClients: () => apiFetch<AR[]>('/staff/subscribers', {}, A),
  listMyDaqqiClients:      () => apiFetch<AR[]>('/staff/subscribers', {}, A),
  assignSubscriberCollection: (subId: string, collectionId: string | null, collectionName: string | null) =>
    apiFetch<AR>(`/admin/subscribers/${subId}/assign-collection`, { method: 'PUT', body: JSON.stringify({ collectionId, collectionName }) }, A),
  bulkAssignCollection: () =>
    apiFetch<{ ok: boolean; assigned: number; staffCount: number; staff: string[] }>('/admin/bulk-assign-collection', { method: 'POST', body: '{}' }, A),
  getClientByCode:         (code: string) => apiFetch<{ type: 'subscriber' | 'lead'; data: AR }>(`/staff/client/${encodeURIComponent(code)}`, {}, A),
  getCustomerTimeline:     (subscriberId: string) => apiFetch<AR[]>(`/staff/subscribers/${encodeURIComponent(subscriberId)}/timeline`, {}, A),
  enrollmentWelcome:       (payload: { email: string; name: string; courseTitle: string; branch: string; courseIds: string[]; phone?: string }) =>
    apiFetch<{ ok: boolean; newAccount: boolean }>('/staff/enrollment-welcome', { method: 'POST', body: JSON.stringify(payload) }, A),
  updateMyProfile:         (data: { name?: string; phone?: string; image?: string | null }) => apiFetch<AR>('/staff/me', { method: 'PATCH', body: JSON.stringify(data) }, A),
  getMyPreferences:        ()             => apiFetch<{ waNumber?: string; waTemplates?: { id: string; title: string; body: string }[]; customTags?: string[] }>('/staff/me/preferences', {}, A),
  saveMyPreferences:       (data: { waNumber?: string; waTemplates?: { id: string; title: string; body: string }[]; customTags?: string[] }) => apiFetch<AR>('/staff/me/preferences', { method: 'PUT', body: JSON.stringify(data) }, A),
  // ── Messaging channels: who a message is sent from ────────────────────────
  // Credentials go up but never come back down — the API returns hasCredentials,
  // never the values, so a compromised admin session cannot read a rep's token.
  listMessagingChannels:   (kind?: MessagingChannelKind) =>
    apiFetch<MessagingChannel[]>(`/admin/messaging/channels${kind ? `?kind=${kind}` : ''}`, {}, A),
  createMessagingChannel:  (data: MessagingChannelInput) =>
    apiFetch<MessagingChannel>('/admin/messaging/channels', { method: 'POST', body: JSON.stringify(data) }, A),
  updateMessagingChannel:  (id: string, data: Partial<MessagingChannelInput> & { isActive?: boolean }) =>
    apiFetch<MessagingChannel>(`/admin/messaging/channels/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) }, A),
  setDefaultMessagingChannel: (id: string) =>
    apiFetch<MessagingChannel>(`/admin/messaging/channels/${encodeURIComponent(id)}/default`, { method: 'POST' }, A),
  deleteMessagingChannel:  (id: string) =>
    apiFetch<AR>(`/admin/messaging/channels/${encodeURIComponent(id)}`, { method: 'DELETE' }, A),
  listWapilotInstances:    (apiKey: string) =>
    apiFetch<{ ok: boolean; instances: WapilotInstance[] }>("/admin/messaging/wapilot/instances", { method: "POST", body: JSON.stringify({ apiKey }) }, A),
  testMessagingChannel:    (id: string, to?: string, message?: string) =>
    apiFetch<{ ok: boolean; messageId?: string }>(`/messaging/channels/${encodeURIComponent(id)}/test`, { method: 'POST', body: JSON.stringify({ to, message }) }, A),

  getMyWhatsappChannel:    ()             => apiFetch<MessagingChannel | null>('/staff/me/whatsapp-channel', {}, A),
  saveMyWhatsappChannel:   (data: { provider?: string; label?: string; displayNumber?: string; credentials: Record<string, string> }) =>
    apiFetch<MessagingChannel>('/staff/me/whatsapp-channel', { method: 'PUT', body: JSON.stringify(data) }, A),
  deleteMyWhatsappChannel: ()             => apiFetch<AR>('/staff/me/whatsapp-channel', { method: 'DELETE' }, A),

  // ── التسجيلات (self-registered, not yet a lead or an online client) ──────
  listRegistrations:       ()             => apiFetch<RegistrationItem[]>('/admin/registrations', {}, A),
  convertRegistrationToOnline: (userId: string, branch?: string) =>
    apiFetch<{ ok: boolean; subscriberId: string }>(`/admin/registrations/${encodeURIComponent(userId)}/convert-online`, { method: 'POST', body: JSON.stringify({ branch }) }, A),
  convertRegistrationToLead: (userId: string, branch?: string) =>
    apiFetch<{ ok: boolean; leadId: string }>(`/admin/registrations/${encodeURIComponent(userId)}/convert-lead`, { method: 'POST', body: JSON.stringify({ branch }) }, A),
  deleteRegistration: (userId: string) =>
    apiFetch<AR>(`/admin/registrations/${encodeURIComponent(userId)}`, { method: 'DELETE' }, A),

  // ── WhatsApp campaigns ────────────────────────────────────────────────────
  listWhatsappCampaigns:   ()             => apiFetch<WhatsappCampaign[]>('/admin/whatsapp-campaigns', {}, A),
  createWhatsappCampaign:  (data: WhatsappCampaignInput) =>
    apiFetch<WhatsappCampaign>('/admin/whatsapp-campaigns', { method: 'POST', body: JSON.stringify(data) }, A),
  updateWhatsappCampaign:  (id: string, data: Partial<WhatsappCampaignInput>) =>
    apiFetch<WhatsappCampaign>(`/admin/whatsapp-campaigns/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) }, A),
  deleteWhatsappCampaign:  (id: string) =>
    apiFetch<AR>(`/admin/whatsapp-campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' }, A),
  previewWhatsappCampaign: (id: string) =>
    apiFetch<WhatsappCampaignPreview>(`/admin/whatsapp-campaigns/${encodeURIComponent(id)}/preview`, { method: 'POST' }, A),
  sendWhatsappCampaign:    (id: string) =>
    apiFetch<{ ok: boolean; queued: number; skipped: number; estimatedMinutes: number; scheduled: boolean; startsAt: string | null }>(`/admin/whatsapp-campaigns/${encodeURIComponent(id)}/send`, { method: 'POST' }, A),
  cancelWhatsappCampaign:  (id: string) =>
    apiFetch<{ ok: boolean; stopped: number }>(`/admin/whatsapp-campaigns/${encodeURIComponent(id)}/cancel`, { method: 'POST' }, A),
  whatsappCampaignRecipients: (id: string) =>
    apiFetch<WhatsappCampaignRecipient[]>(`/admin/whatsapp-campaigns/${encodeURIComponent(id)}/recipients`, {}, A),

  // ── Shared inbox ──────────────────────────────────────────────────────────
  listInboxConversations: (unansweredOnly = false) =>
    apiFetch<InboxConversation[]>(`/admin/messaging/inbox${unansweredOnly ? "?unanswered=1" : ""}`, {}, A),
  getInboxThread:          (key: { leadId?: string; subscriberId?: string }) =>
    apiFetch<InboxMessage[]>(`/admin/messaging/inbox/thread?${key.leadId ? `leadId=${encodeURIComponent(key.leadId)}` : `subscriberId=${encodeURIComponent(key.subscriberId || "")}`}`, {}, A),
  replyInThread:           (data: { leadId?: string; subscriberId?: string; message: string; via?: "whatsapp" | "messenger" }) =>
    apiFetch<{ ok: boolean; id: string; channelId: string | null }>("/admin/messaging/inbox/reply", { method: "POST", body: JSON.stringify(data) }, A),
  linkMessengerToLead:     (leadId: string, psid: string) =>
    apiFetch<{ ok: boolean; adopted: number }>("/admin/messaging/inbox/link-messenger", { method: "POST", body: JSON.stringify({ leadId, psid }) }, A),

  listAllStaff:            ()             => apiFetch<AR[]>('/admin/staff', {}, A),
  listAllConsultations:    (limit = 500)  => apiFetch<AR[]>(`/admin/consultations?limit=${limit}`, {}, A),
  listAllExpenses:         ()             => apiFetch<AR[]>('/admin/expenses', {}, A),
  listActivityLogs:        (limit = 200)  => apiFetch<AR[]>(`/admin/activity-logs?limit=${limit}`, {}, A),
  listAllOrders:           (limit = 500)  => apiFetch<AR[]>(`/admin/orders?limit=${limit}`, {}, A),
  listAbandonedCheckouts:  (hours = 2)     => apiFetch<AR[]>(`/admin/abandoned-checkouts?hours=${hours}`, {}, A),
  runAbandonedCheckout:    (hours = 24, limit = 100) => apiFetch<{ ok: boolean; scanned: number; sent: number; failed: number; skipped: number }>('/admin/automation/abandoned-checkout/run', { method: 'POST', body: JSON.stringify({ hours, limit }) }, A),
  smartRouteLeads:         (mode: 'all' | 'unassigned' = 'unassigned', limit = 100) => apiFetch<{ ok: boolean; assigned: number; reps: number }>('/admin/crm/leads/smart-route', { method: 'POST', body: JSON.stringify({ mode, limit }) }, A),
  getPushPublicKey:        ()              => apiFetch<{ ok: boolean; enabled: boolean; publicKey: string | null }>('/push/vapid-public-key'),
  saveDokkiClassroom:      (body: AR)       => post('/admin/dokki/classrooms', body),
  bookDokkiClassroom:      (body: AR)       => post('/admin/dokki/classrooms/book', body),
  checkinDokkiStudent:     (code: string)   => post('/admin/dokki/checkins', { code }),
  saveDokkiInventoryItem:  (body: AR)       => post('/admin/dokki/inventory/items', body),
  postDokkiInventoryTransaction: (body: AR) => post('/admin/dokki/inventory/transactions', body),
  getSubscriberLoyalty:    (id: string)     => apiFetch<AR>(`/admin/subscribers/${encodeURIComponent(id)}/loyalty`, {}, A),
  awardSubscriberLoyalty:  (id: string, points: number, reason: string) => apiFetch<{ ok: boolean; balance: number }>(`/admin/subscribers/${encodeURIComponent(id)}/loyalty/award`, { method: 'POST', body: JSON.stringify({ points, reason }) }, A),
  redeemSubscriberLoyalty: (id: string, points: number, reason: string) => apiFetch<{ ok: boolean; balance: number }>(`/admin/subscribers/${encodeURIComponent(id)}/loyalty/redeem`, { method: 'POST', body: JSON.stringify({ points, reason }) }, A),
  listAllDaqqiRounds:      ()             => apiFetch<AR[]>('/admin/daqqi-rounds', {}, A),
  listAllJoinUs:           ()             => apiFetch<AR[]>('/admin/join-us', {}, A),
  listAllContactMessages:  ()             => apiFetch<AR[]>('/admin/contact-messages', {}, A),
  listAllCertificateRequests: (limit = 500) => apiFetch<AR[]>(`/admin/certificate-requests?limit=${limit}`, {}, A),
  createCertificateRequest: (body: AR) => post('/admin/certificate-requests', body),
  updateCertificateRequest: (id: string | number, status: string, notes?: string) =>
    patch(`/admin/certificate-requests/${id}`, { status, notes }),
  deleteCertificateRequest: (id: string | number) => del(`/admin/certificate-requests/${id}`),
  getFinancialPnl: (from: string, to: string, branch?: string) =>
    apiFetch<{ from: string; to: string; branch: string | null; branchId: string | null; totalRevenue: number; totalExpenses: number; netProfit: number; margin: number }>(
      `/admin/financial/pnl?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${branch ? `&branch=${encodeURIComponent(branch)}` : ''}`,
      {},
      A,
    ),
  getFinancialBalanceSheet: (asOf: string) =>
    apiFetch<{
      asOf: string;
      branch: string | null;
      assets: { cashAndEquivalents: number; totalRevenue: number; totalAssets: number };
      liabilities: { outstandingReceivables: number; totalLiabilities: number };
      equity: { retainedEarnings: number; contributedEquity: number; totalEquity: number };
      summary: { totalRevenue: number; totalExpenses: number; totalRefunds: number; netPosition: number; ledgerImbalance: number };
    }>(`/admin/financial/balance-sheet?asOf=${encodeURIComponent(asOf)}`, {}, A),
  getFinancialCashFlow: (from: string, to: string) =>
    apiFetch<{
      period: { from: string; to: string };
      branch: string | null;
      operating: { inflows: number; outflows: number; refunds: number; netOperatingCashFlow: number };
      monthly: Array<{ month: string; revenue: number; refunds: number; expenses: number; netCashFlow: number }>;
    }>(`/admin/financial/cash-flow?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {}, A),
  listAllInbox:            ()             => apiFetch<AR[]>('/admin/inbox', {}, A),
  listAllAutomationWorkflows: ()          => apiFetch<AR[]>('/admin/automation-workflows', {}, A),
  listAllQuizAttempts:     (limit = 500)  => apiFetch<AR[]>(`/admin/quiz-attempts?limit=${limit}`, {}, A),
  getSettings:             ()             => apiFetch<AR>('/admin/settings', {}, A),
  generateAdminAi: (body: { systemPrompt?: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; maxTokens?: number }) =>
    apiFetch<{ text: string }>('/admin/ai/generate', { method: 'POST', body: JSON.stringify(body) }, A),
  getContent:              ()             => apiFetch<AR>('/admin/content', {}, A),
  getDiscounts:            ()             => apiFetch<AR[]>('/admin/discounts', {}, A),
  getPayments:             async (startDate?: string, endDate?: string, maxRows = 50000) => {
    const all: AR[] = [];
    const pageSize = 5000;
    while (all.length < maxRows) {
      const p = new URLSearchParams({ limit: String(pageSize), offset: String(all.length) });
      if (startDate) p.set('startDate', startDate);
      if (endDate)   p.set('endDate', endDate);
      const page = await apiFetch<AR[]>(`/admin/payments?${p}`, {}, A);
      all.push(...page);
      if (page.length < pageSize) break;
    }
    return all.slice(0, maxRows);
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
  convertSubscriberToLead: (id: string) =>
    apiFetch<{ ok: boolean; leadId: string; subscriberId: string }>(
      `/admin/subscribers/${encodeURIComponent(id)}/convert-to-lead`,
      { method: 'POST', body: '{}' },
      A
    ),

  // ── Leads ──
  saveLead:   (o: AR) => post('/admin/leads', o),
  convertLead: (id: string, body: { courseId?: string; accessMode?: 'preview' | 'full' | 'limited' }) =>
    apiFetch<{ ok: boolean; subscriber_id: string; client_code?: string; already_existed?: boolean }>(
      `/admin/leads/${encodeURIComponent(id)}/convert`,
      { method: 'POST', body: JSON.stringify(body) }, A
    ),
  deleteLead: (id: string) => del(`/admin/leads/${id}`),
  getLeadTimeline: (id: string) => apiFetch<AR[]>(`/admin/leads/${id}/timeline`, {}, A),
  listLeadDuplicates: () => apiFetch<{ groups: AR[]; count: number }>('/admin/leads/duplicates', {}, A),
  listLeadMergeHistory: (limit = 50) => apiFetch<AR[]>(`/admin/leads/merge-history?limit=${limit}`, {}, A),
  mergeLeads: (targetId: string, sourceIds: string[]) => post('/admin/leads/merge', { targetId, sourceIds }),
  unmergeLead: (sourceId: string) => post('/admin/leads/unmerge', { sourceId }),

  // ── Staff ──
  saveStaff:        (o: AR) => post('/admin/staff', o),
  updateHrEmployee: (id: string, o: AR) => put(`/admin/hr/employees/${encodeURIComponent(id)}`, o),
  deleteStaff:      (id: string) => del(`/admin/staff/${id}`),
  createStaffAccount: (o: AR) => post('/admin/staff-account', o),
  // Server-computed staff profile: whole-employment monthly series, today's
  // counters, leaderboard rank, lifetime records, task rollup — one call.
  getStaffProfile:  (id: string) => apiFetch<AR>(`/admin/hr/staff/${encodeURIComponent(id)}/profile`, {}, A),
  listStaffMessages: (id: string) => apiFetch<AR[]>(`/admin/hr/staff/${encodeURIComponent(id)}/messages`, {}, A),
  sendStaffMessage: (id: string, body: string) => post(`/admin/hr/staff/${encodeURIComponent(id)}/messages`, { body }),
  // Period-scoped scorecard (today/yesterday/week/days15/month/months3).
  getStaffReport: (id: string, period: string) =>
    apiFetch<AR>(`/admin/hr/staff/${encodeURIComponent(id)}/report?period=${encodeURIComponent(period)}`, {}, A),
  // Group messaging: all staff / a role / a branch / specific people.
  getBroadcastAudiences: () => apiFetch<AR>('/admin/hr/staff/broadcast-audiences', {}, A),
  sendStaffBroadcast: (payload: AR) => post('/admin/hr/staff/broadcast', payload),
  // Employee's own thread (their side of the same conversation).
  listMyStaffMessages: () => apiFetch<AR[]>('/staff/me/messages', {}, A),
  sendMyStaffMessage:  (body: string, scope: 'management' | 'team' = 'management') =>
    post('/staff/me/messages', { body, scope }),

  // ── التوظيف / الانترفيوهات (job_applicants pipeline) ──
  listHrApplicants: (stage?: string) => apiFetch<AR[]>(`/admin/hr/applicants${stage ? `?stage=${encodeURIComponent(stage)}` : ''}`, {}, A),
  updateHrApplicant: (id: string, o: AR) => put(`/admin/hr/applicants/${encodeURIComponent(id)}`, o),
  hireHrApplicant:  (id: string, o: AR = {}) => post(`/admin/hr/applicants/${encodeURIComponent(id)}/hire`, o),
  moveJoinUsToInterview: (id: string) => post(`/admin/hr/join-us/${encodeURIComponent(id)}/to-interview`, {}),
  listHrJobs:       ()             => apiFetch<AR[]>('/admin/hr/jobs', {}, A),
  createHrApplicant: (jobId: string, o: AR) => post(`/admin/hr/jobs/${encodeURIComponent(jobId)}/applicants`, o),

  // ── Sales targets (per-staff, per-month — single source of truth) ──
  listSalesTargets: (period?: string) => apiFetch<AR[]>(`/admin/sales-targets${period ? `?period=${encodeURIComponent(period)}` : ''}`, {}, A),
  saveSalesTarget:  (o: AR) => post('/admin/sales-targets', o),

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
  // Reconcile a customer payment (order) against a bank transfer: confirm + record the link.
  linkOrderTransfer: (orderId: string, transferId: string) => patch(`/admin/orders/${orderId}`, { status: 'paid', linked_transfer_id: transferId }),
  deleteOrder:       (id: string) => del(`/admin/orders/${id}`),

  // ── Subscriber Payments (payments table) ──
  saveSubscriberPayment: (subscriber_id: string, payment: AR) => post('/admin/subscriber-payments', { subscriber_id, payment }),
  saveLeadPayment: (lead_id: string, payment: AR, subscriber?: { email?: string; nationalId?: string }) =>
    apiFetch<{
      ok: boolean;
      id: string;
      subscriberId: string;
      subscriberCreated: boolean;
      status: string;
      approvalRequired?: boolean;
    }>(
      '/admin/subscriber-payments',
      { method: 'POST', body: JSON.stringify({ lead_id, payment, subscriber }) },
      A,
    ),
  updatePaymentStatus: (id: string, status: 'paid' | 'failed' | 'pending', reviewNote?: string) =>
    apiFetch<{ ok: boolean; id: string; status: string }>(
      `/admin/payments/${encodeURIComponent(id)}/status`,
      { method: 'PATCH', body: JSON.stringify({ status, reviewNote }) },
      A,
    ),
  backfillPayments:      () => post('/admin/backfill-payments', {}),

  // ── Credentials (admin reset) ──
  updateSubscriberCredentials: (subscriberId: string, currentEmail: string, opts: { newEmail?: string; newPassword?: string }) =>
    apiFetch<{ ok: boolean }>(`/admin/subscribers/${subscriberId}/credentials`, { method: 'PUT', body: JSON.stringify({ currentEmail, ...opts }) }, A),
  getSubscriberPassword: (subscriberId: string) =>
    apiFetch<{ plain_password: string | null }>(`/admin/subscribers/${subscriberId}/password`, {}, A),

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
  transferDaqqiAttendee: (data: { subscriberId: string; fromRoundId: string; toRoundId: string }) =>
    post('/admin/daqqi-rounds/transfer-attendee', data),

  // ── Join-Us applications ──
  updateJoinUs: (id: string, status: string, notes?: string) => patch(`/admin/join-us/${id}`, { status, notes }),
  deleteJoinUs: (id: string) => del(`/admin/join-us/${id}`),

  // ── Contact Messages ──
  updateContactMessage: (id: string, status: string, adminNote?: string) => patch(`/admin/contact-messages/${id}`, { status, adminNote }),
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
  saveNotifications: (data: unknown[]) => put('/admin/notification-settings', data),
  getNotificationSettings: () => apiFetch<AR[]>('/admin/notification-settings', {}, A),

  // ── Payment Proofs ──
  listPaymentProofs: (status?: 'PENDING' | 'APPROVED' | 'REJECTED', branch?: string) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (branch) params.set('branch', branch);
    const query = params.toString();
    return apiFetch<AR[]>(`/admin/payment-proofs${query ? `?${query}` : ''}`, {}, A);
  },
  getPaymentProofImage: (id: string, branch?: string) =>
    apiFetch<{ image: string }>(`/admin/payment-proofs/${id}/image${branch ? `?branch=${encodeURIComponent(branch)}` : ''}`, {}, A),
  reviewPaymentProof: (id: string, action: 'approve' | 'reject', reviewer_note?: string, branch?: string) =>
    apiFetch<{ ok: boolean; status: string; pendingSecondApproval?: boolean; review_due_at?: string }>(`/admin/payment-proofs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action, reviewer_note, branch }),
    }, A),

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
  /** Delete duplicate leads: leads matching subscriber phones + leads with duplicate phones (keep oldest) */
  dedupLeads: () =>
    apiFetch<{ ok: boolean; deleted: number }>(
      '/admin/leads/dedup-cleanup', { method: 'POST', body: '{}' }, A
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
  migrateLeadBranches: () =>
    apiFetch<{ ok: boolean; updated: number; unresolved: number; total: number }>(
      '/admin/leads/migrate-branches', { method: 'POST', body: '{}' }, A
    ),

  // ── CRM Settings (sources, auto-assign, google sheets) ──
  getCrmSettings: () => apiFetch<Record<string, unknown>>('/admin/crm-settings', {}, A),
  saveCrmSettings: (data: Record<string, unknown>) =>
    apiFetch<{ ok: boolean }>('/admin/crm-settings', { method: 'PUT', body: JSON.stringify(data) }, A),
  getCrmPipeline: () => apiFetch<{ stages: Array<{
    status: string; label: string; position: number; showInPipeline: boolean;
    isTerminal: boolean; allowedNext: string[];
  }> }>('/admin/crm/pipeline', {}, A),
  saveCrmPipeline: (stages: Array<Record<string, unknown>>) =>
    apiFetch<{ ok: boolean; stages: Array<Record<string, unknown>> }>(
      '/admin/crm/pipeline', { method: 'PUT', body: JSON.stringify({ stages }) }, A
    ),
  getCrmAssignmentMembers: () => apiFetch<{ members: Array<Record<string, unknown>> }>(
    '/admin/crm/assignment-members', {}, A
  ),
  saveCrmAssignmentMembers: (members: Array<Record<string, unknown>>) =>
    apiFetch<{ ok: boolean; members: Array<Record<string, unknown>> }>(
      '/admin/crm/assignment-members', { method: 'PUT', body: JSON.stringify({ members }) }, A
    ),
  deleteLeadInteraction: (leadId: string, interactionId: string) =>
    apiFetch<{ ok: boolean; id: string; deleted: boolean }>(
      `/admin/crm/leads/${encodeURIComponent(leadId)}/interactions/${encodeURIComponent(interactionId)}`,
      { method: 'DELETE' },
      A,
    ),
  addLeadInteraction: (leadId: string, interaction: {
    type: string;
    notes: string;
    outcome?: string;
    date?: string;
    nextFollowUp?: string;
    newStatus?: string;
  }) =>
    apiFetch<{ ok: boolean; id: string; leadId: string; status: string }>(
      `/admin/crm/leads/${encodeURIComponent(leadId)}/interactions`,
      { method: 'POST', body: JSON.stringify(interaction) },
      A,
    ),
  getLeadInteractions: (leadId: string, limit = 300) =>
    apiFetch<{
      ok: boolean;
      communications: Array<{
        id: string;
        type: string;
        date: string;
        notes: string;
        outcome?: string;
        nextFollowUp?: string;
        staffId?: string;
      }>;
      timeline: Array<Record<string, unknown>>;
    }>(
      `/admin/crm/leads/${encodeURIComponent(leadId)}/interactions?limit=${Math.min(Math.max(limit, 1), 300)}`,
      {},
      A,
    ),
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
  getWhatsAppConfig: () => apiFetch<{ provider: 'meta' | 'green-api'; instanceId: string; hasToken: boolean; metaPhoneId: string; hasMetaToken: boolean }>('/admin/whatsapp-config', {}, A),
  // Accepts the full config (provider + the relevant creds). Blank secrets are kept
  // server-side, so the form needn't re-send tokens it doesn't change.
  saveWhatsAppConfig: (cfg: { provider?: 'meta' | 'green-api'; instanceId?: string; apiToken?: string; metaPhoneId?: string; metaToken?: string }) =>
    put('/admin/whatsapp-config', cfg),

  getFbLeadConfig: () => apiFetch<Record<string, unknown>>('/admin/facebook-lead-ads-config', {}, A),
  saveFbLeadConfig: (cfg: Record<string, unknown>) =>
    apiFetch<{ ok: boolean }>('/admin/facebook-lead-ads-config', { method: 'PUT', body: JSON.stringify(cfg) }, A),

  // WhatsApp credentials remain server-side; the browser never receives or stores tokens.
  waProxyChats: () =>
    apiFetch<unknown[]>('/admin/whatsapp-proxy/chats', { method: 'POST', body: '{}' }, A),
  waProxyChatHistory: (chatId: string, count = 30) =>
    apiFetch<unknown[]>('/admin/whatsapp-proxy/history', { method: 'POST', body: JSON.stringify({ chatId, count }) }, A),
  waProxySend: (phone: string, message: string) =>
    apiFetch<{ ok: boolean; idMessage?: string }>('/admin/whatsapp-proxy/send', { method: 'POST', body: JSON.stringify({ phone, message }) }, A),

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
  deleteNotification: (id: string) => apiFetch<{ ok: boolean }>(`/admin/notifications/${id}`, { method: 'DELETE' }, A),

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

// ── Paymob payment helpers ────────────────────────────────────────────────────
export const mysqlPaymob = {
  /** Save pending order server-side BEFORE opening Paymob iframe.
   *  On payment success, the server verifies HMAC and enrolls. */
  reserveOrder: (data: AR) =>
    apiFetch<{ ok: boolean }>('/orders/reserve', { method: 'POST', body: JSON.stringify(data) }),
  /** Verify Paymob redirect params (HMAC-SHA512) and finalise enrollment on server */
  verifyPayment: (params: Record<string, string>) =>
    apiFetch<{ ok: boolean; verified: boolean; paid: boolean; alreadyProcessed?: boolean }>(
      '/paymob/verify', { method: 'POST', body: JSON.stringify(params) }
    ),
};

// ── Custom Auth ───────────────────────────────────────────────────────────────
export const mysqlAuth = {
  login: (email: string, password: string) =>
    apiFetch<{
      ok: boolean;      user?: AuthUser;
      totpRequired?: boolean;
      pendingToken?: string;
    }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (data: { email: string; password: string; name?: string; phone?: string; country?: string; interest?: string }) =>
    apiFetch<{ ok: boolean; user: AuthUser }>('/user/signup', { method: 'POST', body: JSON.stringify(data) }, true),
  me: () => apiFetch<AuthUser>('/auth/me', {}, true),
  updateProfile: (name: string) =>
    apiFetch<{ ok: boolean }>('/auth/update-profile', { method: 'PUT', body: JSON.stringify({ name }) }, true),
  updatePassword: (currentPassword: string, newPassword: string) =>
    apiFetch<{ ok: boolean }>('/auth/update-password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) }, true),
  resetPassword: (resetToken: string, newPassword: string) =>
    apiFetch<{ ok: boolean }>('/auth/reset-password', { method: 'POST', body: JSON.stringify({ resetToken, newPassword }) }),
  forceResetPassword: (email: string) =>
    apiFetch<{ ok: boolean; temporaryPassword: string }>('/admin/force-reset-password', { method: 'POST', body: JSON.stringify({ email }) }, true),
  updateSubscriberCredentials: (subscriberId: string, currentEmail: string, opts: { newEmail?: string; newPassword?: string }) =>
    apiFetch<{ ok: boolean }>(`/admin/subscribers/${subscriberId}/credentials`, { method: 'PUT', body: JSON.stringify({ currentEmail, ...opts }) }, true),
  forgotPassword: (email: string) =>
    apiFetch<{ ok: boolean }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  verifyOtp: (email: string, code: string) =>
    apiFetch<{ ok: boolean; resetToken: string }>('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email, code }) }),
  verify2fa: (pendingToken: string, token: string) =>
    apiFetch<{ ok: boolean }>('/auth/2fa/verify', { method: 'POST', body: JSON.stringify({ pendingToken, token }) }),
  get2faStatus: () =>
    apiFetch<{ enabled: boolean }>('/auth/2fa/status'),
  setup2fa: () =>
    apiFetch<{ secret: string; qrDataUrl: string; otpAuthUrl: string }>('/auth/2fa/setup', { method: 'POST' }),
  enable2fa: (token: string) =>
    apiFetch<{ ok: boolean }>('/auth/2fa/enable', { method: 'POST', body: JSON.stringify({ token }) }),
  disable2fa: (token?: string) =>
    apiFetch<{ ok: boolean }>('/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ token }) }),
  logout: () => { localStorage.removeItem('mahad-token'); apiFetch<{ ok: boolean }>('/auth/logout', { method: 'POST' }).catch(() => {}); },
};

export async function checkApiHealth(): Promise<boolean> {
  try { return (await fetch(`${API_BASE}/health`)).ok; }
  catch { return false; }
}
