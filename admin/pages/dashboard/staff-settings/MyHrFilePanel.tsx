import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, TrendingDown, TrendingUp } from 'lucide-react';
import { adminAuthHeaders } from '../../../lib/adminAuthHeaders';

type PayrollPoint = {
  period: string; net: number; base: number; allowances: number;
  commission: number; bonus: number; deductions: number;
};
type Gap = { kind: string; label: string; severity: 'high' | 'medium' | 'low' };
type Doc = { id: string; title: string; category: string; file_name: string | null; expiry_date: string | null; created_at: string };
type HrFile = {
  profile: { name: string; role: string; department_name: string | null; employment_type: string | null;
    joined_at: string | null; hire_date: string | null; commission_rate: number | null } | null;
  payroll: PayrollPoint[];
  trend: { direction: 'up' | 'down' | 'flat'; changePct: number | null;
    from: string; to: string; fromNet: number; toNet: number } | null;
  documents: Doc[];
  salaryStructures: { base_salary: number; housing_allowance: number; transport_allowance: number;
    effective_from: string; status: string }[];
  gaps: Gap[];
  completeness: number;
};

const egp = (n: number) => Number(n || 0).toLocaleString('ar-EG');
const monthShort = (period: string) => {
  const [y, m] = period.split('-');
  return `${m}/${String(y).slice(2)}`;
};
const CATEGORY_AR: Record<string, string> = {
  contract: 'عقد', id: 'بطاقة', certificate: 'مؤهل', medical: 'طبي', other: 'أخرى',
};
const SEVERITY: Record<Gap['severity'], { cls: string; label: string }> = {
  high: { cls: 'bg-red-50 text-red-700 border-red-200', label: 'مطلوب' },
  medium: { cls: 'bg-amber-50 text-amber-700 border-amber-200', label: 'مهم' },
  low: { cls: 'bg-gray-50 text-gray-600 border-gray-200', label: 'تحسين' },
};

/**
 * Pay history as a bar chart. Hand-drawn rather than pulled from a chart
 * library: the panel is lazy-loaded inside the profile tab and a 250 kB
 * recharts bundle for eighteen bars is not a trade worth making.
 */
