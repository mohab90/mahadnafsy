import { AlertTriangle, FilterX, RefreshCw, Settings2, UserCheck } from 'lucide-react';

type LeadEmptyDiagnosticsProps = {
  visible: boolean;
  isSalesOnly: boolean;
  salesDataLoading?: boolean;
  totalLeads: number;
  effectiveCount: number;
  visibleCount: number;
  filtersActive: boolean;
  currentStaffName?: string;
  onClearFilters: () => void;
  onReload: () => void;
  onOpenLeadSources?: () => void;
};

export function LeadEmptyDiagnostics({
  visible,
  isSalesOnly,
  salesDataLoading,
  totalLeads,
  effectiveCount,
  visibleCount,
  filtersActive,
  currentStaffName,
  onClearFilters,
  onReload,
  onOpenLeadSources,
}: LeadEmptyDiagnosticsProps) {
  if (!visible || visibleCount > 0) return null;

  const staffLabel = currentStaffName?.trim() || 'الحساب الحالي';
  const noRawData = totalLeads === 0;
  const noScopedData = !noRawData && effectiveCount === 0;
  const icon = salesDataLoading ? <RefreshCw className="animate-spin" size={18} /> : <AlertTriangle size={18} />;

  let title = 'لا توجد ليدز ظاهرة الآن';
  let message = 'البيانات وصلت، لكن شروط العرض الحالية لا تُظهر أي نتيجة.';

  if (salesDataLoading) {
    title = 'جاري تحميل بيانات الليدز';
    message = 'انتظر لحظات، أو أعد التحميل لو استمر الفراغ بعد انتهاء التحميل.';
  } else if (noRawData) {
    title = 'لا توجد ليدز محملة من المصدر';
    message = 'مصادر الليد أو المزامنة لم ترسل بيانات قابلة للعرض حتى الآن.';
  } else if (isSalesOnly && noScopedData) {
    title = 'لا توجد ليدز مسندة لهذا الحساب';
    message = `${staffLabel} لا يملك ليدز ضمن نطاق الصلاحية الحالي رغم وجود بيانات عامة في النظام.`;
  } else if (filtersActive) {
    title = 'الفلاتر الحالية تخفي الليدز';
    message = 'امسح الفلاتر أو غيّر الفرع/الحالة/المصدر لإظهار النتائج المتاحة.';
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950" dir="rtl">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-white text-amber-700 shadow-sm">
            {icon}
          </div>
          <div>
            <h3 className="text-sm font-extrabold">{title}</h3>
            <p className="mt-1 text-xs leading-5 text-amber-800">{message}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold text-amber-900">
              <span className="rounded-full bg-white/80 px-2.5 py-1">إجمالي النظام: {totalLeads}</span>
              <span className="rounded-full bg-white/80 px-2.5 py-1">داخل الصلاحية: {effectiveCount}</span>
              <span className="rounded-full bg-white/80 px-2.5 py-1">ظاهر بعد الفلاتر: {visibleCount}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 md:justify-end">
          {filtersActive && (
            <button
              type="button"
              onClick={onClearFilters}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-extrabold text-amber-900 shadow-sm transition hover:bg-amber-100"
            >
              <FilterX size={14} />
              مسح الفلاتر
            </button>
          )}
          <button
            type="button"
            onClick={onReload}
            className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-extrabold text-amber-900 shadow-sm transition hover:bg-amber-100"
          >
            <RefreshCw size={14} />
            إعادة تحميل
          </button>
          {onOpenLeadSources && (
            <button
              type="button"
              onClick={onOpenLeadSources}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-900 px-3 py-2 text-xs font-extrabold text-white shadow-sm transition hover:bg-amber-800"
            >
              {isSalesOnly ? <UserCheck size={14} /> : <Settings2 size={14} />}
              مصادر الليد
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
