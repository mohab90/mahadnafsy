import { useEffect, useState } from 'react';
import { Clock, FileText, Home, Loader2, Save, Stethoscope, Wallet } from 'lucide-react';
import { useStaticData } from '../../../../context/siteDataSlices';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

// «مش قادر احدد اوفر الاستشارة اللى بيظهر في الموقع». This screen saved
// consultation.price_egp, consultation.home_headline and friends, which nothing
// on the site read: the home page and the consultations page price the express
// session from express.price.* and word it from home.express.* and
// consult.express.*, and the checkout charged from express.price.* — unset, so
// it found 0 and refused every express booking. Every field here is now a key
// the site reads (client/lib/consultations.ts, Home.tsx, Consultations.tsx)
// or a rule the server enforces (api/lib/consultationRequests.js).
const KEYS = {
  priceEGP: 'express.price.EGP',
  priceSAR: 'express.price.SAR',
  priceUSD: 'express.price.USD',
  therapist: 'express.therapistId',
  duration: 'consultation.duration_minutes',
  image: 'consultation.expressImage',
  showOnHome: 'consultation.show_on_home',
  homeTitle: 'home.express.title',
  homeSubtitle: 'home.express.subtitle',
  homeNote: 'home.express.note',
  pageBadge: 'consult.express.badge',
  pageDesc: 'consult.express.desc',
  pageTimeLabel: 'consult.express.timeLabel',
  pageTimeValue: 'consult.express.timeValue',
  cancelPolicy: 'consult.cancelPolicy',
  bookingWindowDays: 'consultation.booking_window_days',
  minNoticeHours: 'consultation.min_notice_hours',
  autoConfirm: 'consultation.auto_confirm',
} as const;

// Where the Egyptian price used to be saved; read once so the price already
// set is not lost, and kept equal to the new key on save.
const LEGACY_PRICE_EGP = 'consultation.price_egp';

const DAY_LABELS: Record<string, string> = {
  saturday: 'السبت', sunday: 'الأحد', monday: 'الاثنين', tuesday: 'الثلاثاء',
  wednesday: 'الأربعاء', thursday: 'الخميس', friday: 'الجمعة',
};

const input = 'w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-blue-400 focus:outline-none';

