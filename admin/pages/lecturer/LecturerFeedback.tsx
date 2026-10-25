import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { cairoDay } from '../../../shared/cairoDate';
import { errorText, lecturerApi, type Notify, type Reviews } from './lecturerApi';
import { Card, Empty, Loading, Stat } from './ui';

const score = (value: number | null, outOf: number) => (value === null ? '—' : `${value.toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 1 })} / ${outOf}`);

/** «يشوف تقييماته»: the branch desk's marks of their rounds and the stars clients gave their courses, with what was written. */
export function LecturerFeedback({ notify }: { notify: Notify }) {
  const [data, setData] = useState<Reviews | null>(null);
  useEffect(() => {
    lecturerApi.reviews().then(setData).catch(error => { notify('error', errorText(error, 'تعذر تحميل التقييمات')); });
  }, [notify]);
  if (!data) return <Loading />;
  const { summary } = data;
  const top = Math.max(1, ...summary.distribution.map(row => row.count));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="تقييم المحاضر (الروندات)" value={score(summary.instructorScore, 10)} tone="emerald" hint={`${summary.roundRatings} تقييم`} />
        <Stat label="تقييم المادة" value={score(summary.materialScore, 10)} tone="blue" />
        <Stat label="تقييم الشرح" value={score(summary.deliveryScore, 10)} tone="violet" />
        <Stat label="نجوم الكورسات" value={score(summary.courseStars, 5)} tone="amber" hint={`${summary.courseRatings} تقييم`} />
      </div>
      <Card title="توزيع نجوم الكورسات" icon={<Star size={18} className="text-amber-500" />}>
        {summary.courseRatings === 0 ? <p className="text-sm text-gray-500">مفيش تقييمات بالنجوم لسه.</p> : (
          <div className="space-y-1.5">
            {summary.distribution.map(row => (
              <div key={row.stars} className="flex items-center gap-2 text-xs">
                <span className="w-12 font-bold text-gray-600">{row.stars} نجوم</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-amber-400" style={{ width: `${(row.count / top) * 100}%` }} /></div>
                <span className="w-8 text-left text-gray-500">{row.count}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title="آخر التقييمات">
        {data.items.length === 0 ? <Empty>مفيش تقييمات لسه.</Empty> : (
          <ul className="space-y-2">
            {data.items.map(item => (
              <li key={item.id} className="rounded-2xl border border-gray-200 bg-gray-50/60 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-gray-900">{item.client} <span className="text-xs font-normal text-gray-500">· {item.course || (item.kind === 'round' ? 'روند' : 'كورس')}</span></span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${item.score / item.outOf >= 0.8 ? 'bg-emerald-100 text-emerald-700' : item.score / item.outOf >= 0.6 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{item.score} / {item.outOf}</span>
                </div>
                {item.note && <p className="mt-1.5 text-gray-700">{item.note}</p>}
                <p className="mt-1 text-[10px] text-gray-400">{cairoDay(item.at)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
