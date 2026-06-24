export type Currency = 'EGP' | 'SAR' | 'USD';

/** Shared toast/notification callback signature used across dashboard tabs */
export type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

/** Custom auth user — replaces Firebase User type */
export interface AuthUser {
  uid: string;
  email: string;
  displayName?: string;
  isAdmin?: boolean;
}

export type MeetingProvider = 'zoom' | 'google_meet' | 'custom';
export type WeekDayKey = 'saturday' | 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';

export interface Price {
  EGP: number;
  SAR: number;
  USD: number;
}

export interface TherapistAvailabilitySlot {
  id: string;
  day: WeekDayKey;
  startTime: string;
  endTime: string;
  timezone: string;
  label?: string;
  meetingLink?: string;
  isActive: boolean;
}

export interface TherapistPortalCredentials {
  username: string;
  password: string;
  temporaryPassword?: boolean;
  lastLoginAt?: string;
}

export interface TherapistConsultationSettings {
  enabled: boolean;
  sessionDurationMinutes: number;
  sessionPrice: Price;
  meetingProvider: MeetingProvider;
  providerBaseUrl: string;
  autoCreateMeetingLink: boolean;
  intakeFormUrl?: string;
  bookingNotes?: string;
  availableSlots: TherapistAvailabilitySlot[];
  portal: TherapistPortalCredentials;
}

export interface CourseMaterial {
  id: string;
  title: string;
  url: string;           // Direct PDF URL (Firebase Storage or external)
  accessLevel: 'partial' | 'full';  // 'partial' = any subscriber, 'full' = full-access only
}

export interface Course {
  id: string;
  courseCode?: string;  // Numeric code starting from 3000
  slug?: string;
  title: string;
  titleEn?: string;     // English title for certificate display
  description: string;
  shortDescription: string;
  instructor: string;
  thumbnail: string;
  category: 'Therapy' | 'Diagnosis' | 'Child' | 'General';
  type: 'Recorded' | 'Live' | 'Mix';
  price: Price;
  originalPrice: Price;
  rating: number;
  students: number;
  modules: string[];
  duration: string;
  level: string;
  detailsContent?: Record<string, string>;
  promoVideoUrl?: string;
  liveSessionUrl?: string;
  galleryImages?: string[];
  certificateTemplateUrl?: string;
  certificateTemplateName?: string;
  courseModules?: { title: string; items: string[] }[];
  materials?: CourseMaterial[];
  titleAr?: string;
  hours?: number;
  seo_title?: string;
  seo_description?: string;
  seo_keywords?: string;
  createdAt?: string;
  aliases?: string[];  // alternative names for Facebook lead matching
  status?: string;     // legacy publication status ('active' | ...); missing = active
  isPublished?: boolean;
  sortOrder?: number;
}

export interface Bundle {
  id: string;
  title: string;
  titleEn?: string;
  titleAr?: string;     // Explicit Arabic title (defaults to title)
  slug?: string;
  videoUrl?: string;
  thumbnail?: string;
  shortDescription?: string;
  courses: Course[];
  price: Price;
  originalPrice: Price;
  description: string;
  detailsContent?: Record<string, string>;
  isPublished?: boolean;
  sortOrder?: number;
}

export interface Therapist {
  id: string;
  name: string;
  specialty: string;
  image: string;
  experience: number;
  rating: number;
  price: Price;
  title?: string;
  bio?: string;
  featured?: boolean;
  sortOrder?: number;
  showOnHome?: boolean;
  showOnAbout?: boolean;
  languages?: string[];
  focusAreas?: string[];
  qualifications?: string[];
  consultationSettings?: TherapistConsultationSettings;
}

export interface ConsultationItem {
  id: string;
  clientName: string;
  clientEmail?: string;
  clientPhone?: string;
  therapistId: string;
  therapistName: string;
  sessionType: 'individual' | 'couple' | 'family';
  sessionDate: string;
  slotId?: string;
  slotLabel?: string;
  timezone?: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'scheduled';
  notes: string;
  amount?: number;
  currency?: Currency;
  sessionDurationMinutes?: number;
  meetingProvider?: MeetingProvider;
  meetingLink?: string;
  createdAt?: string;
  // Legacy / extra server fields (older records or alternate mappers)
  scheduledAt?: string;   // legacy alias of sessionDate
  date?: string;          // legacy alias of sessionDate
  consultantId?: string;  // legacy alias of therapistId
  staffId?: string;       // staff assigned to the consultation (payroll earnings)
  name?: string;          // legacy alias of clientName
  phone?: string;         // legacy alias of clientPhone
}

