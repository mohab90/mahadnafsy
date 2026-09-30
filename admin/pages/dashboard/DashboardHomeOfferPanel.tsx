import { useEffect, useMemo, useState } from 'react';
import { Clock, Save, Tag, Timer } from 'lucide-react';
import { useStaticData } from '../../context/siteDataSlices';

type NotifyFn = (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
type ContentField = { key: string; label: string; multiline?: boolean };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * «جزء اوفر 24 ساعه مش عارف اغيره منين اغير الكورس او الاوفر نفسه».
 *
 * The course picker and the timer lived on a tab no menu reached; the menu's
 * «الصفحة الرئيسية» opened a list of sixty text fields, the offer's among them,
 * with no way to choose the course. This panel is what that entry opens now,
 * and it says what decides what: the course chosen sets the price the site
 * shows (its own price, in each visitor's currency), the discount only draws
 * the struck-out price, and the countdown runs from «ابدأ العداد».
 *
 * Its state is its own — the selected course was held in Dashboard.tsx and
 * handed down with its setter to the one screen that used it.
 */
export function DashboardHomeOfferPanel({ fields, notify }: { fields: ContentField[]; notify: NotifyFn }) {
  const { content, courses, setContentValue, setContentValues } = useStaticData();
  const [courseId, setCourseId] = useState(content['offer.courseId'] || '');
  const [discount, setDiscount] = useState(content['home.offer.discountPercent'] || '45');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { setCourseId(content['offer.courseId'] || ''); }, [content]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const offerFields = fields.filter(field => field.key.startsWith('home.offer.'));
  const pageFields = fields.filter(field => !field.key.startsWith('home.offer.'));
  const current = courses.find(course => course.id === content['offer.courseId']);
  const started = Date.parse(content['offer.timerStartedAt'] || '');
  const remaining = Number.isFinite(started) ? started + DAY_MS - now : null;
  const pct = Number(content['home.offer.discountPercent'] || 45);
  const shownPrice = current?.price?.EGP || 0;
  const struckPrice = shownPrice && pct > 0 && pct < 100 ? Math.round(shownPrice / (1 - pct / 100)) : 0;

  const timerLabel = useMemo(() => {
    if (remaining === null) return 'مش شغال — العداد مش ظاهر في الموقع';
    if (remaining <= 0) return 'خلص — العداد واقف على 00:00:00';
    const h = Math.floor(remaining / 3600000);
    const m = Math.floor((remaining % 3600000) / 60000);
    return `شغال — فاضل ${h} ساعة و${m} دقيقة`;
  }, [remaining]);

  const applyCourse = async () => {
    const selected = courses.find(course => course.id === courseId);
    if (!selected) return notify('error', 'اختار الكورس الأول.');
    const percent = Number(discount);
    if (!Number.isFinite(percent) || percent < 0 || percent >= 100) return notify('error', 'نسبة الخصم لازم تكون من 0 لـ 99.');
    const ok = await setContentValues({
      'offer.courseId': selected.id,
      'home.offer.title': selected.title,
      'home.offer.description': (selected.shortDescription || selected.description?.slice(0, 200) || '')
        .replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim(),
      'home.offer.registerFor': `${selected.title} (عرض 24 ساعة)`,
      'home.offer.discountPercent': String(percent),
      'home.offer.discount': `خصم ${percent}%`,
    });
    notify(ok ? 'success' : 'error', ok ? `العرض بقى على «${selected.title}» — بسعره من صفحة الكورس.` : 'تعذر حفظ العرض.');
  };

  const unlinkCourse = async () => {
    const ok = await setContentValue('offer.courseId', '');
    notify(ok ? 'success' : 'error', ok ? 'العرض مش مربوط بكورس — الأسعار دلوقتي من الخانات تحت.' : 'تعذر الحفظ.');
  };

  const startTimer = async (value: string) => {
    const ok = await setContentValue('offer.timerStartedAt', value);
    notify(ok ? 'success' : 'error', ok ? (value ? 'العداد بدأ: 24 ساعة من دلوقتي.' : 'العداد اتقفل.') : 'تعذر الحفظ.');
  };

  const saveFields = async (list: ContentField[]) => {
    const edits = Object.fromEntries(list.map(field => [field.key, drafts[field.key] ?? content[field.key] ?? '']));
    const ok = await setContentValues(edits);
    notify(ok ? 'success' : 'error', ok ? 'اتحفظ.' : 'تعذر الحفظ.');
  };

  const fieldGrid = (list: ContentField[]) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {list.map(field => {
        const value = drafts[field.key] ?? content[field.key] ?? '';
        const change = (next: string) => setDrafts(prev => ({ ...prev, [field.key]: next }));
        return (
          <label key={field.key} className={field.multiline ? 'md:col-span-2 block' : 'block'}>
            <span className="block text-xs font-bold text-gray-600 mb-1">{field.label}</span>
            {field.multiline
              ? <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-24" value={value} onChange={event => change(event.target.value)} />
              : <input className="w-full border border-gray-300 rounded-lg px-3 py-2" value={value} onChange={event => change(event.target.value)} />}
          </label>
        );
      })}
    </div>
  );

  return (
    <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-6" dir="rtl">
      <section className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-4">
        <h3 className="font-bold text-amber-900 flex items-center gap-2"><Tag size={16} /> عرض الـ24 ساعة في الصفحة الرئيسية</h3>

        <div className="grid gap-2 sm:grid-cols-3 text-xs">
          <div className="rounded-lg bg-white border border-amber-200 p-3">
            <div className="text-amber-700 font-bold mb-1">الكورس في العرض</div>
            <div className="font-bold text-gray-900">{current?.title || 'مش مربوط بكورس'}</div>
          </div>
          <div className="rounded-lg bg-white border border-amber-200 p-3">
            <div className="text-amber-700 font-bold mb-1">السعر اللي بيظهر (مصر)</div>
            <div className="font-bold text-gray-900">
              {current
                ? <>{shownPrice.toLocaleString('ar-EG-u-nu-latn')} ج.م {struckPrice ? <span className="text-gray-400 line-through mr-1">{struckPrice.toLocaleString('ar-EG-u-nu-latn')}</span> : null}</>
                : (content['home.offer.newPrice'] || '—')}
            </div>
          </div>
          <div className="rounded-lg bg-white border border-amber-200 p-3">
            <div className="text-amber-700 font-bold mb-1 flex items-center gap-1"><Timer size={12} /> العداد</div>
            <div className="font-bold text-gray-900">{timerLabel}</div>
          </div>
        </div>

        <p className="text-xs text-amber-800 leading-5">
          الكورس اللي تختاره هو اللي العميل بيسجل عليه، و<strong>سعره هو سعر العرض</strong> — عشان تغير السعر غيّره من صفحة الكورس،
          أو فك الربط وحط الأسعار يدوي في الخانات تحت. نسبة الخصم بتحسب السعر المشطوب بس.
        </p>

        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex-1 min-w-[220px]">
            <span className="block text-xs font-bold text-amber-800 mb-1">اختار كورس العرض</span>
            <select value={courseId} onChange={event => setCourseId(event.target.value)}
              className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">— اختر كورس —</option>
              {courses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}
            </select>
          </label>
          <label className="w-28">
            <span className="block text-xs font-bold text-amber-800 mb-1">الخصم %</span>
            <input type="number" min="0" max="99" value={discount} onChange={event => setDiscount(event.target.value)}
              className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm bg-white" />
          </label>
          <button type="button" onClick={() => void applyCourse()}
            className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold">تطبيق على العرض</button>
          {current && (
            <button type="button" onClick={() => void unlinkCourse()}
              className="px-4 py-2 rounded-lg border border-amber-300 text-amber-800 text-sm font-bold hover:bg-amber-100">فك الربط بالكورس</button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void startTimer(new Date().toISOString())}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg">
            <Clock size={13} /> ابدأ عداد 24 ساعة من دلوقتي
          </button>
          {remaining !== null && (
            <button type="button" onClick={() => void startTimer('')}
              className="px-4 py-2 rounded-lg border border-amber-300 text-amber-800 text-xs font-bold hover:bg-amber-100">إيقاف العداد</button>
          )}
        </div>

        <div className="border-t border-amber-200 pt-4 space-y-3">
          <h4 className="text-sm font-bold text-amber-900">نصوص العرض</h4>
          {fieldGrid(offerFields)}
          <button type="button" onClick={() => void saveFields(offerFields)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-bold"><Save size={14} /> حفظ نصوص العرض</button>
        </div>
      </section>

      <details className="rounded-xl border border-gray-200 p-4">
        <summary className="cursor-pointer font-bold text-gray-800">باقي نصوص الصفحة الرئيسية</summary>
        <div className="mt-4 space-y-3">
          {fieldGrid(pageFields)}
          <button type="button" onClick={() => void saveFields(pageFields)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-bold"><Save size={14} /> حفظ</button>
        </div>
      </details>
    </article>
  );
}
