import { TrendingDown, TrendingUp } from 'lucide-react';
import type { Compare } from './managementFigures';
import { count } from './managementFigures';

/** The change against the previous equal period: an arrow and a percentage, and "—" when there was nothing before to compare with. */
export default function ChangeBadge({ vs, lowerIsBetter }: { vs: Compare | undefined; lowerIsBetter?: boolean }) {
  if (!vs) return null;
  const title = `قبلها: ${count(vs.before)}`;
  if (vs.changePct === null) return <span className="text-[11px] text-gray-400" title={title}>{vs.change ? `+${count(vs.change)} (جديد)` : '—'}</span>;
  const good = lowerIsBetter ? vs.change <= 0 : vs.change >= 0;
  const Icon = vs.change >= 0 ? TrendingUp : TrendingDown;
  return (
    <span title={title} className={`inline-flex items-center gap-0.5 text-[11px] font-bold ${good ? 'text-emerald-600' : 'text-rose-600'}`}>
      <Icon size={11} />{vs.changePct > 0 ? '+' : ''}{count(vs.changePct)}٪
    </span>
  );
}
