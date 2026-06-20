/**
 * Shared TypeScript types used across admin dashboard tab components.
 * Import from here instead of redefining in each file.
 */

/** Notification callback passed to tab components. */
export type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

/** Payment history entry on a subscriber. */
export interface PaymentEntry {
  id?: string;
  at?: string;
  amount?: number;
  currency?: string;
  method?: string;
  note?: string;
}

/** Installment plan entry. */
export interface InstallmentEntry {
  id: string;
  dueDate: string;
  amount: number;
  currency?: string;
  paidAt?: string | null;
  paidAmount?: number;
}

/** Installment plan on a subscriber. */
export interface InstallmentPlan {
  id: string;
  totalAmount: number;
  currency?: string;
  entries: InstallmentEntry[];
}

/** Lightweight subscriber item (used across multiple tab contexts). */
export interface SubscriberItem {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  clientStatus?: string;
  courseId?: string;
  courseName?: string;
  createdAt?: string;
  paymentHistory?: PaymentEntry[];
  installmentPlans?: InstallmentPlan[];
  [key: string]: unknown;
}

/** Staff member record. */
export interface StaffMember {
  id: string;
  name: string;
  phone: string;
  email: string;
  image?: string | null;
  role?: string;
  department?: string;
  is_active?: number | boolean;
}

/** Lead record for CRM. */
export interface LeadItem {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  status?: string;
  source?: string;
  assignedTo?: string | null;
  createdAt?: string;
  [key: string]: unknown;
}

/** Course item. */
export interface CourseItem {
  id: string;
  title: string;
  slug?: string;
  isPublished?: boolean;
  price?: { EGP?: number; SAR?: number; USD?: number };
  [key: string]: unknown;
}
