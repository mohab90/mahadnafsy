/**
 * Every table in the panel, readable on a phone.
 *
 * «كل صفحات الجداول على الموبايل مش ريسبونسيف ابدا وسيئة جدا» (17 Oct 2026). There are about 120 tables in 94
 * files, laid out for a desk; on a 375 px screen each was either squeezed to nothing or pushed the whole page
 * sideways. Rewriting them one by one is how it stays that way, so this turns a plain table into a stack of
 * cards on a phone — each row a card, each cell «label: value», the labels taken from the table's own header —
 * and leaves the table alone on anything wider (the CSS is in index.css, under `table.rt-stack`).
 *
 * A table that cannot be stacked safely — a spanning header, a cell that spans rows or columns, no header at all,
 * a very wide one — keeps its columns and scrolls sideways inside itself, never the page. `data-no-stack` on the
 * table or any ancestor opts out.
 */
const PHONE = '(max-width: 767px)';
const MAX_COLUMNS = 12;

const textOf = (cell: Element) => (cell.textContent || '').replace(/\s+/g, ' ').trim();

/** The header labels, or null when the table is not a simple grid. */
function labelsOf(table: HTMLTableElement): string[] | null {
  const headRows = Array.from(table.tHead?.rows || []);
  const headerRow = headRows[headRows.length - 1] || (table.rows[0] && table.rows[0].querySelector('th') ? table.rows[0] : null);
  if (!headerRow) return null;
  const cells = Array.from(headerRow.cells);
  if (cells.length < 2 || cells.length > MAX_COLUMNS) return null;
  if (cells.some(cell => cell.colSpan > 1 || cell.rowSpan > 1)) return null;
  return cells.map(textOf);
}

function stackable(table: HTMLTableElement, labels: string[]): boolean {
  if (table.closest('[data-no-stack]') || table.hasAttribute('data-no-stack')) return false;
  const bodyRows = Array.from(table.tBodies).flatMap(body => Array.from(body.rows));
  if (bodyRows.length === 0) return false;
  return bodyRows.every(row => {
    const cells = Array.from(row.cells);
    return cells.length === labels.length && cells.every(cell => cell.colSpan === 1 && cell.rowSpan === 1);
  });
}

function enhance(table: HTMLTableElement) {
  const labels = labelsOf(table);
  if (!labels || !stackable(table, labels)) { table.classList.remove('rt-stack'); return; }
  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      Array.from(row.cells).forEach((cell, index) => {
        if (cell.getAttribute('data-label') !== labels[index]) cell.setAttribute('data-label', labels[index]);
      });
    }
  }
  table.classList.add('rt-stack');
}

export function installMobileTables(): void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function' || typeof MutationObserver === 'undefined') return;
  const phone = window.matchMedia(PHONE);
  let scheduled = false;

  const run = () => {
    scheduled = false;
    if (!phone.matches) return;
    document.querySelectorAll<HTMLTableElement>('table').forEach(enhance);
  };
  const schedule = () => {
    if (scheduled || !phone.matches) return;
    scheduled = true;
    window.requestAnimationFrame(run);
  };

  // Rows come and go as a screen loads and pages; a table is looked at once the DOM settles, only on a phone.
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  phone.addEventListener('change', () => {
    if (phone.matches) schedule();
    else document.querySelectorAll('table.rt-stack').forEach(table => table.classList.remove('rt-stack'));
  });
  schedule();
}
