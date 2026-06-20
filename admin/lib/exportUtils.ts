/**
 * exportUtils.ts — PDF + Excel export helpers for admin finance/report pages
 * Uses: write-excel-file (Excel), jspdf + jspdf-autotable (PDF)
 */
// Heavy export libraries (jspdf ~680kB, write-excel-file ~60kB) are loaded
// lazily via dynamic import() so they only download when the user actually
// triggers an export — keeping them out of the initial bundle.
import type { Cell, SheetData } from 'write-excel-file/browser';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface ExportColumn {
  header: string;   // Column header text (Arabic OK)
  key: string;      // Key in row data object
  width?: number;   // Excel column width (chars)
  format?: (v: unknown) => string; // Custom formatter
}

export interface ExportOptions {
  filename: string;         // Without extension
  title?: string;           // Sheet / PDF title
  subtitle?: string;        // PDF subtitle
  dir?: 'rtl' | 'ltr';     // Default: rtl
}

// ── Excel Export ─────────────────────────────────────────────────────────────
export async function exportToExcel<T extends Record<string, unknown>>(
  rows: T[],
  columns: ExportColumn[],
  opts: ExportOptions,
): Promise<void> {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const sheetData: SheetData = [
    columns.map<Cell>(c => ({
      value: c.header,
      fontWeight: 'bold',
      align: 'center',
      backgroundColor: '#eef2ff',
    })),
    ...rows.map(row =>
      columns.map<Cell>(c => {
        const val = row[c.key];
        return {
          value: c.format ? c.format(val) : String(val ?? ''),
          align: (opts.dir ?? 'rtl') === 'rtl' ? 'right' : 'left',
        };
      }),
    ),
  ];

  void writeExcelFile(sheetData, {
    sheet: opts.title?.slice(0, 31) ?? 'Sheet1',
    columns: columns.map(c => ({ width: c.width ?? 20 })),
    rightToLeft: (opts.dir ?? 'rtl') === 'rtl',
    stickyRowsCount: 1,
  }).toFile(`${opts.filename}.xlsx`).catch((err: unknown) => {
    console.error('[exportToExcel]', err);
  });
}

// ── PDF Export ────────────────────────────────────────────────────────────────
export async function exportToPDF<T extends Record<string, unknown>>(
  rows: T[],
  columns: ExportColumn[],
  opts: ExportOptions,
): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // Title
  if (opts.title) {
    doc.setFontSize(16);
    doc.text(opts.title, doc.internal.pageSize.width / 2, 15, { align: 'center' });
  }
  if (opts.subtitle) {
    doc.setFontSize(10);
    doc.text(opts.subtitle, doc.internal.pageSize.width / 2, 22, { align: 'center' });
  }

  const head = [columns.map(c => c.header)];
  const body = rows.map(row =>
    columns.map(c => {
      const val = row[c.key];
      return c.format ? c.format(val) : String(val ?? '');
    }),
  );

  autoTable(doc, {
    head,
    body,
    startY: opts.title ? 28 : 10,
    styles: { fontSize: 9, cellPadding: 3, halign: 'right' },
    headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold', halign: 'center' },
    alternateRowStyles: { fillColor: [245, 245, 255] },
    tableWidth: 'auto',
    margin: { left: 10, right: 10 },
  });

  // Footer with date
  const pages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.text(
      `تاريخ التصدير: ${new Date().toLocaleDateString('ar-EG')} | صفحة ${i} من ${pages}`,
      doc.internal.pageSize.width / 2,
      doc.internal.pageSize.height - 5,
      { align: 'center' },
    );
  }

  doc.save(`${opts.filename}.pdf`);
}

// ── Convenience: export both ──────────────────────────────────────────────────
export async function exportData<T extends Record<string, unknown>>(
  rows: T[],
  columns: ExportColumn[],
  opts: ExportOptions,
  format: 'pdf' | 'excel' | 'both' = 'excel',
): Promise<void> {
  if (format === 'excel' || format === 'both') await exportToExcel(rows, columns, opts);
  if (format === 'pdf'   || format === 'both') await exportToPDF(rows, columns, opts);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export const fmtCurrency = (v: unknown, currency = 'EGP') =>
  `${Number(v || 0).toLocaleString('ar-EG')} ${currency}`;

export const fmtDate = (v: unknown) =>
  v ? new Date(v as string).toLocaleDateString('ar-EG') : '—';

export const fmtNum = (v: unknown) =>
  Number(v || 0).toLocaleString('ar-EG');
