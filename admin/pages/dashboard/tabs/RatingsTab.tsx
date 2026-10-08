import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, RefreshCw, Search, Star, Trash2 } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { useSiteData } from '../../../context/SiteDataContext';
import { confirmDialog } from '../../../../shared/ui/confirmDialog';
import { cairoDay } from '../../../../shared/cairoDate';
import { RATING_QUESTIONS, satisfactionOf, type RatingScores } from '../../../lib/clientRatings';
import { ClientsAtRiskPanel } from './ClientsAtRiskPanel';

// «صفحه اسمها التقييمات لخدمه العملاء وللادارة ولفرع الدقي ايضا» (8 Oct 2026):
// every rating a housed client gave their round — the four scores, the note,
// who wrote it down — with the averages by question and by lecturer.
type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type RatingRow = {
  id: string; subscriberId: string; subscriberName: string; phone: string; clientCode: string | null;
  roundId: string | null; roundCode: string | null; branch: string | null; courseTitle: string | null;
  instructorName: string | null; scores: RatingScores; average: number; note: string | null; by: string | null; at: string;
};
const mean = (values: number[]) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : 0);
const MOOD_CLS: Record<string, string> = { 'راضي': satisfactionOf(10).cls, 'متوسط': satisfactionOf(5).cls, 'مستاء': satisfactionOf(0).cls };
const scoreCls = (value: number) => (value >= 8 ? 'text-emerald-700' : value >= 5 ? 'text-amber-700' : 'text-rose-700');