export type BranchType = string;
export type InterestLevel = 'low' | 'medium' | 'high';
export type LeadType = 'course' | 'consultation' | 'general';
export type LeadStatus = 'new' | 'contacted' | 'interested' | 'not_interested' | 'no_answer' | 'closed' | 'converted' | 'lost'
  | 'interested_booking' | 'interested_followup' | 'postpone_month'
  | 'no_answer_wa' | 'no_answer_nowa' | 'wrong_number'
  | 'with_colleague' | 'not_interested_hidden' | 'other';
export type PaymentItemType = 'course' | 'certificate' | 'consultation' | 'book' | 'carneh' | 'other';

export interface CommunicationRecord {
  id: string;
  type: 'call' | 'whatsapp' | 'email' | 'meeting' | 'note' | 'payment_followup' | 'new_course_sale' | 'certificate';
  date: string;
  notes: string;
  outcome?: string;
  nextFollowUp?: string;
}

export interface SubscriberCertificate {
  id: string;
  courseId: string;
  certificateNumber: string;
  issuedAt: string;
  note?: string;
}

export type ExtraCertificateType =
  | 'social_solidarity'
  | 'ain_shams'
  | 'experience_external'
  | 'practice_external'
  | 'national_council'
  | 'american_board'
  | 'institute'
  | 'other';

export interface ExtraCertificateRequest {
  id: string;
  courseId?: string;
  type: ExtraCertificateType;
  customName?: string;
  nameAr?: string;
  nameEn?: string;
  nationality?: 'egyptian' | 'non_egyptian_egypt' | 'saudi_resident' | 'international';
  idNumber?: string;
  status: 'pending' | 'priced' | 'paid' | 'in_progress' | 'not_sent' | 'issued' | 'shipped' | 'at_branch' | 'delivered';
  price?: number;
  paidAmount?: number;
  currency?: 'EGP' | 'SAR' | 'USD';
  requestedAt: string;
  issuedAt?: string;
  note?: string;
  adminNote?: string;
}

export interface PaymentRecord {
  id: string;
  amount: number;
  currency: 'EGP' | 'SAR' | 'USD';
  courseId: string;
  date: string;
  note?: string;
  paymentType?: PaymentItemType;
  paymentMethod?: string;
  transactionId?: string;
}

export interface LeadItem {
  id: string;
  clientCode?: string;   // Stable unified client URL code, e.g. "CLT-A1B2C3"
  name: string;
  email: string;
  phone: string;
  source: string;
  status: LeadStatus;
  createdAt: string;
  leadType: LeadType;
  enrolledCourseId?: string;
  interestedCourseIds?: string[];
  branch?: BranchType;
  rawBranch?: string;   // Raw branch text from sheet when ENUM mapping fails
  interestLevel?: InterestLevel;
  assignedSalesId?: string;
  assignedSalesName?: string;
  assignedCsId?: string;
  assignedCsName?: string;
  communications?: CommunicationRecord[];
  notes?: string;
  lastFollowUp?: string;
  lastContactNote?: string;
  nextFollowUpDate?: string;
  loginEmail?: string;
  paymentRecords?: PaymentRecord[];
  promoCode?: string;
  hidden?: boolean;
  fbLeadId?: string;       // Facebook Lead ID for deduplication
  fbFormId?: string;       // Facebook Form ID this lead came from
  fbFormName?: string;     // Facebook Form display name
  tags?: string[];         // Custom tags / labels (e.g. "اهتمام قوي", "VIP", "مرجأ")
  dealValue?: number;      // Manual deal value in EGP (set by sales rep)
  waOptOut?: boolean;      // Lead opted out of WhatsApp messages
  updatedAt?: string;      // Last update timestamp (for follow-up recency)
  score?: number;          // Lead score
}

export type StaffRole = 'instructor' | 'trainer' | 'expert' | 'sales' | 'manager' | 'admin' | 'support' | 'reception_daqqi' | 'daqqi_manager' | 'collection' | 'accountant' | 'consultant' | 'sales_collection_manager' | 'hr' | 'online_manager' | 'other';

