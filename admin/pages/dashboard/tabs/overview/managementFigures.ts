import type { CsvValue } from '../../../../../shared/csv';

/**
 * «تقارير الإدارة» on the overview page: the shapes the server answers (api/lib/managementReports.js) and the arithmetic the screen does on
 * them — sorting, the CSV of exactly the rows shown, and the words for a refusal. Nothing is summed here: every figure is the server's.
 */
export type Compare = { before: number; change: number; changePct: number | null };
export type PeriodKey = 'today' | 'week' | 'last_week' | 'month' | 'last_month' | 'custom';
export type PeriodRange = { key: PeriodKey; from: string; to: string; days: number; previous: { from: string; to: string } };

export type EmployeeRow = {
  id: string; name: string; role: string;
  calls: number; whatsapp: number; leads: number; clientsHanded: number;
  bookings: number; bookingClients: number;
  bookingsEgp: number; installmentsEgp: number; certificatesEgp: number; otherEgp: number; other: Record<string, number>; collectedEgp: number;
  conversionPct: number | null; avgTicketEgp: number | null; followUpsDue: number; followUpsOverdue: number;
  vsBookings: Compare; vsCollected: Compare;
};
export type EmployeeTotals = Omit<EmployeeRow, 'id' | 'name' | 'role' | 'other'>;
export type EmployeeReport = { period: PeriodRange; rows: EmployeeRow[]; totals: EmployeeTotals; unattributed: { bookings: number; collectedEgp: number }; scope: 'all' | 'branch' };

export type BranchFigures = {
  key: string; label: string;
  incomeEgp: number; bookingsEgp: number; installmentsEgp: number; certificatesEgp: number; otherEgp: number;
  other: { kind: string; label: string; egp: number }[];
  refundsEgp: number; expensesEgp: number; netEgp: number;
  expensesByCategory: { category: string; label: string; egp: number }[];
  bookings: number; bookingClients: number; newClients: number; returningClients: number; returningBookings: number; avgTicketEgp: number | null;
  instalmentsDue: number; instalmentsPaid: number; instalmentsDueEgp: number; instalmentsPaidEgp: number; collectionRatePct: number | null;
  unconverted: { payments: number; byCurrency: Record<string, number> };
  topCourses: { item: string; title: string; egp: number }[];
  vs: Record<'incomeEgp' | 'bookingsEgp' | 'installmentsEgp' | 'certificatesEgp' | 'otherEgp' | 'expensesEgp' | 'netEgp' | 'bookings' | 'newClients' | 'returningClients', Compare>;
};
export type SeriesPoint = { label: string; from: string; branches: Record<string, { incomeEgp: number; expensesEgp: number; netEgp: number }>; total: { incomeEgp: number; expensesEgp: number; netEgp: number } };
export type BranchReport = { period: PeriodRange; branches: BranchFigures[]; total: BranchFigures; series: { weekly: SeriesPoint[]; monthly: SeriesPoint[] } | null; scope: 'all' | 'branch' };

export const PERIOD_LABELS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'النهارده' }, { key: 'week', label: 'الأسبوع ده' }, { key: 'last_week', label: 'الأسبوع اللي فات' },
  { key: 'month', label: 'الشهر ده' }, { key: 'last_month', label: 'الشهر اللي فات' }, { key: 'custom', label: 'فترة مخصصة' },
];

/** The query string of a period; a custom one carries its two days. */
export function periodQuery(period: PeriodKey, from: string, to: string): string {
  const params = new URLSearchParams({ period });
  if (period === 'custom') { params.set('from', from); params.set('to', to); }
  return params.toString();
}

/** The server refused: the account may not read these reports (a permission, or a data scope that is not the whole institute or one branch). */
export const isRefusal = (error: unknown) => /مفيش عندك صلاحية|للإدارة بس|مش من صلاحياتك|Admin only/.test(error instanceof Error ? error.message : String(error));