export default function RatingsTab({ notify }: { notify: NotifyFn }) {
  const navigate = useNavigate();
  const { isAdmin } = useSiteData();
  const [rows, setRows] = useState<RatingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [mood, setMood] = useState('');
  const [round, setRound] = useState('');
  const [lecturer, setLecturer] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const list = await mysqlAdmin.adminGet<RatingRow[]>(`/admin/client-ratings${params.toString() ? `?${params}` : ''}`);
      setRows(Array.isArray(list) ? list : []);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحميل التقييمات');
    } finally { setLoading(false); }
  }, [notify, from, to]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(row => {
      if (mood && satisfactionOf(row.average).label !== mood) return false;
      if (round && row.roundCode !== round) return false;
      if (lecturer && row.instructorName !== lecturer) return false;
      if (!q) return true;
      return [row.subscriberName, row.phone, row.clientCode, row.courseTitle, row.note, row.roundCode]
        .some(value => String(value || '').toLowerCase().includes(q));
    });
  }, [rows, mood, round, lecturer, query]);

  const summary = useMemo(() => ({
    average: mean(shown.map(row => row.average)),
    byQuestion: RATING_QUESTIONS.map(({ key, label }) => ({ label, value: mean(shown.map(row => row.scores[key])) })),
    moods: ['راضي', 'متوسط', 'مستاء'].map(label => ({ label, count: shown.filter(row => satisfactionOf(row.average).label === label).length })),
    lecturers: Object.entries(shown.reduce<Record<string, number[]>>((acc, row) => {
      const name = row.instructorName || 'من غير محاضر';
      (acc[name] ||= []).push(row.scores.instructor);
      return acc;
    }, {})).map(([name, values]) => ({ name, value: mean(values), count: values.length })).sort((a, b) => b.value - a.value),
  }), [shown]);
  const options = useMemo(() => ({
    rounds: [...new Set(rows.map(row => row.roundCode).filter(Boolean) as string[])].sort(),
    lecturers: [...new Set(rows.map(row => row.instructorName).filter(Boolean) as string[])].sort(),
  }), [rows]);

  const remove = async (row: RatingRow) => {
    if (!await confirmDialog(`حذف تقييم ${row.subscriberName}؟`)) return;
    try {
      await mysqlAdmin.adminDelete(`/admin/client-ratings/${encodeURIComponent(row.id)}`);
      notify('success', 'اتحذف التقييم');
      void load();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر الحذف'); }
  };

  const selectCls = 'rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold text-slate-700';
  const overall = satisfactionOf(summary.average);
  return (
    <div className="space-y-4" dir="rtl">
      <ClientsAtRiskPanel />
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-extrabold text-slate-900"><Star size={20} className="text-yellow-500" /> التقييمات</h2>
            <p className="mt-0.5 text-xs text-slate-500">تقييم العملاء المتسكنين في الروندات: المحاضر، المادة العلمية، توصيل المعلومة، ومسئولين الفرع — من 1 لـ 10.</p>
          </div>
          <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-9">
          <div className={`rounded-xl border px-3 py-2 lg:col-span-2 ${shown.length ? overall.cls : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
            <p className="text-[11px] font-bold">المتوسط العام ({shown.length} تقييم)</p>
            <p className="text-2xl font-black">{shown.length ? `${overall.emoji} ${summary.average}` : '—'}</p>
          </div>
          {summary.byQuestion.map(item => (
            <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] font-bold text-slate-500">{item.label}</p>
              <p className={`text-xl font-black ${scoreCls(item.value)}`}>{shown.length ? item.value : '—'}</p>
            </div>
          ))}
          {summary.moods.map(item => (
            <button key={item.label} type="button" onClick={() => setMood(mood === item.label ? '' : item.label)}
              className={`rounded-xl border px-3 py-2 text-right ${MOOD_CLS[item.label]} ${mood === item.label ? 'ring-2 ring-indigo-300' : ''}`}>
              <p className="text-[11px] font-bold">{item.label}</p>
              <p className="text-xl font-black">{item.count}</p>
            </button>
          ))}
        </div>
        {summary.lecturers.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="text-[11px] font-bold text-slate-400">المحاضرين:</span>
            {summary.lecturers.map(item => (
              <button key={item.name} type="button" onClick={() => setLecturer(lecturer === item.name ? '' : item.name)}
                className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${lecturer === item.name ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600'}`}>
                {item.name} · <span className={scoreCls(item.value)}>{item.value}</span> <span className="text-slate-400">({item.count})</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث بالاسم أو التليفون أو الملاحظة"
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pr-9 pl-3 text-xs outline-none focus:ring-2 focus:ring-indigo-200" />
        </div>
        <select value={mood} onChange={event => setMood(event.target.value)} className={selectCls} aria-label="الرضا">
          <option value="">كل درجات الرضا</option>
          {summary.moods.map(item => <option key={item.label} value={item.label}>{item.label}</option>)}
        </select>
        <select value={round} onChange={event => setRound(event.target.value)} className={selectCls} aria-label="الروند">
          <option value="">كل الروندات</option>
          {options.rounds.map(code => <option key={code} value={code}>روند {code}</option>)}
        </select>
        <select value={lecturer} onChange={event => setLecturer(event.target.value)} className={selectCls} aria-label="المحاضر">
          <option value="">كل المحاضرين</option>
          {options.lecturers.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <input type="date" value={from} onChange={event => setFrom(event.target.value)} className={selectCls} aria-label="من" />
        <input type="date" value={to} onChange={event => setTo(event.target.value)} className={selectCls} aria-label="إلى" />
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-14 text-center text-sm text-slate-400">
          {loading ? 'جاري التحميل…' : 'مفيش تقييمات لسه — بتتسجل من زرار «تقييم» جنب العميل جوه الروند في جدول الدقي.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2 text-right font-bold">العميل</th>
                <th className="px-3 py-2 text-right font-bold">الروند والكورس</th>
                {RATING_QUESTIONS.map(({ key, label }) => <th key={key} className="px-2 py-2 text-center font-bold">{label}</th>)}
                <th className="px-3 py-2 text-right font-bold">الرضا</th>
                <th className="px-3 py-2 text-right font-bold">الملاحظة</th>
                <th className="px-3 py-2 text-right font-bold">سجّلها</th>
                <th className="px-3 py-2 text-right font-bold">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(row => {
                const rowMood = satisfactionOf(row.average);
                return (
                  <tr key={row.id} className="border-t border-slate-100 align-top hover:bg-slate-50/60">
                    <td className="px-3 py-2">
                      <div className="whitespace-nowrap font-bold text-slate-800">{row.subscriberName || '—'}</div>
                      {row.phone && <div className="text-right text-[11px] text-slate-500" dir="ltr">{row.phone}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-bold text-indigo-700">{row.roundCode ? `روند ${row.roundCode}` : '—'}</div>
                      <div className="text-[11px] text-slate-500">{row.courseTitle || ''}</div>
                      {row.instructorName && <div className="text-[10px] text-slate-400">{row.instructorName}</div>}
                    </td>
                    {RATING_QUESTIONS.map(({ key }) => <td key={key} className={`px-2 py-2 text-center text-sm font-black ${scoreCls(row.scores[key])}`}>{row.scores[key]}</td>)}
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold ${rowMood.cls}`}>{rowMood.emoji} {row.average} · {rowMood.label}</span>
                    </td>
                    <td className="max-w-[240px] px-3 py-2 text-slate-600">{row.note || <span className="text-slate-300">—</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                      <div>{row.by || '—'}</div>
                      <div className="text-[10px] text-slate-400">{cairoDay(row.at)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-nowrap items-center gap-1">
                        <button onClick={() => navigate(`/client/${row.clientCode || row.subscriberId}`)} className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-100"><ExternalLink size={10} /> الملف</button>
                        {isAdmin && <button onClick={() => void remove(row)} className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700 hover:bg-red-100"><Trash2 size={10} /> حذف</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
