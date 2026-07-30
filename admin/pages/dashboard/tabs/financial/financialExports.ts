import { exportToExcel, exportToPDF, fmtCurrency, fmtDate } from '../../../../lib/exportUtils';
import type { ExpenseItem, OrderItem, SubscriberItem } from '../../../../types';

type ContentMap = Record<string, string>;

const toEgpWith = (content: ContentMap) => {
  const rates = {
    SAR: Number(content['exchange.sar_to_egp']),
    USD: Number(content['exchange.usd_to_egp']),
  };
  const updatedAt = new Date(content['exchange.updated_at'] || '').getTime();
  const fresh = Number.isFinite(updatedAt) && Date.now() - updatedAt <= 48 * 3600000 && updatedAt <= Date.now();
  return (amount: number, currency: string) => {
    const normalized = String(currency || 'EGP').toUpperCase();
    if (normalized === 'EGP') return amount;
    if (!fresh || !['SAR', 'USD'].includes(normalized) || !Number.isFinite(rates[normalized as 'SAR' | 'USD'])) {
      throw new Error(`لا يمكن تصدير ${normalized} بدون سعر صرف حديث ومعتمد`);
    }
    return amount * rates[normalized as 'SAR' | 'USD'];
  };
};

const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

export const exportCSV = (filename: string, rows: string[][], headers: string[]) => {
  const bom = '\uFEFF';
  const lines = [headers.map(csvCell).join(','), ...rows.map(row => row.map(csvCell).join(','))];
  const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export function exportFullFinancialReport(params: {
  content: ContentMap;
  orders: OrderItem[];
  subscribers: SubscriberItem[];
  expenses: ExpenseItem[];
  officialTotals: { totalRevenue: number; totalExpenses: number; netProfit: number; margin: number };
}) {
  const { content, orders, subscribers, expenses, officialTotals } = params;
  const toEGP = toEgpWith(content);
  const sections: string[] = [];
  const row = (...cols: (string | number)[]) => cols.map(csvCell).join(',');

  sections.push('=== ملخص مالي ===');
  sections.push(row('الإيرادات الإجمالية (ج.م)', 'المصروفات الإجمالية (ج.م)', 'صافي الربح (ج.م)', 'هامش الربح %'));

  const paidOnlineOrders = orders.filter(order =>
    order.status === 'paid' &&
    (
      order.paymentMethod === 'card' ||
      order.paymentMethod === 'wallet' ||
      order.paymentMethod === 'online_paymob' ||
      (order as unknown as Record<string, unknown>).source !== 'crm'
    )
  );
  const manualPayments = subscribers.flatMap(subscriber =>
    (subscriber.paymentHistory ?? []).filter(payment =>
      (!payment.status || payment.status === 'paid') &&
      (payment.paymentMethod || '') !== 'online_paymob' &&
      !(payment.paymentMethod || '').includes('Paymob')
    )
  );

  paidOnlineOrders.forEach(order => { toEGP(order.amount, order.currency); });
  manualPayments.forEach(payment => { toEGP(payment.amount, payment.currency); });
  expenses.forEach(expense => { toEGP(expense.amount, expense.currency); });
  const totalRevenue = officialTotals.totalRevenue;
  const totalExpenses = officialTotals.totalExpenses;
  const netProfit = officialTotals.netProfit;
  sections.push(row(
    Math.round(totalRevenue),
    Math.round(totalExpenses),
    Math.round(netProfit),
    `${officialTotals.margin}%`,
  ));
  sections.push('');

  sections.push('=== المدفوعات ===');
  sections.push(row('التاريخ', 'العميل', 'الخدمة', 'المبلغ (ج.م)', 'العملة', 'المبلغ المحوّل (ج.م)', 'القناة', 'الموظف', 'ملاحظة', 'النوع'));
  for (const order of paidOnlineOrders) {
    sections.push(row(
      (order.paidAt || order.createdAt || '').slice(0, 10),
      order.customerName || '—',
      order.itemTitle || '—',
      order.amount,
      order.currency,
      Math.round(toEGP(order.amount, order.currency)),
      'أونلاين Paymob',
      (order as unknown as Record<string, unknown>).staffName as string || '—',
      order.transactionId ? `#${order.transactionId}` : '—',
      'أونلاين',
    ));
  }

  for (const subscriber of subscribers) {
    const rows = (subscriber.paymentHistory ?? []).filter(payment =>
      (!payment.status || payment.status === 'paid') &&
      (payment.paymentMethod || '') !== 'online_paymob' &&
      !(payment.paymentMethod || '').includes('Paymob')
    );
    for (const payment of rows) {
      sections.push(row(
        (payment.at || '').slice(0, 10),
        subscriber.name,
        payment.paymentType || 'دفعة',
        payment.amount,
        payment.currency || 'EGP',
        Math.round(toEGP(payment.amount, payment.currency || 'EGP')),
        payment.paymentMethod || 'غير محدد',
        payment.staffName || '—',
        payment.note || '—',
        'يدوي',
      ));
    }
  }
  sections.push('');

  sections.push('=== المصروفات ===');
  sections.push(row('التاريخ', 'الفئة', 'الوصف', 'المبلغ', 'العملة', 'المبلغ المحوّل (ج.م)'));
  for (const expense of expenses) {
    sections.push(row(expense.date, expense.category, expense.description, expense.amount, expense.currency, Math.round(toEGP(expense.amount, expense.currency))));
  }

  const blob = new Blob(['\uFEFF' + sections.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `تقرير-مالي-شامل-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportPaymentsExcelReport(params: {
  content: ContentMap;
  orders: OrderItem[];
  subscribers: SubscriberItem[];
}) {
  const { content, orders, subscribers } = params;
  const toEGP = toEgpWith(content);
  type PaymentRow = { date: string; client: string; service: string; amount: string; currency: string; egp: string; channel: string; staff: string; note: string };
  const rows: PaymentRow[] = [];

  for (const subscriber of subscribers) {
    for (const payment of (subscriber.paymentHistory ?? []).filter(payment => !payment.status || payment.status === 'paid')) {
      rows.push({
        date: (payment.at || '').slice(0, 10),
        client: subscriber.name,
        service: payment.paymentType || 'دفعة',
        amount: String(payment.amount),
        currency: payment.currency || 'EGP',
        egp: String(Math.round(toEGP(payment.amount, payment.currency || 'EGP'))),
        channel: payment.paymentMethod || '—',
        staff: payment.staffName || '—',
        note: payment.note || '',
      });
    }
  }

  for (const order of orders.filter(item => item.status === 'paid')) {
    rows.push({
      date: (order.paidAt || order.createdAt || '').slice(0, 10),
      client: order.customerName || '—',
      service: order.itemTitle || '—',
      amount: String(order.amount),
      currency: order.currency,
      egp: String(Math.round(toEGP(order.amount, order.currency))),
      channel: 'Paymob',
      staff: '—',
      note: order.transactionId ? `#${order.transactionId}` : '',
    });
  }

  rows.sort((a, b) => b.date.localeCompare(a.date));
  void exportToExcel(rows, [
    { header: 'التاريخ', key: 'date', width: 12 },
    { header: 'العميل', key: 'client', width: 25 },
    { header: 'الخدمة', key: 'service', width: 20 },
    { header: 'المبلغ', key: 'amount', width: 12 },
    { header: 'العملة', key: 'currency', width: 8 },
    { header: 'بالجنيه', key: 'egp', width: 14 },
    { header: 'القناة', key: 'channel', width: 14 },
    { header: 'الموظف', key: 'staff', width: 18 },
    { header: 'ملاحظة', key: 'note', width: 25 },
  ], { filename: `المدفوعات-${new Date().toISOString().slice(0, 10)}`, title: 'تقرير المدفوعات' });
}

export function exportExpensesPdfReport(expenses: ExpenseItem[]) {
  const rows = expenses.map(expense => ({
    date: fmtDate(expense.date),
    category: expense.category,
    description: expense.description,
    amount: fmtCurrency(expense.amount, expense.currency),
    currency: expense.currency,
  }));

  void exportToPDF(rows, [
    { header: 'التاريخ', key: 'date', width: 14 },
    { header: 'الفئة', key: 'category', width: 16 },
    { header: 'الوصف', key: 'description', width: 40 },
    { header: 'المبلغ', key: 'amount', width: 18 },
  ], {
    filename: `المصروفات-${new Date().toISOString().slice(0, 10)}`,
    title: 'تقرير المصروفات',
    subtitle: `إجمالي: ${expenses.length} بند`,
  });
}
