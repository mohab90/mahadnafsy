// useAutoResizableColumns — drag-to-resize for a table whose header is built elsewhere (the month sheet, «عملاء الدقي» and «عملاء الأونلاين», which share one table).
// It puts a grip on every header cell of the table it is given and remembers each column's width by the header's text, in localStorage, so a column
// someone hides or adds does not move the others' widths. The grip sits on the cell's trailing edge — the left one in the right-to-left tables of this
// app — and dragging it outward widens the column. Use with a ref on the <table>:
//   const table = useAutoResizableColumns('hr-month-sheet');   <table ref={table}>
// (components/useResizableCols.ts is the same idea for a table that lists its columns itself, the leads table.)

import { useEffect, useRef } from 'react';

const storeKey = (tableId: string) => `acol:${tableId}`;
const read = (tableId: string): Record<string, number> => {
  try { return JSON.parse(localStorage.getItem(storeKey(tableId)) || '{}') || {}; } catch { return {}; }
};
const write = (tableId: string, widths: Record<string, number>) => {
  try { localStorage.setItem(storeKey(tableId), JSON.stringify(widths)); } catch { /* storage may be blocked */ }
};
const GRIP = 'col-resize-grip';
const MIN_WIDTH = 48;

export function useAutoResizableColumns(tableId: string) {
  const ref = useRef<HTMLTableElement>(null);
  // After every render: a re-rendered header may have lost its grips or its saved widths.
  useEffect(() => {
    const table = ref.current;
    if (!table) return;
    const saved = read(tableId);
    const heads = Array.from(table.querySelectorAll<HTMLTableCellElement>('thead tr:first-child > th'));
    heads.forEach((th, index) => {
      const key = (th.textContent || '').trim() || `#${index}`;
      const width = saved[key];
      if (width) { th.style.width = `${width}px`; th.style.minWidth = `${width}px`; th.style.maxWidth = `${width}px`; }
      if (th.querySelector(`:scope > .${GRIP}`)) return;
      if (getComputedStyle(th).position === 'static') th.style.position = 'relative';
      const grip = document.createElement('span');
      grip.className = `${GRIP} resize-handle`;
      grip.setAttribute('aria-hidden', 'true');
      grip.addEventListener('mousedown', event => {
        event.preventDefault();
        event.stopPropagation();
        const rtl = getComputedStyle(table).direction === 'rtl';
        const startX = event.clientX;
        const startWidth = th.getBoundingClientRect().width;
        const onMove = (move: MouseEvent) => {
          const delta = rtl ? startX - move.clientX : move.clientX - startX;
          const next = Math.max(MIN_WIDTH, Math.round(startWidth + delta));
          th.style.width = `${next}px`; th.style.minWidth = `${next}px`; th.style.maxWidth = `${next}px`;
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          document.body.style.cursor = ''; document.body.style.userSelect = '';
          write(tableId, { ...read(tableId), [key]: Math.round(th.getBoundingClientRect().width) });
        };
        document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      th.appendChild(grip);
    });
  });
  return ref;
}