export type StaffPermission =
  // Dashboard overview
  | 'view_dashboard'
  // Leads — potential clients
  | 'view_leads'
  | 'manage_leads'
  | 'delete_leads'
  | 'export_leads'
  // Subscribers — enrolled clients
  | 'view_subscribers'
  | 'manage_subscribers'
  | 'delete_subscribers'
  | 'export_subscribers'
  // Courses & catalog
  | 'view_courses'
  | 'manage_courses'
  | 'manage_lectures'
  | 'manage_instructors'
  | 'manage_bundles'
  | 'manage_testimonials'
  | 'manage_discounts'
  // Consultations
  | 'view_consultations'
  | 'manage_consultations'
  // Community
  | 'view_community'
  | 'manage_community'
  // Content & website
  | 'manage_content'
  // Staff management
  | 'view_staff'
  | 'manage_staff'
  // Orders & payments
  | 'view_orders'
  | 'manage_orders'
  | 'view_financial'
  | 'manage_financial'
  // Reports & analytics
  | 'view_reports'
  // Messaging & inbox
  | 'manage_inbox'
  | 'manage_notifications'
  | 'manage_channel_settings'
  // Communication records
  | 'view_join_us'
  | 'manage_join_us'
  | 'view_contacts'
  | 'manage_contacts'
  // Operations
  | 'view_activity'
  | 'manage_daqqi'
  | 'manage_automation'
  // Client database (unified view — admin/manager only)
  | 'view_client_db'
  // AI
  | 'ask_ai'
  | 'manage_ai_settings'
  | 'ai_dev';

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: StaffRole;
  image?: string;
  specialization?: string;
  joinedAt: string;
  status: 'active' | 'inactive';
  notes?: string;
  commissionRate?: number;   // percentage, e.g. 10 = 10%
  firebaseUid?: string;
  permissions?: StaffPermission[];
  // ── HR fields ────────────────────────────────────────────────────────────
  salary?: number;                           // Monthly base salary (EGP)
  monthlyTargetType?: 'egp' | 'clients';    // Target is revenue or client count
  monthlyTarget?: number;                    // Target value (EGP or count)
  monthlyBonus?: number;                     // Fixed monthly bonus on target hit (EGP)
  absences?: StaffAbsence[];                // Absence / leave records
  hrNotes?: string;                          // Private HR notes
  nationalId?: string;
  address?: string;
  department?: string;
}

export interface StaffAbsence {
  id: string;
  date: string;          // YYYY-MM-DD
  type: 'absence' | 'leave' | 'sick' | 'late';
  notes?: string;
  approvedBy?: string;   // staff id
}

// ---------- Shared platform types ----------

export type AccessMode = 'preview' | 'full' | 'limited';

export interface CourseAccessSetting {
  mode: AccessMode;
  lectureLimit?: number;
}

export interface PaymentHistoryEntry {
  id: string;
  amount: number;
  currency: 'EGP' | 'SAR' | 'USD';
  note?: string;
  paymentType?: PaymentItemType;
  paymentMethod?: string;       // e.g. خزنة الفرع، فودافون كاش، انستا باي …
  fromAccountNumber?: string;   // Bank account / wallet number the transfer was made FROM
  transactionId?: string;       // Payment transaction / operation reference number
  isInstallment?: boolean;      // false/undefined = new booking, true = installment
  courseId?: string;            // Which course this payment applies to
  bundleId?: string;            // Which bundle this payment applies to (if bundle purchase)
  courseExpected?: number;      // Total expected for this course (set on new_booking)
  discount?: number;            // Discount applied on this new_booking
  certId?: string;              // Certificate request ID (if paymentType=certificate)
  certType?: string;            // Certificate type name (e.g. شهادة حضور، شهادة معتمدة)
  itemTitle?: string;           // Human-readable item name (course title / cert name / etc.)
  source?: 'web' | 'staff' | 'reception' | 'daqqi' | 'paymob' | 'system'; // Where payment originated
  at: string;
  staffId?: string;             // Staff who recorded this payment
  staffName?: string;           // Display name of staff who recorded it
  status?: 'pending' | 'paid' | 'failed' | 'refunded'; // undefined/missing = paid (backward compat)
}

