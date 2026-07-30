import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, Save, Target, TrendingUp, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type Period = {
  period: string;
  pipelineEgp: number;
  bestCaseEgp: number;
  commitEgp: number;
  weightedEgp: number;
  targetEgp: number;
  coverage: number | null;
  opportunityCount: number;
};
type Opportunity = {
  id: string;
  name: string;
  ownerName: string | null;
  dealValueEgp: number;
  category: 'pipeline' | 'best_case' | 'commit';
  categoryDerived: boolean;
  probability: number;
  probabilityDerived: boolean;
  expectedCloseDate: string | null;
  fallbackFollowUpDate: string | null;
  missingDealValue: boolean;
  missingExpectedClose: boolean;
};
type ForecastResponse = {
  generatedAt: string;
  currency: 'EGP';
  periods: Period[];
  history: Array<{ period: string; actualEgp: number }>;
  forecastAccuracy: Array<{
    period: string; pipelineEgp: number; bestCaseEgp: number; commitEgp: number;
    staffId: string; staffName: string; actualEgp: number; absoluteErrorEgp: number;
    accuracyPercent: number; submissionCount: number;
  }>;
  ownerRollups: Array<{
    staffId: string; staffName: string; pipelineEgp: number; bestCaseEgp: number;
    commitEgp: number; weightedEgp: number; opportunityCount: number;
  }>;
  opportunities: Opportunity[];
  submissions: Array<{
    id: string; period: string; staffId: string; staffName: string;
    pipelineEgp: number; bestCaseEgp: number; commitEgp: number;
    note: string | null; submittedAt: string;
  }>;
  sourceBreakdown: Array<{ source: string; actualEgp: number; paymentCount: number }>;
  dataQuality: {
    totalOpen: number; missingDealValue: number; missingExpectedClose: number;
    derivedCategory: number; derivedProbability: number; outsideHorizon: number;
  };
  methodology: {
    categoryProbability: Record<string, number>;
    actualSource: string;
    pipelineSource: string;
    missingClosePolicy: string;
  };
};
type PipelineMovements = {
  summary: Array<{ eventType: string; from: string | null; to: string | null; count: number; valueDeltaEgp: number }>;
  movements: Array<{
    id: string; leadId: string; leadName: string; ownerName: string | null;
    eventType: string; from: string | null; to: string | null; at: string;
  }>;
};

const money = (value: number) => Math.round(value || 0).toLocaleString('ar-EG');
const categoryLabel = {
  pipeline: 'Pipeline',
  best_case: 'Best case',
  commit: 'Commit',
};