function PayTrajectory({ points }: { points: PayrollPoint[] }) {
  const max = useMemo(() => Math.max(1, ...points.map(p => p.net)), [points]);
  if (!points.length) {
    return <p className="text-sm text-gray-400 py-6 text-center">لا توجد كشوف رواتب معتمدة بعد.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-2 min-w-max h-40 px-1">
        {points.map(p => {
          const h = Math.max(4, Math.round((p.net / max) * 130));
          return (
            <div key={p.period} className="flex flex-col items-center gap-1 w-12">
              <span className="text-[9px] font-bold text-gray-500">{egp(p.net)}</span>
              <div
                className="w-8 rounded-t-lg bg-gradient-to-t from-indigo-600 to-indigo-400"
                style={{ height: `${h}px` }}
                title={`أساسي ${egp(p.base)} · بدلات ${egp(p.allowances)} · عمولة ${egp(p.commission)} · مكافأة ${egp(p.bonus)} · خصومات ${egp(p.deductions)}`}
              />
              <span className="text-[9px] text-gray-400">{monthShort(p.period)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function MyHrFilePanel() {
  const [data, setData] = useState<HrFile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/staff/me/hr-file', { credentials: 'include', headers: adminAuthHeaders() })
      .then(r => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 gap-3 text-gray-400 text-sm">
        <span className="w-5 h-5 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
        جاري تحميل ملفك الوظيفي...
      </div>
    );
  }
  if (!data) return <p className="text-sm text-gray-400 py-8 text-center">تعذر تحميل الملف الوظيفي.</p>;

  const { trend, completeness, gaps } = data;
  const latestStructure = data.salaryStructures.find(s => s.status === 'APPROVED') || data.salaryStructures[0];

  return (
    <div className="space-y-5" dir="rtl">
      {/* ── File completeness — the HR-officer view, missing items first ── */}
      <div className={`rounded-2xl border p-5 shadow-sm ${
        completeness >= 90 ? 'bg-emerald-50 border-emerald-200'
          : completeness >= 60 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="font-extrabold text-gray-900 flex items-center gap-2">
              {completeness >= 90 ? <CheckCircle2 size={17} className="text-emerald-600" />
                : <AlertTriangle size={17} className="text-amber-600" />}
              اكتمال ملفي الوظيفي
            </h3>
            <p className="text-xs text-gray-600 mt-0.5">
              {gaps.length === 0 ? 'ملفك مكتمل — لا ينقصك شيء.' : `ناقصك ${gaps.length} بند`}
            </p>
          </div>
          <span className="text-3xl font-black text-gray-900">{completeness}%</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70">
          <div className={`h-full rounded-full transition-all ${
            completeness >= 90 ? 'bg-emerald-500' : completeness >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
            style={{ width: `${completeness}%` }} />
        </div>
        {gaps.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {gaps.map(g => (
              <span key={g.kind + g.label}
                className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${SEVERITY[g.severity].cls}`}>
                {g.label} · {SEVERITY[g.severity].label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Pay trajectory ───────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <h3 className="font-extrabold text-gray-900 flex items-center gap-2">
            <TrendingUp size={16} className="text-indigo-500" /> مسار الراتب والحوافز
          </h3>
          {trend && (
            <span className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl ${
              trend.direction === 'up' ? 'bg-emerald-50 text-emerald-700'
                : trend.direction === 'down' ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
              {trend.direction === 'up' ? <TrendingUp size={13} />
                : trend.direction === 'down' ? <TrendingDown size={13} /> : null}
              {trend.direction === 'up' ? 'سلّم تصاعدي'
                : trend.direction === 'down' ? 'انخفاض' : 'ثابت'}
              {trend.changePct != null && ` ${trend.changePct > 0 ? '+' : ''}${trend.changePct}%`}
              <span className="font-normal text-[10px] opacity-70">
                {monthShort(trend.from)} → {monthShort(trend.to)}
              </span>
            </span>
          )}
        </div>
        <PayTrajectory points={data.payroll} />
        {latestStructure && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            {[
              ['الأساسي', latestStructure.base_salary],
              ['بدل سكن', latestStructure.housing_allowance],
              ['بدل مواصلات', latestStructure.transport_allowance],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-xl border border-gray-100 bg-gray-50/60 p-2.5">
                <p className="text-gray-500">{label}</p>
                <p className="font-extrabold text-gray-900">{egp(Number(value))} ج.م</p>
              </div>
            ))}
            <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-2.5">
              <p className="text-gray-500">نسبة العمولة</p>
              <p className="font-extrabold text-gray-900">{Number(data.profile?.commission_rate || 0)}%</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Documents on file ────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <h3 className="font-extrabold text-gray-900 flex items-center gap-2 mb-4">
          <FileText size={16} className="text-sky-500" /> أوراقي في ملفي
        </h3>
        {data.documents.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">لا توجد أوراق مرفوعة — تواصل مع الموارد البشرية.</p>
        ) : (
          <div className="space-y-1.5">
            {data.documents.map(d => {
              const expired = d.expiry_date && d.expiry_date < new Date().toISOString().slice(0, 10);
              return (
                <div key={d.id} className="flex items-center justify-between gap-2 border-b border-gray-50 pb-1.5 text-sm">
                  <div className="min-w-0">
                    <span className="font-bold text-gray-800">{d.title}</span>
                    <span className="text-[11px] text-gray-400 mr-2">{CATEGORY_AR[d.category] || d.category}</span>
                  </div>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                    expired ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {expired ? `منتهي ${d.expiry_date}` : d.expiry_date ? `ساري حتى ${d.expiry_date}` : 'مرفوع'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