export interface SubscriberItem {
  id: string;
  clientCode?: string;   // Stable unified client URL code, preserved from lead if converted
  leadId?: string;
  firebaseUid?: string;  // Firebase Auth UID — auto-linked on first login
  name: string;
  nameEn?: string;      // English name for certificate display
  nameAr?: string;      // Explicit Arabic name (same as name by default)
  email: string;
  phone: string;
  enrolledCourseIds: string[];
  courseAccess?: Record<string, 'preview' | 'full' | CourseAccessSetting>;
  lectureProgress?: Record<string, number>;
  paymentHistory?: PaymentHistoryEntry[];
  expectedTotals?: { EGP?: number; SAR?: number; USD?: number };  // Expected total payments
  totalPaid?: number;        // Computed total EGP paid (may be included by server)
  branch?: BranchType;
  assignedSalesId?: string;
  assignedSalesName?: string;
  assignedCsId?: string;
  assignedCsName?: string;
  discount?: number;  // Discount amount in EGP
  status: 'active' | 'active_new' | 'active_paid' | 'active_late' | 'paused' | 'blocked' | 'finished' | 'refunded';
  createdAt: string;
  // Legacy / extra server fields (older records or alternate mappers)
  totalValue?: number;        // computed lifetime value (server-included on some endpoints)
  collectionStaffId?: string; // collection staff assigned to follow up payments
  subscribedAt?: string;      // legacy alias of createdAt
  assignedStaffId?: string;   // legacy generic staff assignment
  consultantId?: string;      // legacy consultant assignment
  enrolledCourseId?: string;  // legacy single-course field (superseded by enrolledCourseIds)
  communications?: CommunicationRecord[];
  certificates?: SubscriberCertificate[];
  extraCertificateRequests?: ExtraCertificateRequest[];
  installmentPlans?: InstallmentPlan[];
  notes?: string;
  nationalId?: string;   // رقم قومي — set on booking from staff modal
  updatedAt?: string;    // Server-side updated_at for optimistic concurrency control
  nextFollowUpDate?: string;  // Next follow-up date for collection/sales follow-up tracking
  lastFollowUp?: string;  // Last contact date
  clientStatus?: string;  // Online client lifecycle: active | finished | paused | refunded
  transferAnswers?: Record<string, unknown>;  // Answers recorded at time of conversion
  transferDate?: string;  // Date of conversion
}

export type DaqqiDayOfWeek = 'الأحد' | 'الاثنين' | 'الثلاثاء' | 'الأربعاء' | 'الخميس' | 'الجمعة' | 'السبت';
export type DaqqiTimeSlot = 'صباحاً' | 'ظهراً' | 'مساءً';

export interface DaqqiRoundAttendee {
  subscriberId: string;
  name: string;
  phone: string;
  bookedAt: string;
  amountPaid: number;
  attendedLectures?: number;
}

export interface DaqqiRound {
  id: string;
  code: string;
  courseId: string;
  instructorId: string;
  instructorName: string;
  receptionId: string;
  receptionName: string;
  dayOfWeek: DaqqiDayOfWeek;
  startDate: string;
  timeSlot: DaqqiTimeSlot;
  roomId?: string;
  roomName?: string;
  status: 'new' | 'active' | 'finished';
  currentLecture?: number;
  attendees: DaqqiRoundAttendee[];
  postponedWeeks?: string[];
  createdAt: string;
}

export interface JoinUsApplication {
  id: string;
  name: string;
  email: string;
  phone: string;
  specialty: string;
  experience: string;
  type: 'instructor' | 'consultant' | 'employee';
  linkedin?: string;
  message?: string;
  status: 'new' | 'reviewed' | 'accepted' | 'rejected' | 'pending';
  createdAt: string;
  adminNote?: string;
}

export interface ContactMessage {
  id: string;
  name: string;
  email?: string;
  phone: string;
  subject?: string;
  message: string;
  status: 'new' | 'read' | 'replied';
  createdAt: string;
  adminNote?: string;
}

export interface CourseChapterItem {
  id: string;
  courseId: string;
  title: string;
  order: number;
}

export interface CourseLectureItem {
  id: string;
  courseId: string;
  chapterId?: string;
  title: string;
  lectureType: 'recorded' | 'live';
  videoUrl: string;
  duration: string;
  order: number;
  thumbnail?: string;
  aiNotes?: string;        // AI-generated lecture notes (HTML)
}

export interface OrderItem {
  id: string;
  subscriberId?: string;  // Subscriber who made this payment
  type: 'course' | 'bundle' | 'consultation' | 'transfer';
  note?: string;
  itemId: string;
  itemTitle: string;
  amount: number;
  currency: 'EGP' | 'SAR' | 'USD';
  paymentMethod: 'card' | 'wallet' | 'cash' | 'transfer' | 'vodafone_cash' | 'instapay' | 'online_paymob' | 'other' | string;
  customerName: string;
  customerEmail?: string;
  status: 'paid' | 'failed' | 'refunded' | 'pending';
  createdAt: string;
  transactionId?: string;
  paidAt?: string;
  couponCode?: string;
  staffId?: string;    // Staff who processed / confirmed this order
  staffName?: string;  // Display name
  // Legacy / extra server fields (may be present on older records)
  courseId?: string;
  bundleId?: string;
  courseName?: string;
  leadId?: string;
  source?: string;
  linkedTransferId?: string;  // For a customer payment: the bank transfer it was reconciled/matched against
}

