// Order rows as they arrive from /api/admin/orders.
//
// That route returns the orders table and, after it, every manual payment no
// order covers, marked source:'crm'. The first load and the reload after a
// payment is confirmed each mapped the rows by hand, and both dropped the mark
// — so every desk payment reached the vault looking like a Paymob order, and
// was taken out of its own box because of it.

import type { OrderItem } from '../../types';

export function normalizeOrders(rows: unknown): OrderItem[] {
  return (rows as Record<string, unknown>[]).map(row => ({
    id: row.id as string,
    subscriberId: (row.subscriberId ?? row.subscriber_id ?? undefined) as string | undefined,
    type: String(row.type || 'course').toLowerCase() as OrderItem['type'],
    itemId: (row.itemId ?? row.item_id ?? '') as string,
    itemTitle: (row.itemTitle ?? row.item_title ?? '') as string,
    amount: Number(row.amount) || 0,
    currency: (row.currency || 'EGP') as OrderItem['currency'],
    paymentMethod: (row.paymentMethod ?? row.payment_method ?? 'wallet') as OrderItem['paymentMethod'],
    customerName: (row.customerName ?? row.customer_name ?? '') as string,
    customerEmail: (row.customerEmail ?? row.customer_email ?? '') as string,
    status: String(row.status || 'paid').toLowerCase() as OrderItem['status'],
    createdAt: (row.createdAt ?? row.created_at ?? '') as string,
    // Selected by the route and dropped here, so revenue-by-course collapsed
    // into a single «غير محدد» row and revenue-by-type into «أخرى».
    courseId: (row.courseId ?? row.course_id ?? undefined) as string | undefined,
    bundleId: (row.bundleId ?? row.bundle_id ?? undefined) as string | undefined,
    paidAt: (row.paidAt ?? row.paid_at ?? undefined) as string | undefined,
    transactionId: (row.transactionId ?? row.transaction_id) as string | undefined,
    staffId: (row.staffId ?? row.staff_id ?? undefined) as string | undefined,
    staffName: (row.staffName ?? row.staff_name ?? undefined) as string | undefined,
    linkedTransferId: (row.linkedTransferId ?? row.linked_transfer_id ?? undefined) as string | undefined,
    // Resolved server-side through the subscriber. The screen that reads it used
    // to look the lead up in the full leads array, which is what kept that array
    // on the revenue screen.
    leadSource: (row.leadSource ?? row.lead_source ?? undefined) as string | undefined,
    source: (row.source ?? undefined) as string | undefined,
  }));
}

/**
 * A paid order that came through Paymob. A desk payment is never one — its box
 * is whatever the desk wrote, «wallet» and «card» included — unless the payment
 * row itself says Paymob.
 */
export function isOnlinePaidOrder(order: OrderItem): boolean {
  if (order.status !== 'paid') return false;
  return order.source !== 'crm' || String(order.paymentMethod || '').toLowerCase().includes('paymob');
}
