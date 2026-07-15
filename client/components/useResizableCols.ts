// useResizableCols — drag-to-resize table columns, persisted in localStorage
// Usage:
//   const { colWidth, startResize } = useResizableCols('leads', { name: 180, phone: 130 });
//   <th style={{ width: colWidth('name') }} className="relative ...">
//     الاسم
//     <span onMouseDown={e => startResize('name', e)} className="resize-handle" />
//   </th>
//   Add .resize-handle styles via Tailwind or index.css

import { useCallback, useRef, useState } from 'react';

type ColWidths = Record<string, number>;

export function useResizableCols(tableId: string, defaults: ColWidths) {
  const [widths, setWidths] = useState<ColWidths>(() => {
    try {
      const saved = localStorage.getItem(`rcol:${tableId}`);
      return saved ? { ...defaults, ...JSON.parse(saved) } : { ...defaults };
    } catch {
      return { ...defaults };
    }
  });

  // Use a ref so the mousemove closure always sees fresh width
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  const startResize = useCallback(
    (colKey: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = widthsRef.current[colKey] ?? defaults[colKey] ?? 120;

      const onMove = (mv: MouseEvent) => {
        const newW = Math.max(48, startW + mv.clientX - startX);
        setWidths(prev => {
          const next = { ...prev, [colKey]: newW };
          try { localStorage.setItem(`rcol:${tableId}`, JSON.stringify(next)); } catch { /* ignore */ }
          return next;
        });
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [tableId, defaults]
  );

  const colWidth = (key: string) => widths[key] ?? defaults[key] ?? 120;

  const resetWidths = useCallback(() => {
    try { localStorage.removeItem(`rcol:${tableId}`); } catch { /* ignore */ }
    setWidths({ ...defaults });
  }, [tableId, defaults]);

  return { colWidth, startResize, resetWidths };
}