export interface TestimonialItem {
  id: number;
  name: string;
  role: string;
  text: string;
  image: string;
}

export interface CommunityComment {
  id: string;
  author: string;
  body: string;
  at: string;
}

export interface CommunityPostItem {
  id: string;
  authorName: string;
  authorRole: string;
  authorImage: string;
  title: string;
  body: string;
  tag: string;
  likes: number;
  comments: number;
  createdAt: string;
  pinned?: boolean;
  commentsList?: CommunityComment[];
  status?: 'pending' | 'approved' | 'rejected'; // moderation status; undefined/approved = visible
}

export interface CommunityLibraryItem {
  id: string;
  title: string;
  description: string;
  fileType: string;
  fileSize: string;
  downloadUrl: string;
}

export interface CommunityVideoItem {
  id: string;
  title: string;
  duration: string;
  viewsLabel: string;
  thumbnail: string;
  videoUrl?: string;
  description?: string;
}

export interface CommunityEventItem {
  id: string;
  dateLabel: string;
  title: string;
  eventType: string;
  speaker: string;
  platform: string;
  eventDate?: string;    // ISO date (YYYY-MM-DD) for calendar display
  description?: string; // Full details for the event
}

export interface ActivityLogItem {
  id: string;
  action: string;
  entity: string;
  label: string;
  at: string;
  actor?: string;       // email or uid of the user who performed the action
  actorName?: string;   // display name of actor
  section?: string;     // department/section label in Arabic
}

export interface UserSessionData {
  uid: string;
  token: string;
  loginAt: string;
  lastActiveAt: string;
  visitCount: number;
  email?: string;
  displayName?: string;
}

export interface DiscountRule {
  id: string;
  type: 'course' | 'bundle' | 'all_courses' | 'therapist_consultation' | 'all_consultations'
    | 'percent' | 'fixed'; // promo-code shapes returned by /api/admin/promo-codes
  targetId?: string;
  discountPercent: number;
  label?: string;
  promoCode?: string;
  active: boolean;
  expiresAt?: string;
  createdAt: string;
  // Promo-code fields (records sourced from promo_codes table share this type)
  code?: string;        // alias of promoCode
  value?: number;       // discount value (percent or fixed amount per `type`)
  usageCount?: number;  // how many times the code was used
  usageLimit?: number;  // max allowed uses
  isActive?: boolean;   // alias of active
}

export interface NotificationBroadcast {
  id: string;
  title: string;
  body: string;
  type: 'info' | 'offer' | 'update';
  createdAt: string;
  active: boolean;
  // Legacy / extra server fields
  isRead?: boolean;   // per-admin read flag (admin_notifications endpoint)
  message?: string;   // legacy alias of body
  sentAt?: string;    // legacy alias of createdAt
}

export type ExpenseCategory = 'رواتب' | 'تسويق' | 'إيجار' | 'برمجيات' | 'معدات' | 'أخرى';

export interface ExpenseItem {
  id: string;
  category: ExpenseCategory;
  description: string;
  title?: string;            // legacy alias of description (older records)
  amount: number;
  currency: Currency;
  date: string;
  receiptUrl?: string;
  branchType?: BranchType;   // which branch this expense belongs to
  paymentMethod?: string;    // cash, bank transfer, etc.
  createdAt: string;
}

// ── Installment / Receivables types ─────────────────────────────────────────

export interface InstallmentEntry {
  id: string;
  amount: number;
  currency: Currency;
  dueDate: string;         // YYYY-MM-DD — target payment date
  paidAt?: string;         // ISO date when paid
  paidAmount?: number;     // actual paid (may differ from amount)
  note?: string;
}

export interface InstallmentPlan {
  id: string;
  courseId?: string;
  courseTitle?: string;
  totalAmount: number;
  currency: Currency;
  downPayment?: number;    // first payment already made
  entries: InstallmentEntry[];
  notes?: string;
  createdAt: string;
  // Legacy / extra server fields (older plan records)
  payments?: { amount: number; date?: string; paidAt?: string }[]; // legacy alias of entries
  nextDueDate?: string;    // precomputed next due date
  startDate?: string;      // plan start date
}

