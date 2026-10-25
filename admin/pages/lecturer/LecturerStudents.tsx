import { useEffect, useMemo, useState } from 'react';
import { GraduationCap, Search, Video } from 'lucide-react';
import { cairoDateTime } from '../../../shared/cairoDate';
import { errorText, lecturerApi, type Notify, type Students } from './lecturerApi';
import { Card, Empty, field, Loading, Stat } from './ui';

const SLOT: Record<string, string> = { morning: 'صباحاً', noon: 'ظهراً', evening: 'مساءً' };
const STATE: Record<string, string> = { new: 'جديد', active: 'شغال', finished: 'خلص' };

/** «قائمة الطلاب والحضور»: who studies with them — online and in the rounds — and who came to their lives. No phone numbers. */
export function LecturerStudents({ notify }: { notify: Notify }) {
  const [data, setData] = useState<Students | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    lecturerApi.students().then(setData).catch(error => { notify('error', errorText(error, 'تعذر تحميل الطلاب')); });
  }, [notify]);

  const online = useMemo(() => {
    const q = query.trim();
    return (data?.online || []).filter(row => !q || row.name.includes(q) || row.course.includes(q));
  }, [data, query]);
  const rounds = useMemo(() => {
    const q = query.trim();
    return (data?.rounds || []).filter(row => !q || row.name.includes(q) || row.round.includes(q));
  }, [data, query]);

  if (!data) return <Loading />;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="طلاب أونلاين" value={data.online.length} tone="blue" />
        <Stat label="طلاب في الروندات" value={data.rounds.length} tone="violet" />
        <Stat label="رونداتي" value={data.roundsList.filter(round => round.status !== 'finished').length} tone="emerald" hint="شغالة أو جديدة" />
        <Stat label="لايفات انتهت" value={data.lives.length} hint="آخر 20" />
      </div>
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute right-3 top-3 text-gray-400" />
        <input className={`${field} pr-9`} placeholder="ابحث باسم الطالب أو الكورس أو الروند" value={query} onChange={e => setQuery(e.target.value)} />
      </div>

      <Card title="رونداتي" icon={<GraduationCap size={18} className="text-violet-600" />}>
        {data.roundsList.length === 0 ? <Empty>مفيش رونداتي مسجلة باسمك.</Empty> : (
          <div className="grid gap-2 md:grid-cols-2">
            {data.roundsList.map(round => (
              <div key={round.id} className="rounded-2xl border border-gray-200 bg-gray-50/60 p-3 text-sm">
                <p className="font-bold text-gray-900">{round.courseTitle} <span className="text-xs font-normal text-gray-500">· روند {round.code}</span></p>
                <p className="text-xs text-gray-500">{round.day} · {SLOT[round.slot] || round.slot} · بدأ {round.startDate} · {STATE[round.status] || round.status}</p>
                <p className="mt-1 text-xs"><b>{round.attendees}</b> طالب · المحاضرة <b>{round.currentLecture}</b></p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="الحضور في الروندات">
        {rounds.length === 0 ? <Empty>مفيش طلاب مسكّنين في رونداتك دلوقتي.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-200 text-right text-xs text-gray-500"><th className="p-2">الطالب</th><th className="p-2">الروند</th><th className="p-2">الحضور</th></tr></thead>
              <tbody>
                {rounds.map(row => (
                  <tr key={`${row.roundId}:${row.id}`} className="border-b border-gray-100">
                    <td className="p-2 font-bold text-gray-900">{row.name}</td>
                    <td className="p-2 text-xs text-gray-600">{row.course} · {row.round}</td>
                    <td className="p-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${row.held && row.attended / row.held < 0.5 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{row.attended} من {row.held}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="طلاب الكورسات الأونلاين">
        {online.length === 0 ? <Empty>مفيش طلاب أونلاين على كورساتك.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-200 text-right text-xs text-gray-500"><th className="p-2">الطالب</th><th className="p-2">الكورس</th><th className="p-2">اشترك</th><th className="p-2">التقدم</th></tr></thead>
              <tbody>
                {online.map(row => (
                  <tr key={`${row.courseId}:${row.id}`} className="border-b border-gray-100">
                    <td className="p-2 font-bold text-gray-900">{row.name}</td>
                    <td className="p-2 text-xs text-gray-600">{row.course}</td>
                    <td className="p-2 text-xs text-gray-500">{row.since}</td>
                    <td className="p-2"><div className="h-2 w-24 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-primary-500" style={{ width: `${Math.min(100, row.progress)}%` }} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="حضور آخر لايفاتي" icon={<Video size={18} className="text-red-600" />}>
        {data.lives.length === 0 ? <Empty>مفيش لايفات انتهت لسه.</Empty> : (
          <ul className="space-y-1.5">
            {data.lives.map(live => (
              <li key={live.id} className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2 text-sm">
                <span className="font-bold text-gray-900">{live.title} <span className="text-xs font-normal text-gray-500">· {cairoDateTime(live.at)}</span></span>
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">{live.attended} حضروا</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
