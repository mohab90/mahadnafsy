// ── Tooltip formatting helpers for recharts ──────────────────────────────────
// recharts hands a tooltip formatter `ValueType | undefined`, where ValueType is
// `string | number | Array<string | number>` — not the plain `number` these
// charts all assumed. Typing the callback as `(v: number)` therefore does not
// satisfy the prop, which is what every chart tab was failing on.

/** Coerce whatever recharts passes into a number, including a range's first value. */
export const asNumber = (value: unknown): number => {
  if (Array.isArray(value)) return Number(value[0]) || 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Wrap a plain numeric formatter so it matches the signature recharts expects.
 *
 *   <Tooltip formatter={numericTooltip(v => [`${fmtMoney(v)} ج`, ''])} />
 */
export const numericTooltip =
  <R,>(format: (value: number) => R) =>
    (value: unknown): R => format(asNumber(value));