// ── Sales Targets ────────────────────────────────────────────────────────────

export interface SalesTarget {
  staffId: string;
  month: string;           // YYYY-MM
  targetEGP: number;
  monthlyTarget?: number;  // Alias — same value, some server responses use this key
}

// ── Payment Proofs — client-submitted transfer / instapay receipts ────────────

export type PaymentProofStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type PaymentProofMethod = 'instapay' | 'bank_transfer' | 'vodafone_cash' | 'fawry' | 'other';

export interface PaymentProof {
  id: string;
  subscriber_id: string;
  subscriber_name?: string;
  subscriber_phone?: string;
  subscriber_email?: string;
  course_id?: string | null;
  course_title?: string;
  amount: number;
  currency: 'EGP' | 'SAR' | 'USD';
  payment_method: PaymentProofMethod | string;
  proof_image?: string | null;  // base64 data URL
  note?: string | null;
  status: PaymentProofStatus;
  reviewer_id?: string | null;
  reviewer_note?: string | null;
  submitted_at: string;
  reviewed_at?: string | null;
}

// ── Automation / Workflow types ──────────────────────────────────────────────

export type AutomationTrigger =
  // ── العملاء والمشتركون ──────────────────────────────
  | 'new_subscriber'           // عميل جديد يسجل
  | 'new_lead'                 // عميل محتمل جديد
  | 'lead_converted'           // عميل محتمل يتحول لمشترك
  | 'lead_status_changed'      // تغيير حالة العميل المحتمل
  | 'lead_score_threshold'     // ليد وصل لسكور معين
  | 'subscriber_paused'        // مشترك يصبح متوقف
  | 'subscriber_resumed'       // مشترك يستأنف الاشتراك
  | 'subscriber_upgraded'      // مشترك يترقى للباقة الأعلى
  | 'subscriber_birthday'      // عيد ميلاد مشترك
  | 'subscriber_inactive_x_days' // مشترك غير نشط X أيام
  | 'subscription_expiring_soon' // اشتراك على وشك الانتهاء
  | 'no_contact_x_days'        // عميل لم يتواصل معه منذ X أيام
  // ── المدفوعات والمالية ──────────────────────────────
  | 'new_payment'              // دفعة جديدة ناجحة
  | 'payment_failed'           // فشل عملية الدفع
  | 'payment_partial'          // دفع جزئي
  | 'refund_requested'         // طلب استرداد المبلغ
  | 'refund_approved'          // موافقة على الاسترداد
  // ── الكورسات والتعلم ──────────────────────────────
  | 'course_enrolled'          // تسجيل في كورس
  | 'subscriber_course_completed' // مشترك أنهى كورساً كاملاً
  | 'course_lecture_watched'   // مشاهدة محاضرة
  | 'course_progress_stalled'  // توقف التقدم في الكورس
  | 'course_exam_passed'       // نجاح في الامتحان
  | 'course_exam_failed'       // رسوب في الامتحان
  | 'certificate_requested'    // عميل يطلب شهادة
  // ── الاستشارات ──────────────────────────────────────
  | 'new_consultation'         // طلب استشارة جديد
  | 'consultation_confirmed'   // استشارة مؤكدة
  | 'consultation_cancelled'   // استشارة ملغاة
  | 'consultation_completed'   // استشارة مكتملة
  | 'consultation_no_show'     // عدم حضور الاستشارة
  | 'consultation_rescheduled' // إعادة جدولة الاستشارة
  // ── المجتمع ──────────────────────────────────────────
  | 'community_post_pending'   // منشور مجتمعي ينتظر المراجعة
  | 'community_comment'        // تعليق جديد في المجتمع
  | 'new_testimonial'          // تقييم أو شهادة جديدة
  // ── التواصل والانضمام ────────────────────────────────
  | 'new_join_request'         // طلب انضمام جديد
  | 'new_contact_message'      // رسالة تواصل جديدة
  // ── الدقي ────────────────────────────────────────────
  | 'new_daqqi_round'          // روند دقي جديد يُنشأ
  | 'daqqi_payment_due'        // موعد دفعة دقي
  | 'daqqi_subscriber_missed'  // مشترك دقي مفوَّت
  | 'daqqi_round_completed'    // روند دقي مكتمل
  // ── قنوات الرسائل ────────────────────────────────────
  | 'whatsapp_message_received'    // رسالة واتساب واردة جديدة
  | 'messenger_message_received'   // رسالة ماسنجر واردة جديدة
  | 'instagram_dm_received'        // رسالة إنستجرام واردة جديدة
  | 'webchat_message_received'     // رسالة شات الموقع واردة جديدة
  // ── AI Agent ─────────────────────────────────────────
  | 'ai_agent_responded'           // AI agent رد تلقائياً
  | 'ai_agent_escalated'           // AI agent طلب تدخل بشري
  | 'ai_agent_no_response'         // AI agent لم يتمكن من الرد
  // ── المحادثات ────────────────────────────────────────
  | 'conversation_unassigned'      // محادثة بدون موظف مسؤول
  | 'conversation_idle_x_hours'    // محادثة خاملة X ساعات
  | 'conversation_closed'          // محادثة مغلقة
  | 'conversation_reopened';       // محادثة أُعيد فتحها

