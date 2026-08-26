// Number formatting for the HR screens.
//
// Latin digits inside Arabic text on purpose — 'ar-EG' alone renders Arabic-Indic
// numerals, which the rest of the admin does not use.

export const fmt = (n: number) => n.toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 0 });
export const fmtMoney = (n: number) => `${fmt(n)} ج.م`;