export const money = (value: number | null | undefined) => (value === null || value === undefined ? '—' : Math.round(value).toLocaleString('ar-EG-u-nu-latn'));
export const count = (value: number | null | undefined) => (value === null || value === undefined ? '—' : value.toLocaleString('ar-EG-u-nu-latn'));
export const percent = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${value.toLocaleString('ar-EG-u-nu-latn')}٪`);

export type EmployeeColumn = {
  key: keyof EmployeeTotals | 'name'; label: string; hint: string; kind: 'text' | 'count' | 'money' | 'percent';
};
export const EMPLOYEE_COLUMNS: EmployeeColumn[] = [
  { key: 'name', label: 'الموظف', hint: 'موظف مبيعات أو تحصيل أو دعم', kind: 'text' },
  { key: 'calls', label: 'مكالمات', hint: 'المكالمات اللي سجّلها في سجل التواصل خلال الفترة', kind: 'count' },
  { key: 'whatsapp', label: 'واتساب', hint: 'رسائل واتساب بعتها بنفسه (من صندوق الفريق أو سجل العميل). رسالة العميل ورد البوت مش محسوبين، والرسالة بتتعد مرة واحدة', kind: 'count' },
  { key: 'leads', label: 'ليدز جاتله', hint: 'الليدز اللي اتسلّمت له خلال الفترة (تاريخ التسليم)', kind: 'count' },
  { key: 'bookings', label: 'حجوزات', hint: 'أول دفعة كورس أو مسار لكل عميل على نفس الكورس، بعملاء الموظف', kind: 'count' },
  { key: 'bookingClients', label: 'لكام عميل', hint: 'عدد العملاء المختلفين في الحجوزات دي', kind: 'count' },
  { key: 'bookingsEgp', label: 'حجوزات (ج)', hint: 'فلوس الحجز نفسه', kind: 'money' },
  { key: 'installmentsEgp', label: 'أقساط (ج)', hint: 'فلوس الأقساط واللي اتدفع بعد الحجز على نفس الكورس', kind: 'money' },
  { key: 'certificatesEgp', label: 'شهادات (ج)', hint: 'فلوس الشهادات (تحصيل مش مبيعات)', kind: 'money' },
  { key: 'otherEgp', label: 'أخرى (ج)', hint: 'كارنيهات وكتب واستشارات', kind: 'money' },
  { key: 'collectedEgp', label: 'حصّل (ج)', hint: 'المجموع. الحجز بيتحسب لموظف المبيعات بتاع العميل، وباقي الفلوس لموظف التحصيل بتاعه (وإلا للمبيعات)', kind: 'money' },
  { key: 'conversionPct', label: 'تحويل', hint: 'الحجوزات ÷ الليدز اللي جاتله', kind: 'percent' },
  { key: 'avgTicketEgp', label: 'متوسط الحجز (ج)', hint: 'فلوس الحجوزات ÷ عددها', kind: 'money' },
  { key: 'followUpsDue', label: 'متابعات', hint: 'ليدز مفتوحة ميعاد متابعتها الحالي واقع في الفترة (التاريخ بيتغير لما المتابعة تتعمل)', kind: 'count' },
];

export type SortState = { key: EmployeeColumn['key']; descending: boolean };

/** The rows in the order picked; text by Arabic collation, a missing figure last whichever way. */
export function sortEmployees(rows: EmployeeRow[], sort: SortState): EmployeeRow[] {
  const sign = sort.descending ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = a[sort.key as keyof EmployeeRow] as unknown; const y = b[sort.key as keyof EmployeeRow] as unknown;
    if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
    if (y === null || y === undefined) return -1;
    if (typeof x === 'string' || typeof y === 'string') return sign * String(x).localeCompare(String(y), 'ar');
    return sign * ((x as number) - (y as number));
  });
}

const cell = (value: unknown): CsvValue => (value === null || value === undefined ? '' : (value as CsvValue));

/** The CSV of exactly the rows on screen, in the order shown, with the totals row last. */
export function employeeCsv(report: EmployeeReport, rows: EmployeeRow[]): CsvValue[][] {
  const columns = EMPLOYEE_COLUMNS;
  return [
    ['تقرير الموظفين', `${report.period.from} → ${report.period.to}`],
    columns.map(column => column.label),
    ...rows.map(row => columns.map(column => cell(row[column.key as keyof EmployeeRow]))),
    columns.map((column, index) => (index === 0 ? 'الإجمالي' : cell(report.totals[column.key as keyof EmployeeTotals]))),
  ];
}

/** The branch table as a CSV: one row per figure, a column per branch and the total. */
export function branchCsv(report: BranchReport): CsvValue[][] {
  const columns = [...report.branches, report.total];
  const lines: [string, (b: BranchFigures) => CsvValue][] = [
    ['الدخل الإجمالي', b => b.incomeEgp], ['الحجوزات', b => b.bookingsEgp], ['الأقساط', b => b.installmentsEgp], ['الشهادات', b => b.certificatesEgp], ['أخرى', b => b.otherEgp],
    ...Array.from(new Set(columns.flatMap(b => b.other.map(line => line.label)))).map((label): [string, (b: BranchFigures) => CsvValue] => [`  ${label}`, b => b.other.find(line => line.label === label)?.egp ?? 0]),
    ['مسترد', b => b.refundsEgp], ['المصاريف', b => b.expensesEgp], ['الصافي', b => b.netEgp],
    ['حجوزات (عدد)', b => b.bookings], ['عملاء جدد', b => b.newClients], ['عملاء قدام حجزوا جديد', b => b.returningClients],
    ['متوسط الحجز', b => cell(b.avgTicketEgp)], ['أقساط مستحقة', b => b.instalmentsDue], ['أقساط اتحصّلت', b => b.instalmentsPaid], ['نسبة التحصيل ٪', b => cell(b.collectionRatePct)],
  ];
  return [
    ['تقرير الفروع', `${report.period.from} → ${report.period.to}`, `قبلها: ${report.period.previous.from} → ${report.period.previous.to}`],
    ['', ...columns.map(b => b.label)],
    ...lines.map(([label, read]) => [label, ...columns.map(read)]),
  ];
}