export type AutomationAction =
  // ── الإشعارات والتواصل ───────────────────────────────
  | 'notify_admin'             // إشعار للمسؤول في لوحة التحكم
  | 'send_whatsapp'            // إرسال رسالة واتساب للعميل
  | 'send_messenger'           // إرسال رسالة ماسنجر للعميل
  | 'send_instagram_dm'        // إرسال رسالة إنستجرام للعميل
  | 'send_webchat_message'     // إرسال رسالة في شات الموقع
  | 'send_email'               // إرسال بريد إلكتروني
  | 'send_notification'        // إرسال إشعار مباشر للعميل
  | 'send_template_message'    // إرسال رسالة من قالب جاهز
  | 'send_to_all_channels'     // إرسال لكل القنوات دفعة واحدة
  // ── إدارة العميل ────────────────────────────────────
  | 'add_note'                 // إضافة ملاحظة للعميل تلقائياً
  | 'update_lead_status'       // تحديث حالة العميل المحتمل
  | 'add_followup_reminder'    // إضافة تذكير للمتابعة
  | 'enroll_course'            // تسجيل العميل في كورس
  | 'assign_staff'             // تعيين موظف للعميل
  | 'create_lead'              // إنشاء ليد جديد تلقائياً
  | 'pause_subscriber'         // إيقاف اشتراك مؤقتاً
  | 'resume_subscriber'        // استئناف الاشتراك
  // ── إدارة المحادثات ─────────────────────────────────
  | 'tag_conversation'         // وضع تاج على المحادثة
  | 'assign_conversation'      // تعيين المحادثة لموظف
  | 'close_conversation'       // إغلاق المحادثة
  | 'reopen_conversation'      // إعادة فتح المحادثة
  | 'escalate_to_human'        // تحويل للرد البشري
  | 'ai_auto_reply'            // رد AI تلقائي
  // ── الإجراءات الأخرى ────────────────────────────────
  | 'cancel_consultation'      // إلغاء الاستشارة تلقائياً
  | 'generate_certificate'     // إصدار شهادة تلقائياً
  | 'issue_refund';            // إصدار استرداد

export interface AutomationCondition {
  field: string;
  operator: 'equals' | 'contains' | 'greater_than' | 'less_than' | 'is_empty' | 'is_not_empty';
  value: string;
}

export interface AutomationWorkflow {
  id: string;
  name: string;
  description?: string;
  trigger: AutomationTrigger;
  conditions?: AutomationCondition[];
  action: AutomationAction;
  actionConfig: Record<string, string>; // e.g. { message, template, staffId, courseId, days }
  enabled: boolean;
  createdAt: string;
  lastTriggeredAt?: string;
  triggerCount?: number;
}

// ── AI Agent types ────────────────────────────────────────────────────────────

export type AiProvider = 'gemini' | 'openai' | 'claude';

export interface AiKnowledgeEntry {
  id: string;
  type: 'faq' | 'document' | 'context';
  title: string;
  content: string;
  createdAt: string;
}

export interface AdminAiConfig {
  provider: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
}

export interface AiAgentConfig {
  id: string;
  name: string;
  provider: AiProvider;
  apiKey: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
  enabledPages: string[]; // which pages to show the agent on
  knowledgeBase: AiKnowledgeEntry[];
  updatedAt: string;
}

// ── Messaging Channels types ──────────────────────────────────────────────────

export type MessagingChannel = 'whatsapp' | 'messenger' | 'instagram' | 'webchat';

export interface WhatsAppChannelConfig {
  enabled: boolean;
  phoneNumberId: string;
  whatsappBusinessAccountId: string;
  accessToken: string;
  webhookVerifyToken: string;
  businessName: string;
  welcomeMessage: string;
  awayMessage: string;
  aiEnabled: boolean;
  aiReplyMode: 'always' | 'away_only' | 'disabled';
}

