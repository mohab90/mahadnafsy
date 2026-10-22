// Who the payment dialog is for and what its caller hands it.
import type { ExtraCertificateRequest, PaymentHistoryEntry } from '../../types';
import type { PaymentDraft } from './paymentDraft';

export interface SubjectInfo {
  id: string;
  name: string;
  phone?: string;
  phone2?: string;
  /** A course placed in another branch than the client's: a payment for it is that branch's (lib/coursePlacement.ts). */
  coursePlacements?: Record<string, string>;
  enrolledCourseIds?: string[];
  paymentHistory?: PaymentHistoryEntry[];
  extraCertificateRequests?: ExtraCertificateRequest[];
  branch?: string;
  email?: string;
  /** Prices agreed per course/track, and money paid before the system (crm_json.priorPaid). */
  customPrices?: Record<string, number>;
  priorPaid?: Record<string, number>;
  /** Courses/tracks the caller knows the client holds though no enrolment says so — the
   *  Dokki desk passes the course of the round the payment is opened from. */
  heldItemIds?: string[];
}

export interface BranchOption { id: string; label: string; }

export interface PaymentModalProps {
  /**
   * 'subscriber' — an existing customer pays.
   * 'lead'     — a lead pays and becomes one.
   * 'new'      — the person does not exist yet: this form creates them and
   *              takes the first payment. Two screens had their own copy of
   *              that (the Daqqi desk and عملاء الأونلاين) and they disagreed
   *              about the fields, the rules and where the money went.
   */
  mode: 'lead' | 'subscriber' | 'new';
  subject: SubjectInfo;
  draft: PaymentDraft;
  setDraft: (d: PaymentDraft) => void;
  /** Parent should save data here. Component handles closing. */
  onSubmit: (draft: PaymentDraft, shouldPrint: boolean) => void | Promise<void>;
  /** Called when the modal should close (user cancelled or finished) */
  onClose: () => void;
  requirePaymentApproval?: boolean;
  /**
   * No discount, no other price: a collection account books at the price the
   * client agreed — «تغيير سعر الكورس بيتم من الحسابات او الادارة فقط». The
   * API ignores a price sent from one anyway (routes/subscriber-payments.js).
   */
  lockPrice?: boolean;
  branchOptions?: BranchOption[];
  /**
   * Who this payment could be for, when the screen was not opened from a
   * particular customer. الحسابات → «تسجيل دخل» starts from the money and
   * picks the person; every other entry point already knows them.
   *
   * Given, and with no subject.id yet, the screen renders the picker itself
   * rather than a second dialog in front of it.
   */
  subjectOptions?: { id: string; name: string; clientCode?: string }[];
  /**
   * The same picker for a screen that holds no list of clients: it searches the server while the person types (a name,
   * a phone or a code) and answers the matches. Must be stable between renders.
   */
  subjectSearch?: (term: string) => Promise<{ id: string; name: string; clientCode?: string }[]>;
  onSubjectChange?: (id: string) => void;
  instituteName?: string;
  branchLabel?: string;
}
