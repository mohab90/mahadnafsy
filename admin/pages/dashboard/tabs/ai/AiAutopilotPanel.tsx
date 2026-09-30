import { useCallback, useEffect, useState } from 'react';
import { Play, Sparkles } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type Settings = { enabled: boolean; seo: boolean; communityPosts: boolean; studyArticles: boolean; quizzes: boolean; reviewBeforePublish: boolean };
type Status = { published: number; missingSeo: number; withoutQuiz: number; aiPosts: number; aiPostsWaiting: number };
type Run = { date: string; at: string; done: Record<string, number | { error: string } | { title: string; status: string }> };
type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

const TASKS: { key: keyof Omit<Settings, 'enabled' | 'reviewBeforePublish'>; label: string; hint: string }[] = [
  { key: 'seo', label: 'SEO للكورسات', hint: 'عنوان ووصف وكلمات بحث لكل كورس منشور ملوش — اللي انت كاتبه مش بيتغير.' },
  { key: 'communityPosts', label: 'منشور مفيد في المجتمع كل يوم', hint: 'نصيحة أو معلومة نفسية قصيرة وسؤال يفتح النقاش.' },
  { key: 'studyArticles', label: 'مادة علمية مبسطة (الأحد والأربع)', hint: 'مقال بيشرح مفهوم من كورس بأمثلة، وفي آخره رابط الكورس.' },
  { key: 'quizzes', label: 'أسئلة تفاعلية للكورسات', hint: '10 أسئلة اختيار من متعدد لكل كورس ملوش اختبار — الطالب بيحلها من «حسابي».' },
];

const doneText = (value: Run['done'][string]) => {
  if (typeof value === 'number') return `${value}`;
  if (value && 'error' in value) return `❌ ${value.error}`;
  if (value && 'title' in value) return `«${value.title}»${value.status === 'pending' ? ' (مستني مراجعة)' : ''}`;
  return '—';
};

/**
 * «خلي السيستم يفيد نفسه ويكون ذكي»: the daily autopilot (api/lib/aiAutopilot.js)
 * — what it does, what it did, and each task on demand.
 */
export function AiAutopilotPanel({ notify }: { notify: Notify }) {
  const [data, setData] = useState<{ settings: Settings; status: Status; runs: Run[] } | null>(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try { setData(await mysqlAdmin.adminGet('/admin/ai/autopilot')); }
    catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر تحميل مركز الذكاء الاصطناعي'); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  if (!data) return null;
  const { settings, status, runs } = data;

  const save = async (next: Settings) => {
    setData({ ...data, settings: next });
    try { await mysqlAdmin.adminPut('/admin/ai/autopilot', next); }
    catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر الحفظ'); void load(); }
  };

  const run = async (task: string) => {
    setBusy(task);
    try {
      await mysqlAdmin.adminPost('/admin/ai/autopilot/run', { task });
      notify('success', 'اتبدأ — النتيجة هتظهر في «آخر مرات التشغيل» خلال دقايق.');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر التشغيل');
    } finally { setBusy(''); }
  };

  return (
    <article className="space-y-4 rounded-2xl border border-violet-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-bold text-gray-900"><Sparkles size={16} className="text-violet-600" /> مركز الذكاء الاصطناعي — شغل تلقائي كل يوم</h3>
        <label className="flex items-center gap-2 text-sm font-bold text-gray-700">
          <input type="checkbox" checked={settings.enabled} onChange={event => void save({ ...settings, enabled: event.target.checked })} className="h-4 w-4" />
          شغّال
        </label>
      </div>
      <p className="text-xs leading-5 text-gray-500">
        كل يوم الساعة 10 الصبح بتوقيت القاهرة، بالمفتاح اللي فوق. {status.missingSeo} كورس من {status.published} ملهمش SEO،
        و{status.withoutQuiz} ملهمش أسئلة. المنشورات اللي اتعملت لحد دلوقتي: {status.aiPosts}{status.aiPostsWaiting ? ` (${status.aiPostsWaiting} مستنية مراجعة في المجتمع)` : ''}.
      </p>
      <div className="space-y-2">
        {TASKS.map(task => (
          <div key={task.key} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 p-3">
            <label className="flex flex-1 cursor-pointer items-start gap-3">
              <input type="checkbox" checked={settings[task.key]} onChange={event => void save({ ...settings, [task.key]: event.target.checked })} className="mt-0.5 h-4 w-4" />
              <span>
                <span className="block text-sm font-bold text-gray-800">{task.label}</span>
                <span className="text-[11px] leading-5 text-gray-500">{task.hint}</span>
              </span>
            </label>
            <button type="button" disabled={Boolean(busy)} onClick={() => void run(task.key)}
              className="flex items-center gap-1 rounded-lg border border-violet-200 px-3 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-50 disabled:opacity-50">
              <Play size={12} /> {busy === task.key ? 'جاري…' : 'شغّل دلوقتي'}
            </button>
          </div>
        ))}
      </div>
      <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
        <input type="checkbox" checked={settings.reviewBeforePublish} onChange={event => void save({ ...settings, reviewBeforePublish: event.target.checked })} className="mt-0.5 h-4 w-4" />
        <span>
          <span className="block text-sm font-bold text-amber-900">مراجعة قبل النشر</span>
          <span className="text-[11px] leading-5 text-amber-800">لو اتعلّم، منشورات الذكاء الاصطناعي بتستنى موافقتك في «إدارة المجتمع» بدل ما تتنشر على طول.</span>
        </span>
      </label>
      {runs.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-bold text-gray-600">آخر مرات التشغيل</h4>
          <ul className="space-y-1 text-[11px] text-gray-600">
            {runs.map(entry => (
              <li key={`${entry.date}-${entry.at}`} className="rounded-lg bg-gray-50 px-2 py-1">
                <strong>{entry.date}</strong>: {Object.entries(entry.done).map(([task, value]) =>
                  `${TASKS.find(item => item.key === task)?.label || task}: ${doneText(value)}`).join(' · ') || 'مفيش مهام اتنفذت'}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