export interface MessengerChannelConfig {
  enabled: boolean;
  pageId: string;
  pageAccessToken: string;
  appSecret: string;
  webhookVerifyToken: string;
  welcomeMessage: string;
  aiEnabled: boolean;
  aiReplyMode: 'always' | 'away_only' | 'disabled';
}

export interface InstagramChannelConfig {
  enabled: boolean;
  instagramAccountId: string;
  accessToken: string;
  appSecret: string;
  webhookVerifyToken: string;
  welcomeMessage: string;
  aiEnabled: boolean;
  aiReplyMode: 'always' | 'away_only' | 'disabled';
}

export interface WebChatConfig {
  enabled: boolean;
  widgetTitle: string;
  widgetSubtitle: string;
  widgetColor: string;
  primaryColor: string;
  widgetPosition: 'bottom-right' | 'bottom-left';
  welcomeMessage: string;
  awayMessage: string;
  agentName: string;
  agentAvatar: string;
  aiEnabled: boolean;
  aiReplyMode: 'always' | 'away_only' | 'disabled';
  showOnPages: string[];
}

export interface MessagingChannelsConfig {
  whatsapp: WhatsAppChannelConfig;
  messenger: MessengerChannelConfig;
  instagram: InstagramChannelConfig;
  webchat: WebChatConfig;
  updatedAt: string;
}

// ── Unified Inbox types ───────────────────────────────────────────────────────

export interface InboxMessage {
  id: string;
  conversationId: string;
  channel: MessagingChannel;
  direction: 'inbound' | 'outbound';
  senderName: string;
  senderId: string;
  content: string;
  messageType: 'text' | 'image' | 'audio' | 'document' | 'template';
  timestamp: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  isFromAgent: boolean;
  staffId?: string;
}

export interface InboxConversation {
  id: string;
  channel: MessagingChannel;
  contactName: string;
  contactId: string;
  contactAvatar?: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  status: 'open' | 'pending' | 'resolved' | 'spam';
  assignedToStaffId?: string;
  assignedToStaffName?: string;
  tags: string[];
  messages: InboxMessage[];
  linkedLeadId?: string;
  linkedSubscriberId?: string;
  createdAt: string;
}

// ── Facebook Lead Ads Integration ─────────────────────────────────────────────

export interface FacebookLeadFormEntry {
  formId: string;
  formName: string;
  enabled: boolean;
  lastLeadCount?: number;
  courseId?: string;
  branch?: BranchType;
}

export interface FacebookLeadAdsConfig {
  enabled: boolean;
  pageId: string;
  pageAccessToken: string;
  appId?: string;
  webhookVerifyToken: string;
  adForms: FacebookLeadFormEntry[];
  defaultLeadType: LeadType;
  defaultStatus: LeadStatus;
  defaultInterestedCourseId?: string;
  defaultBranch?: BranchType;
  defaultAssignedSalesId?: string;
  autoSyncEnabled: boolean;    // not used server-side, just a flag
  lastSyncAt?: string;
  totalImported?: number;
  updatedAt: string;
}

// ── Quiz System ────────────────────────────────────────────────────────────────

export interface QuizQuestion {
  id: string;
  question: string;
  options: [string, string, string, string]; // exactly 4 options
  correctIndex: 0 | 1 | 2 | 3;
  explanation?: string;
}

export interface CourseQuiz {
  id: string;
  courseId: string;
  title: string;
  questions: QuizQuestion[];
  passingScore: number; // percentage 0-100
  createdAt: string;
  updatedAt: string;
  generatedByAI: boolean;
  sourceMaterial?: string;
}

export interface QuizAttempt {
  id: string;
  subscriberId: string;
  courseId: string;
  quizId: string;
  answers: number[]; // selected option index per question
  score: number; // percentage 0-100
  passed: boolean;
  takenAt: string;
}

export interface LiveStream {
  id: string;
  title: string;
  instructorId?: string;
  instructorName: string;
  scheduledAt: string; // ISO datetime
  durationMinutes?: number;
  streamUrl: string;
  platform?: 'zoom' | 'youtube' | 'meet' | 'other';
  visibility: 'all_subscribers' | 'course_subscribers' | 'community_all' | 'community_and_subscribers';
  targetCourseIds: string[]; // empty means all courses
  status: 'upcoming' | 'live' | 'ended';
  recordingUrl?: string;
  description?: string;
  createdAt: string;
}