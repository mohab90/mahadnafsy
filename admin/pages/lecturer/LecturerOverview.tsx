import { useEffect, useState } from 'react';
import { Bell, CalendarClock, Radio, Star, Users, Wallet } from 'lucide-react';
import { cairoDateTime } from '../../../shared/cairoDate';
import { errorText, lecturerApi, money, type LecturerNotification, type Notify, type Overview } from './lecturerApi';
import { Card, Empty, Loading, Stat } from './ui';

/** The first screen: what is coming, what is waiting for an answer, how they are rated and what they are owed. */
export function LecturerOverview({ notify, onOpen }: { notify: Notify; onOpen: (tab: string) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [notices, setNotices] = useState<LecturerNotification[]>([]);

  useEffect(() => {
    let alive = true;
    Promise.all([lecturerApi.overview(), lecturerApi.notifications()])
      .then(([overview, list]) => { if (alive) { setData(overview); setNotices(list); } })
      .catch(error => notify('error', errorText(error, 'تعذر تحميل بياناتك')));
    return () => { alive = false; };
  }, [notify]);

  if (!data) return <Loading />;
  const rating = data.rating.instructor ?? (data.rating.course !== null ? data.rating.course * 2 : null);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button type="button" onClick={() => onOpen('lives')} className="text-right">
          <Stat label="لايفات جاية" value={data.lives.upcoming} tone="violet" hint={data.lives.liveNow ? `${data.lives.liveNow} شغال دلوقتي` : data.lives.next ? `الجاي: ${cairoDateTime(data.lives.next.at)}` : 'مفيش لايف متحدد'} />
        </button>
        <button type="button" onClick={() => onOpen('consultations')} className="text-right">
          <Stat label="استشارات مستنية رد" value={data.consultations.pending} tone={data.consultations.urgent ? 'red' : 'amber'}
            hint={data.consultationsEnabled ? `${data.consultations.urgent} عاجلة · ${data.consultations.upcoming} جاية` : 'الاستشارات مش مفعّلة على حسابك'} />
        </button>
        <button type="button" onClick={() => onOpen('students')} className="text-right">
          <Stat label="طلابي" value={data.students.online + data.students.rounds} tone="blue" hint={`${data.students.online} أونلاين · ${data.students.rounds} في الروندات`} />
        </button>
        <button type="button" onClick={() => onOpen('feedback')} className="text-right">
          <Stat label="تقييمي" value={rating !== null ? `${rating.toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 1 })} / 10` : '—'} tone="emerald" hint={`${data.rating.count} تقييم`} />
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="فلوسي" icon={<Wallet size={18} className="text-emerald-600" />}
          actions={<button type="button" onClick={() => onOpen('earnings')} className="text-xs font-bold text-primary-700 hover:underline">كشف الحساب</button>}>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="مستني اعتماد" value={money(data.earnings.waiting)} tone="amber" />
            <Stat label="معتمد" value={money(data.earnings.approved)} tone="blue" />
            <Stat label="اتصرف" value={money(data.earnings.paid)} tone="emerald" />
          </div>
          {data.earnings.retention > 0 && <p className="text-xs text-gray-600">منها مكافآت تدوير العملاء: <b>{money(data.earnings.retention)}</b></p>}
        </Card>

        <Card title="آخر الإشعارات" icon={<Bell size={18} className="text-primary-600" />}
          actions={data.unreadNotifications > 0 ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">{data.unreadNotifications} جديد</span> : undefined}>
          {notices.length === 0 ? <Empty>مفيش إشعارات لسه. أي استشارة جديدة هتظهر هنا وتوصلك على الواتساب.</Empty> : (
            <ul className="space-y-2">
              {notices.slice(0, 5).map(item => (
                <li key={item.id} className={`rounded-xl border p-3 text-sm ${item.read ? 'border-gray-100 bg-gray-50/60' : 'border-primary-200 bg-primary-50/60'}`}>
                  <p className="font-bold text-gray-900">{item.title}</p>
                  <p className="text-xs text-gray-600">{item.message}</p>
                  <p className="mt-1 text-[10px] text-gray-400">{cairoDateTime(item.at)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1"><Radio size={12} /> اللايف المجاني في المجتمع من تبويب «اللايفات»</span>
        <span className="inline-flex items-center gap-1"><CalendarClock size={12} /> مواعيدك بتتكرر كل أسبوع من «المواعيد»</span>
        <span className="inline-flex items-center gap-1"><Users size={12} /> الطلاب والحضور من «طلابي»</span>
        <span className="inline-flex items-center gap-1"><Star size={12} /> التقييمات من «التقييمات»</span>
      </div>
    </div>
  );
}