function OpportunityRow({
  item, reload, notify,
}: { item: Opportunity; reload: () => Promise<void>; notify?: NotifyFn }) {
  const [category, setCategory] = useState(item.category);
  const [probability, setProbability] = useState(item.probability);
  const [expectedCloseDate, setExpectedCloseDate] = useState(item.expectedCloseDate || '');
  const [dealValueEgp, setDealValueEgp] = useState(item.dealValueEgp);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await mysqlAdmin.adminPatch(`/admin/crm/leads/${encodeURIComponent(item.id)}/forecast`, {
        category, probability, expectedCloseDate: expectedCloseDate || null, dealValueEgp,
      });
      notify?.('success', 'تم حفظ توقع الصفقة وربطه بالـCRM');
      await reload();
    } catch (error) {
      notify?.('error', error instanceof Error ? error.message : 'تعذر حفظ توقع الصفقة');
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr className="border-t border-gray-100 align-top">
      <td className="px-3 py-3">
        <div className="font-bold text-gray-900">{item.name}</div>
        <div className="text-xs text-gray-500">{item.ownerName || 'غير مسند'}</div>
      </td>
      <td className="px-2 py-3">
        <input className="w-28 rounded-lg border px-2 py-1.5 text-sm" type="number" min={0}
          value={dealValueEgp} onChange={event => setDealValueEgp(Number(event.target.value))} />
      </td>
      <td className="px-2 py-3">
        <select className="rounded-lg border px-2 py-1.5 text-sm" value={category}
          onChange={event => setCategory(event.target.value as Opportunity['category'])}>
          {Object.entries(categoryLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {item.categoryDerived && <div className="mt-1 text-[10px] text-amber-600">مستنتج مؤقتًا</div>}
      </td>
      <td className="px-2 py-3">
        <input className="w-20 rounded-lg border px-2 py-1.5 text-sm" type="number" min={0} max={100}
          value={probability} onChange={event => setProbability(Number(event.target.value))} />
      </td>
      <td className="px-2 py-3">
        <input className="rounded-lg border px-2 py-1.5 text-sm" type="date"
          value={expectedCloseDate} onChange={event => setExpectedCloseDate(event.target.value)} />
        {!expectedCloseDate && item.fallbackFollowUpDate && (
          <div className="mt-1 text-[10px] text-amber-600">يعتمد مؤقتًا على المتابعة</div>
        )}
      </td>
      <td className="px-2 py-3">
        <button type="button" onClick={save} disabled={saving}
          className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
          {saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />} حفظ
        </button>
      </td>
    </tr>
  );
}

export default function CrmForecastWorkspace({ notify }: { notify?: NotifyFn }) {
  const [months, setMonths] = useState(3);
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [pipelineMovements, setPipelineMovements] = useState<PipelineMovements>({ summary: [], movements: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [forecast, movements] = await Promise.all([
        mysqlAdmin.adminGet<ForecastResponse>(`/admin/crm/forecast?months=${months}`),
        mysqlAdmin.adminGet<PipelineMovements>('/admin/crm/pipeline-movements?days=7'),
      ]);
      setData(forecast);
      setPipelineMovements(movements);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر تحميل توقعات CRM');
    } finally {
      setLoading(false);
    }
  }, [months]);

  useEffect(() => { void load(); }, [load]);

  const chart = useMemo(() => [
    ...(data?.history || []).map(item => ({ period: item.period, actual: item.actualEgp })),
    ...(data?.periods || []).map(item => ({
      period: item.period, weighted: item.weightedEgp, commit: item.commitEgp,
    })),
  ], [data]);
  const current = data?.periods[0];
  const qualityIssues = data
    ? data.dataQuality.missingDealValue + data.dataQuality.missingExpectedClose
    : 0;
  const kpis: Array<{ label: string; value: number | string; Icon: LucideIcon }> = [
    { label: 'Pipeline', value: current?.pipelineEgp || 0, Icon: Target },
    { label: 'Best case', value: current?.bestCaseEgp || 0, Icon: TrendingUp },
    { label: 'Commit', value: current?.commitEgp || 0, Icon: Save },
    { label: 'Weighted', value: current?.weightedEgp || 0, Icon: Users },
    { label: 'Coverage', value: current?.coverage == null ? '—' : `${current.coverage.toFixed(2)}x`, Icon: Target },
  ];

  const submit = async () => {
    if (!current) return;
    setSubmitting(true);
    try {
      await mysqlAdmin.adminPost('/admin/crm/forecast/submissions', {
        period: current.period,
        pipelineEgp: current.pipelineEgp,
        bestCaseEgp: current.bestCaseEgp,
        commitEgp: current.commitEgp,
        note,
      });
      setNote('');
      notify?.('success', 'تم حفظ Forecast snapshot بدون تعديل بيانات الصفقات');
      await load();
    } catch (reason) {
      notify?.('error', reason instanceof Error ? reason.message : 'تعذر إرسال التوقع');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !data) return <div className="py-20 text-center text-gray-500">جاري تحميل توقعات CRM…</div>;
  if (error && !data) return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-red-700">
      <p>{error}</p>
      <button type="button" onClick={() => void load()} className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-white">إعادة المحاولة</button>
    </div>
  );
  if (!data) return null;

  return (
    <div className="space-y-5" dir="rtl">
      <div className="rounded-2xl bg-gradient-to-l from-indigo-700 to-blue-600 p-5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-black"><TrendingUp size={22} /> Pipeline Forecast</h2>
            <p className="mt-1 text-sm text-blue-100">مصدر واحد من Payments وCRM؛ كل مبلغ بالجنيه المصري</p>
          </div>
          <div className="flex items-center gap-2">
            {[1, 3, 6, 12].map(value => (
              <button key={value} type="button" onClick={() => setMonths(value)}
                className={`rounded-lg px-3 py-1.5 text-sm font-bold ${months === value ? 'bg-white text-indigo-700' : 'bg-white/15'}`}>
                {value} شهر
              </button>
            ))}
            <button type="button" onClick={() => void load()} className="rounded-lg bg-white/15 p-2" aria-label="تحديث">
              <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {kpis.map(({ label, value, Icon }) => (
          <div key={label} className="rounded-2xl border bg-white p-4">
            <div className="flex items-center gap-1 text-xs text-gray-500"><Icon size={14} />{label}</div>
            <div className="mt-1 text-xl font-black text-gray-900">
              {typeof value === 'number' ? `${money(value)} ج.م` : value}
            </div>
          </div>
        ))}
      </div>

      {qualityIssues > 0 && (
        <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="shrink-0" size={20} />
          <div>
            <div className="font-bold">جودة بيانات الـPipeline تحتاج استكمال</div>
            <div>بدون قيمة: {data.dataQuality.missingDealValue} · بدون تاريخ إغلاق/متابعة: {data.dataQuality.missingExpectedClose} · خارج المدى: {data.dataQuality.outsideHorizon}</div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border bg-white p-4">
        <h3 className="mb-4 font-bold">الإيراد الفعلي مقابل التوقع المرجّح والـCommit</h3>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={chart}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="period" />
            <YAxis tickFormatter={money} />
            <Tooltip formatter={(value: number) => `${money(value)} ج.م`} />
            <Area dataKey="actual" name="فعلي" stroke="#059669" fill="#d1fae5" />
            <Area dataKey="weighted" name="مرجّح" stroke="#4f46e5" fill="#e0e7ff" />
            <Area dataKey="commit" name="Commit" stroke="#ea580c" fill="#ffedd5" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white">
        <div className="border-b p-4 font-bold">تفصيل الفترات</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500"><tr>
              {['الفترة','الفرص','Pipeline','Best case','Commit','Weighted','Target','Coverage'].map(label => <th key={label} className="px-3 py-2 text-right">{label}</th>)}
            </tr></thead>
            <tbody>{data.periods.map(item => <tr key={item.period} className="border-t">
              <td className="px-3 py-2 font-bold">{item.period}</td><td className="px-3 py-2">{item.opportunityCount}</td>
              <td className="px-3 py-2">{money(item.pipelineEgp)}</td><td className="px-3 py-2">{money(item.bestCaseEgp)}</td>
              <td className="px-3 py-2">{money(item.commitEgp)}</td><td className="px-3 py-2">{money(item.weightedEgp)}</td>
              <td className="px-3 py-2">{money(item.targetEgp)}</td><td className="px-3 py-2">{item.coverage == null ? '—' : `${item.coverage.toFixed(2)}x`}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </div>

      {data.forecastAccuracy.length > 0 && (
        <div className="overflow-hidden rounded-2xl border bg-white">
          <div className="border-b p-4 font-bold">دقة التوقعات المغلقة</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500"><tr>
                {['الفترة', 'الموظف', 'Commit', 'الفعلي', 'الفرق المطلق', 'الدقة', 'عدد التقديمات'].map(label => <th key={label} className="px-3 py-2 text-right">{label}</th>)}
              </tr></thead>
              <tbody>{data.forecastAccuracy.map(item => <tr key={item.period} className="border-t">
                <td className="px-3 py-2 font-bold">{item.period}</td>
                <td className="px-3 py-2">{item.staffName || item.staffId}</td>
                <td className="px-3 py-2">{money(item.commitEgp)}</td>
                <td className="px-3 py-2">{money(item.actualEgp)}</td>
                <td className="px-3 py-2">{money(item.absoluteErrorEgp)}</td>
                <td className="px-3 py-2 font-bold">{item.accuracyPercent.toFixed(1)}%</td>
                <td className="px-3 py-2">{item.submissionCount}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </div>
      )}

      {pipelineMovements.movements.length > 0 && (
        <div className="overflow-hidden rounded-2xl border bg-white">
          <div className="border-b p-4 font-bold">حركة الـPipeline خلال 7 أيام</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500"><tr>
                {['الوقت', 'العميل', 'المسؤول', 'نوع الحركة', 'من', 'إلى'].map(label => <th key={label} className="px-3 py-2 text-right">{label}</th>)}
              </tr></thead>
              <tbody>{pipelineMovements.movements.slice(0, 100).map(item => <tr key={item.id} className="border-t">
                <td className="px-3 py-2 text-xs">{new Date(item.at).toLocaleString('ar-EG')}</td>
                <td className="px-3 py-2 font-bold">{item.leadName}</td>
                <td className="px-3 py-2">{item.ownerName || 'غير مسند'}</td>
                <td className="px-3 py-2">{item.eventType}</td>
                <td className="px-3 py-2">{item.from || '—'}</td>
                <td className="px-3 py-2">{item.to || '—'}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-2xl border bg-white p-4">
        <h3 className="font-bold">اعتماد Snapshot للفترة {current?.period}</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <input value={note} onChange={event => setNote(event.target.value)} maxLength={1000}
            placeholder="تعليق الإدارة أو السيلز على التوقع" className="min-w-64 flex-1 rounded-xl border px-3 py-2" />
          <button type="button" onClick={submit} disabled={!current || submitting}
            className="rounded-xl bg-indigo-600 px-4 py-2 font-bold text-white disabled:opacity-50">
            حفظ Forecast
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white">
        <div className="border-b p-4 font-bold">تهيئة الفرص الأعلى قيمة</div>
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 text-gray-500"><tr>
              {['العميل/المسؤول','القيمة EGP','الفئة','الاحتمال %','الإغلاق المتوقع',''].map(label => <th key={label} className="px-3 py-2 text-right">{label}</th>)}
            </tr></thead>
            <tbody>{data.opportunities.slice(0, 100).map(item => (
              <OpportunityRow key={item.id} item={item} reload={load} notify={notify} />
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
