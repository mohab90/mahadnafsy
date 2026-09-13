/**
 * dashboardExports.ts — pure CSV export helpers extracted from Dashboard.tsx.
 * Each function takes its data as arguments (no component-state coupling) and
 * triggers a browser download. UTF-8 BOM prefix keeps Arabic readable in Excel.
 */
import type { OrderItem, SubscriberItem, Bundle, Course } from '../../types';
import { cairoDateOnly } from '../../../shared/cairoDate';
import { downloadCsv as writeCsv } from '../../../shared/csv';

/** Every file here is stamped with the day it was taken. */
function downloadCsv(rows: (string | number | undefined)[][], filename: string): void {
  writeCsv(`${filename}-${cairoDateOnly()}`, rows);
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

