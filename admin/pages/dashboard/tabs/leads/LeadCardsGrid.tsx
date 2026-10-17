import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Bundle, Course, LeadItem, LeadStatus } from '../../../../types';
import { LeadCard } from './LeadSubcomponents';

type ScoredLead = LeadItem & { _score?: number };

type LeadCardsGridProps = {
  rows: ScoredLead[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  canManageLeads: boolean;
  onSelect: (lead: LeadItem) => void;
  onStatusChange: (lead: LeadItem, status: LeadStatus) => void;
  onBook: (lead: LeadItem) => void;
  onContact: (lead: LeadItem) => void;
  onOutcomeRecorded: () => void;
  instituteBranches: { id: string; label: string }[];
  courses: Course[];
  bundles: Bundle[];
};

/**
 * The leads as cards, in the order the server gives them — newest first — four across on a desk, one column
 * on a phone. «نخلي ٤ أعمدة … ومتعملش الجديد في عمود والمهتم في عمود، لا بالترتيب عادي» (18 Oct 2026): the
 * cards used to be sorted into a column per status, which hid most of them behind «عرض أكثر»; the status is
 * a filter now (the bar above) and a chip on each card.
 *
 * It reads the same server page as the table (useServerLeadTable) under the same filters, so a card and its
 * table row are the same lead, and a lead that is not among the newest 500 held in memory still opens.
 */
export function LeadCardsGrid({
  rows, loading, error, onRetry, page, pageSize, total, onPageChange, canManageLeads, onSelect, onStatusChange,
  onBook, onContact, onOutcomeRecorded, instituteBranches, courses, bundles,
}: LeadCardsGridProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="space-y-3" dir="rtl">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          تعذّر تحميل العملاء: {error}
          <button type="button" onClick={onRetry} className="mr-2 underline">إعادة المحاولة</button>
        </div>
      )}
      {!error && rows.length === 0 && !loading && (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-16 text-center text-sm text-gray-400">لا توجد ليدز تطابق الفلاتر المختارة</div>
      )}
      <div className={`grid items-start gap-2.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 ${loading ? 'opacity-60' : ''}`}>
        {rows.map(lead => (
          <LeadCard
            key={lead.id}
            lead={lead}
            score={lead._score || 0}
            onSelect={() => onSelect(lead)}
            onStatusChange={status => onStatusChange(lead, status)}
            onBook={canManageLeads ? onBook : undefined}
            onContact={canManageLeads ? onContact : undefined}
            onOutcomeRecorded={onOutcomeRecorded}
            canManageLeads={canManageLeads}
            instituteBranches={instituteBranches}
            courses={courses}
            bundles={bundles}
          />
        ))}
      </div>
      {total > pageSize && (
        <div className="flex items-center justify-center gap-3 text-xs font-bold text-gray-600">
          <button type="button" disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)} aria-label="الصفحة السابقة"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white disabled:opacity-40"><ChevronRight size={16} /></button>
          <span>{page.toLocaleString('ar-EG-u-nu-latn')} من {pages.toLocaleString('ar-EG-u-nu-latn')} · {total.toLocaleString('ar-EG-u-nu-latn')} عميل</span>
          <button type="button" disabled={page >= pages || loading} onClick={() => onPageChange(page + 1)} aria-label="الصفحة التالية"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white disabled:opacity-40"><ChevronLeft size={16} /></button>
        </div>
      )}
    </div>
  );
}