export function ConsultationSettingsTab({ notify }: { notify: NotifyFn }) {
  const { content, setContentValues, therapists } = useStaticData();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft({
      ...Object.fromEntries(Object.values(KEYS).map(key => [key, content[key] || ''])),
      [KEYS.priceEGP]: content[KEYS.priceEGP] || content[LEGACY_PRICE_EGP] || '',
      [KEYS.duration]: content[KEYS.duration] || '60',
      [KEYS.showOnHome]: content[KEYS.showOnHome] || 'true',
      [KEYS.bookingWindowDays]: content[KEYS.bookingWindowDays] || '30',
      [KEYS.minNoticeHours]: content[KEYS.minNoticeHours] || '4',
      [KEYS.autoConfirm]: content[KEYS.autoConfirm] || 'false',
    });
  }, [content]);

  const set = (key: string, value: string) => setDraft(prev => ({ ...prev, [key]: value }));

  const save = async () => {
    for (const key of [KEYS.priceEGP, KEYS.priceSAR, KEYS.priceUSD]) {
      const price = Number(draft[key]);
      if (!draft[key] || !Number.isFinite(price) || price <= 0) {
        return notify('error', 'حط سعر الجلسة السريعة بالجنيه والريال والدولار — من غيره الحجز بالعملة دي بيترفض.');
      }
    }
    setSaving(true);
    try {
      const saved = await setContentValues({ ...draft, [LEGACY_PRICE_EGP]: draft[KEYS.priceEGP] });
      notify(saved ? 'success' : 'error', saved ? 'اتحفظ — الموقع بيعرض الكلام والأسعار دي دلوقتي' : 'تعذر حفظ الإعدادات');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر حفظ الإعدادات');
    } finally { setSaving(false); }
  };

  const text = (key: string, label: string, placeholder = '', multiline = false) => (
    <label className="block">
      <span className="text-xs text-gray-600 font-bold mb-1 block">{label}</span>
      {multiline
        ? <textarea rows={3} value={draft[key] ?? ''} placeholder={placeholder} onChange={event => set(key, event.target.value)} className={`${input} resize-y`} />
        : <input value={draft[key] ?? ''} placeholder={placeholder} onChange={event => set(key, event.target.value)} className={input} />}
    </label>
  );

  const numberField = (key: string, label: string, hint: string, suffix: string) => (
    <div>
      <label className="text-xs text-gray-600 font-bold mb-1 block">{label}</label>
      <div className="flex items-center gap-2">
        <input type="number" min="0" value={draft[key] ?? ''} onChange={event => set(key, event.target.value)} className={input} />
        <span className="text-xs text-gray-400 whitespace-nowrap">{suffix}</span>
      </div>
      {hint && <p className="text-[10px] text-gray-400 mt-1 leading-5">{hint}</p>}
    </div>
  );

  const toggle = (key: string, label: string, hint: string) => (
    <label className="flex items-start gap-3 border border-gray-200 rounded-xl p-3 cursor-pointer hover:bg-gray-50">
      <input type="checkbox" checked={draft[key] === 'true'} onChange={event => set(key, String(event.target.checked))}
        className="mt-0.5 w-4 h-4" />
      <span>
        <span className="text-sm font-bold text-gray-800 block">{label}</span>
        <span className="text-[11px] text-gray-500 leading-5">{hint}</span>
      </span>
    </label>
  );

  const bookable = therapists.filter(therapist => therapist.consultationSettings?.enabled !== false);

  return (
    <div className="space-y-5" dir="rtl">
      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
        <h3 className="font-bold text-gray-800 flex items-center gap-2"><Wallet size={16} className="text-blue-600" />الجلسة السريعة — السعر اللي بيظهر ويتدفع</h3>
        <p className="text-[11px] text-gray-500 leading-5">
          ده العرض اللي في الصفحة الرئيسية وفي صفحة الاستشارات، وهو نفس السعر اللي العميل بيدفعه. كل زائر بيشوف عملة بلده.
        </p>
        <div className="grid md:grid-cols-3 gap-4">
          {numberField(KEYS.priceEGP, 'السعر بالجنيه', 'لزوار مصر', 'ج.م')}
          {numberField(KEYS.priceSAR, 'السعر بالريال', 'لزوار السعودية', 'ر.س')}
          {numberField(KEYS.priceUSD, 'السعر بالدولار', 'لباقي الدول', '$')}
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          <label className="block">
            <span className="text-xs text-gray-600 font-bold mb-1 block">الدكتور المسؤول عن الجلسة السريعة</span>
            <select value={draft[KEYS.therapist] ?? ''} onChange={event => set(KEYS.therapist, event.target.value)} className={`${input} bg-white`}>
              <option value="">يتحدد مع كل طلب</option>
              {bookable.map(therapist => <option key={therapist.id} value={therapist.id}>{therapist.name}</option>)}
            </select>
          </label>
          {numberField(KEYS.duration, 'مدة الجلسة', '', 'دقيقة')}
          {text(KEYS.image, 'صورة القسم (رابط)', 'https://…')}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
        <h3 className="font-bold text-gray-800 flex items-center gap-2"><Home size={16} className="text-emerald-600" />في الصفحة الرئيسية</h3>
        {toggle(KEYS.showOnHome, 'اعرض قسم الاستشارة في الرئيسية', 'لو اتقفل، القسم بيختفي من الرئيسية بس — صفحة الاستشارات والحجز شغالين.')}
        <div className="grid md:grid-cols-2 gap-4">
          {text(KEYS.homeTitle, 'العنوان', 'تحدث مع معالج نفسي متخصص الآن')}
          {text(KEYS.homeSubtitle, 'السطر تحت العنوان', 'جلسة خاصة عبر الإنترنت. احجز في دقائق واحصل على دعم فوري.')}
          {text(KEYS.homeNote, 'الجملة تحت زر الحجز', 'سيتواصل معك المعالج خلال ساعات')}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
        <h3 className="font-bold text-gray-800 flex items-center gap-2"><FileText size={16} className="text-indigo-600" />في صفحة الاستشارات</h3>
        <div className="grid md:grid-cols-2 gap-4">
          {text(KEYS.pageBadge, 'الشارة', 'متاح الآن 24/7')}
          {text(KEYS.pageTimeLabel, 'عنوان وقت الاستجابة', 'فوري')}
          {text(KEYS.pageTimeValue, 'وقت الاستجابة', 'خلال ساعة واحدة')}
        </div>
        {text(KEYS.pageDesc, 'وصف الجلسة السريعة', 'خدمة مخصصة للحالات الطارئة…', true)}
        {text(KEYS.cancelPolicy, 'سياسة الإلغاء (في الأسئلة الشائعة)', 'يمكن إلغاء الجلسة قبل 24 ساعة من موعدها…', true)}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
        <h3 className="font-bold text-gray-800 flex items-center gap-2"><Clock size={16} className="text-amber-600" />قواعد الحجز</h3>
        <div className="grid md:grid-cols-2 gap-4">
          {numberField(KEYS.bookingWindowDays, 'الحجز مفتوح لغاية', 'أبعد يوم يقدر العميل يحجز فيه من النهارده.', 'يوم')}
          {numberField(KEYS.minNoticeHours, 'أقل مهلة قبل الموعد', 'بيمنع حجز موعد قرّب أوي على الدكتور.', 'ساعة')}
        </div>
        {toggle(KEYS.autoConfirm, 'تأكيد الحجز تلقائياً بعد الدفع', 'من غيره الحجز المدفوع بيفضل «في الانتظار» لحد ما حد من الفريق يأكده من «حجوزات الاستشارات».')}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-1"><Stethoscope size={16} className="text-indigo-600" />مواعيد الدكاترة</h3>
        <p className="text-[11px] text-gray-500 mb-3 leading-5">
          المواعيد وسعر كل دكتور بيتظبطوا في ملفه (المحاضرون والخبراء) — دي عرض للي متظبّط دلوقتي.
        </p>
        {therapists.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">مفيش دكاترة مسجّلين.</p>
        ) : (
          <div className="space-y-2">
            {therapists.map(therapist => {
              const settings = therapist.consultationSettings;
              const slots = (settings?.availableSlots || []).filter(slot => slot.isActive);
              return (
                <div key={therapist.id} className="border border-gray-200 rounded-xl px-3 py-2.5 flex flex-wrap items-center gap-2">
                  <span className="font-bold text-gray-800 text-sm min-w-[130px]">{therapist.name}</span>
                  {settings?.enabled === false ? (
                    <span className="text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-0.5">الاستشارات مقفولة عنده</span>
                  ) : slots.length === 0 ? (
                    <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-0.5">مفيش مواعيد متظبّطة</span>
                  ) : (
                    slots.map(slot => (
                      <span key={slot.id} className="text-[11px] bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg px-2 py-0.5">
                        {DAY_LABELS[slot.day] || slot.day} {slot.startTime}–{slot.endTime}
                      </span>
                    ))
                  )}
                  {settings?.sessionPrice?.EGP ? (
                    <span className="text-[11px] text-gray-500 mr-auto">سعره: {settings.sessionPrice.EGP.toLocaleString('ar-EG-u-nu-latn')} ج.م</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <button onClick={() => void save()} disabled={saving}
        className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-blue-700 transition disabled:opacity-60">
        {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
        حفظ الإعدادات
      </button>
    </div>
  );
}
