/**
 * dashboardExports.ts — pure CSV export helpers extracted from Dashboard.tsx.
 * Each function takes its data as arguments (no component-state coupling) and
 * triggers a browser download. UTF-8 BOM prefix keeps Arabic readable in Excel.
 */
import type { OrderItem, SubscriberItem, Bundle, Course } from '../../types';

function csvEscape(value: string | number | undefined): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function downloadCsv(rows: (string | number | undefined)[][], filename: string): void {
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Export the currently-filtered orders list. */
export function exportOrdersCsv(filteredOrders: OrderItem[]): void {
  if (filteredOrders.length === 0) return;
  const header = ['order_id', 'item_title', 'type', 'customer_name', 'payment_method', 'amount', 'currency', 'status', 'created_at'];
  const rows = filteredOrders.map(row => [
    row.id, row.itemTitle, row.type, row.customerName,
    row.paymentMethod, row.amount, row.currency, row.status, row.createdAt,
  ]);
  downloadCsv([header, ...rows], 'orders');
}

/** Export subscribers with resolved branch labels + course names. */
export function exportSubscribersCsv(
  subscribers: SubscriberItem[],
  bundles: Bundle[],
  courses: Course[],
  branchLabelMap: Record<string, string>,
): void {
  if (subscribers.length === 0) return;
  const branchLabel = (b?: string) => branchLabelMap[b || ''] || b || '';
  const header = ['معرف', 'الاسم', 'الهاتف', 'البريد', 'الفرع', 'الحالة', 'تاريخ التسجيل', 'الكورسات', 'عدد الكورسات', 'اسم السيلز', 'ملاحظات'];
  const rows = subscribers.map(s => [
    s.id, s.name, s.phone, s.email || '',
    branchLabel(s.branch), s.status, s.createdAt?.slice(0, 10) || '',
    (() => {
      const cIds = s.enrolledCourseIds || [];
      const cBnds = bundles.filter(b => b.courses.length > 0 && b.courses.every(co => cIds.includes(co.id)));
      const hIds = new Set(cBnds.flatMap(b => b.courses.map(co => co.id)));
      return [...cBnds.map(b => b.title), ...cIds.filter(id => !hIds.has(id)).map(id => courses.find(c => c.id === id)?.title || id)].join(' | ');
    })(),
    (s.enrolledCourseIds || []).length,
    s.assignedSalesName || '', s.notes || '',
  ]);
  downloadCsv([header, ...rows], 'subscribers');
}

/** Export the leads list. */
export function exportLeadsCsv(leads: { id: string; name: string; phone: string; email?: string; status: string; source?: string; branch?: string; leadType?: string; assignedSalesName?: string; createdAt?: string; notes?: string }[]): void {
  if (leads.length === 0) return;
  const header = ['id', 'name', 'phone', 'email', 'status', 'source', 'branch', 'leadType', 'assignedSalesName', 'createdAt', 'notes'];
  const rows = leads.map(r => [r.id, r.name, r.phone, r.email, r.status, r.source, r.branch, r.leadType, r.assignedSalesName, r.createdAt, r.notes]);
  downloadCsv([header, ...rows], 'leads');
}
