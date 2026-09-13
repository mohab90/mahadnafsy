import { cairoDateOnly, cairoDaysAgo, cairoMonthOnly } from '../../shared/cairoDate';

/**
 * Where a «آخر ٧ أيام» / «هذا الشهر» filter starts.
 *
 * Five screens declared their own `getRangeStart` — تبويب التسويق, فريق
 * الأونلاين, مركز المبيعات, تقارير المبيعات and أداء الموظفين — three of them
 * byte-identical. All five built the boundary the same wrong way:
 *
 *   new Date(+d - 7 * 86400000).toISOString().slice(0, 10)
 *
 * which is UTC, so for the three hours after midnight Cairo the window started
 * a day early, and month arithmetic on milliseconds ignores a daylight-saving
 * change. cairoDaysAgo subtracts whole days from the institute's day instead.
 *
 * Two vocabularies had grown up for the same thing — '7d' and 'week', '3months'
 * and ninety days — so both are accepted rather than forcing five screens to
 * rename their filter buttons.
 */
export type RangeKey =
  | 'today'
  | '7d' | 'week'
  | '30d'
  | 'month'
  | '3months'
  | 'all' | string;

/**
 * The oldest date a row may carry and still be in range, as `YYYY-MM-DD`.
 *
 * Named ...Date because three of the five screens already hold this function's
 * result in a local called `rangeStart`, and an import of the same name
 * shadows it — TypeScript reports it as a variable used before its own
 * declaration, which is a confusing way to learn about a name collision.
 */
export function rangeStartDate(range: RangeKey): string {
  switch (range) {
    case 'today': return cairoDateOnly();
    case '7d':
    case 'week': return cairoDaysAgo(7);
    case '30d': return cairoDaysAgo(30);
    case '3months': return cairoDaysAgo(90);
    case 'month': return `${cairoMonthOnly()}-01`;
    // 'all', and anything a screen invents later. Old enough to include every
    // row the institute has, without pretending to be a real date.
    default: return '2000-01-01';
  }
}
