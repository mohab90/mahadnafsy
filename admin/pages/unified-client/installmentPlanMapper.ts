import type { InstallmentEntry, InstallmentPlan } from '../../types';

interface ServerInstallmentPlanRow {
  id: string;
  course_id: string | null;
  bundle_id: string | null;
  title: string | null;
  total_amount: number;
  currency: 'EGP' | 'SAR' | 'USD';
  installment_amounts: string | number[];
  due_dates: string | (string | null)[];
  paid_dates: string | (string | null)[];
  paid_amounts: string | (number | null)[];
  notes: string | null;
  created_at: string;
}

function parseArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

export function mapServerInstallmentPlan(value: unknown): InstallmentPlan {
  const row = value as ServerInstallmentPlanRow;
  const amounts = parseArray<number>(row.installment_amounts);
  const dueDates = parseArray<string | null>(row.due_dates);
  const paidDates = parseArray<string | null>(row.paid_dates);
  const paidAmounts = parseArray<number | null>(row.paid_amounts);
  const entries: InstallmentEntry[] = amounts.map((amount, index) => ({
    id: String(index),
    amount,
    currency: row.currency,
    dueDate: dueDates[index] || '',
    paidAt: paidDates[index] || undefined,
    paidAmount: paidAmounts[index] ?? undefined,
  }));
  return {
    id: row.id,
    courseId: row.course_id || (row.bundle_id ? `bundle:${row.bundle_id}` : undefined),
    courseTitle: row.title || undefined,
    totalAmount: Number(row.total_amount),
    currency: row.currency,
    entries,
    notes: row.notes || undefined,
    createdAt: row.created_at,
  };
}
