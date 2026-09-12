import type { PaymentDraft } from '../components/PaymentModal';
import { mysqlAdmin } from './mysqlapi';

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
 * A payment must name exactly one course or bundle — that rule is the API's,
 * enforced in the browser too so the desk is told before the request rather
 * than after. Enrolling with no money is allowed and takes the other branch.
 */

export type NewClientResult = {
  subscriberId?: string;
  /** The payment was recorded as pending because the caller cannot approve it. */
  approvalRequired: boolean;
  /** True when a payment was recorded; false when the customer was only created. */
  paid: boolean;
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
    return { subscriberId: created?.id, approvalRequired: false, paid: false };
  }

  if (!draft.paymentMethod) throw new Error('اختر وسيلة الدفع قبل تسجيل الدفعة');
  if (!draft.courseId) throw new Error('اختر كورس أو باقة لربط الدفعة');

  const isBundle = draft.courseId.startsWith('bundle:');
  const result = await mysqlAdmin.adminPost<{
    ok: boolean; subscriberId: string; approvalRequired?: boolean;
  }>('/admin/subscriber-payments', {
    subscriber,
    payment: {
      amount,
      currency: draft.currency,
      paymentType: draft.paymentType || 'course',
      isInstallment: draft.bookingType === 'installment',
      ...(isBundle ? { bundleId: draft.courseId.slice(7) } : { courseId: draft.courseId }),
      courseExpected: Number(draft.customExpected) || undefined,
      paymentMethod: draft.paymentMethod,
      transactionId: draft.transactionId || undefined,
      fromAccountNumber: draft.fromAccountNumber || undefined,
      at: draft.date,
      note: draft.note || undefined,
      source: options.source,
      branch,
    },
  });

  return {
    subscriberId: result?.subscriberId,
    approvalRequired: !!result?.approvalRequired,
    paid: true,
  };
}
