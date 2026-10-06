import type { PaymentDraft } from '../components/PaymentModal';
import { mysqlAdmin } from './mysqlapi';
import { bookingTierFields } from './bookingIdentity';

/**
 * Create a customer who does not exist yet, and take their first payment.
 *
 * Two screens did this, each its own way, and the difference was not cosmetic:
 *
 *   عملاء الأونلاين posted to /admin/subscriber-payments — the endpoint that
 *   writes the subscriber and the payment in one transaction, posts the
 *   double-entry journal, and honours the "payments need approval" setting.
 *
 *   The Daqqi desk called saveSubscriber with a paymentHistory array it built
 *   in the browser. That writes the money onto the subscriber record and
 *   nowhere else: no payments row, no journal line, no approval. Cash taken at
 *   the front desk never reached the books, which is why the same booking
 *   could be counted in one place and missing from another.
 *
 * Both go through here now, and here goes through the endpoint.
 *
 * A course payment must name exactly one course or bundle — that rule is the
 * API's, enforced in the browser too so the desk is told before the request
 * rather than after. A carnet, a book or anything else names none: it asked
 * for a course regardless, so a new client could not be booked a carnet at all.
 * What the dialog added beside the first item is recorded after it, each its
 * own payment on the client the first one made. Enrolling with no money is
 * allowed and takes the other branch.
 */

export type NewClientResult = {
  subscriberId?: string;
  /** The payment was recorded as pending because the caller cannot approve it. */
  approvalRequired: boolean;
  /** True when a payment was recorded; false when the customer was only created. */
  paid: boolean;
  /**
   * Nothing was created: a collection account's new customer waits for the
   * manager to confirm the transfer (api/routes/subscriber-payments.js).
   */
  pendingReview?: boolean;
  /** «تسكين» with the booking: how seating the client in the chosen round went. */
  housed?: string;
};

export async function createClientWithPayment(
  draft: PaymentDraft,
  options: { branch: string; source: string },
): Promise<NewClientResult> {
  const name = (draft.name || '').trim();
  const phone = (draft.phone || '').trim();
  if (!name || !phone) throw new Error('الاسم والهاتف مطلوبان.');

  const amount = Number(draft.amount) || 0;
  if (!Number.isFinite(amount) || amount < 0) throw new Error('قيمة الدفعة غير صحيحة');

  const branch = (draft.branch || options.branch || '').trim() || options.branch;
  const subscriber = {
    name,
    phone,
    email: (draft.email || '').trim(),
    branch,
    notes: draft.note || undefined,
    source: options.source,
  };

  if (amount === 0) {
    // No money yet — just the person. saveSubscriber is the right call here:
    // there is no payment to journal.
    // POST /api/admin/subscribers answers { ok, id, ... } — the field is `id`,
    // not `subscriberId` the payments endpoint uses.
    const created = await mysqlAdmin.adminPost<{ ok: boolean; id?: string }>(
      '/admin/subscribers', { ...subscriber, isActive: true },
    );
    // No payment to carry the round, so the client is seated on their own.
    let housed: string | undefined;
    if (draft.daqqiRoundId && created?.id) {
      housed = await mysqlAdmin.addDaqqiAttendee(draft.daqqiRoundId, created.id).then(() => 'seated', () => 'failed');
    }
    return { subscriberId: created?.id, approvalRequired: false, paid: false, ...(housed ? { housed } : {}) };
  }

  if (!draft.paymentMethod) throw new Error('اختر وسيلة الدفع قبل تسجيل الدفعة');
  const paymentType = draft.paymentType || 'course';
  if (paymentType === 'course' && !draft.courseId) throw new Error('اختر كورس أو باقة لربط الدفعة');

  const isBundle = paymentType === 'course' && draft.courseId.startsWith('bundle:');
  const item = paymentType !== 'course' ? {} : isBundle ? { bundleId: draft.courseId.slice(7) } : { courseId: draft.courseId };
  const result = await mysqlAdmin.adminPost<{
    ok: boolean; subscriberId: string; approvalRequired?: boolean; status?: string; housed?: string;
  }>('/admin/subscriber-payments', {
    subscriber,
    ...(draft.daqqiRoundId ? { daqqiRoundId: draft.daqqiRoundId } : {}),
    payment: {
      amount,
      currency: draft.currency,
      paymentType,
      isInstallment: paymentType === 'course' && draft.bookingType === 'installment',
      ...item,
      courseExpected: paymentType === 'course' ? (Number(draft.customExpected) || undefined) : undefined,
      paymentMethod: draft.paymentMethod,
      transactionId: draft.transactionId || undefined,
      fromAccountNumber: draft.fromAccountNumber || undefined,
      at: draft.date,
      note: draft.note || undefined,
      source: options.source,
      // The branch tier and the client's real name (lib/bookingIdentity.ts); the server prices it.
      ...(paymentType === 'course' && draft.bookingType === 'new_booking' ? bookingTierFields(draft) : {}),
      branch,
    },
  });

  // The carnet, the book, the added course: each on the client just made. A
  // booking waiting for the manager has no client yet, and says so instead.
  const extras = (draft.extraItems || []).filter(extra => Number(extra.amount) > 0);
  if (extras.length && result?.subscriberId) {
    for (const extra of extras) {
      const extraBundle = extra.type === 'course' && String(extra.courseId || '').startsWith('bundle:');
      await mysqlAdmin.saveSubscriberPayment(result.subscriberId, {
        amount: Number(extra.amount),
        currency: draft.currency,
        paymentType: extra.type,
        isInstallment: false,
        ...(extra.type === 'course' && extra.courseId
          ? (extraBundle ? { bundleId: String(extra.courseId).slice(7) } : { courseId: extra.courseId })
          : {}),
        ...(extra.type === 'course' && Number(extra.customExpected) > 0 ? { courseExpected: Number(extra.customExpected) } : {}),
        paymentMethod: draft.paymentMethod,
        at: draft.date,
        note: [extra.label, draft.note].filter(Boolean).join(' | ') || undefined,
        source: options.source,
        branch,
      });
    }
  }

  return {
    subscriberId: result?.subscriberId,
    approvalRequired: !!result?.approvalRequired,
    paid: true,
    pendingReview: result?.status === 'pending_review',
    ...(result?.housed ? { housed: result.housed } : {}),
  };
}
