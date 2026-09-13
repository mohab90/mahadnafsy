import { useEffect, useState } from 'react';
import { Clock, Eye, Loader2, Save, Stethoscope, Wallet } from 'lucide-react';
import { useStaticData } from '../../../../context/siteDataSlices';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

// Stored in site content, the same store the rest of the public site is
// configured from, so the client app reads these without a new endpoint.
const KEYS = {
  price: 'consultation.price_egp',
  duration: 'consultation.duration_minutes',
  showOnHome: 'consultation.show_on_home',
  homeHeadline: 'consultation.home_headline',
  homeNote: 'consultation.home_note',
  bookingWindowDays: 'consultation.booking_window_days',
  minNoticeHours: 'consultation.min_notice_hours',
  autoConfirm: 'consultation.auto_confirm',
  cancelWindowHours: 'consultation.cancel_window_hours',
} as const;

const DAY_LABELS: Record<string, string> = {
  saturday: 'السبت', sunday: 'الأحد', monday: 'الاثنين', tuesday: 'الثلاثاء',
  wednesday: 'الأربعاء', thursday: 'الخميس', friday: 'الجمعة',
};

export function ConsultationSettingsTab({ notify }: { notify: NotifyFn }) {
  const { content, setContentValues, therapists } = useStaticData();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft({
      [KEYS.price]: content[KEYS.price] || '',
      [KEYS.duration]: content[KEYS.duration] || '60',
      [KEYS.showOnHome]: content[KEYS.showOnHome] || 'true',
      [KEYS.homeHeadline]: content[KEYS.homeHeadline] || '',
      [KEYS.homeNote]: content[KEYS.homeNote] || '',
      [KEYS.bookingWindowDays]: content[KEYS.bookingWindowDays] || '30',
      [KEYS.minNoticeHours]: content[KEYS.minNoticeHours] || '4',
      [KEYS.autoConfirm]: content[KEYS.autoConfirm] || 'false',
      [KEYS.cancelWindowHours]: content[KEYS.cancelWindowHours] || '24',
    });
  }, [content]);

  const set = (key: string, value: string) => setDraft(prev => ({ ...prev, [key]: value }));

  const save = async () => {
    const price = Number(draft[KEYS.price]);
    if (draft[KEYS.price] && (!Number.isFinite(price) || price < 0)) {
      return notify('error', 'سعر الاستشارة لازم يكون رقم صحيح.');
    }
    setSaving(true);
    try {
      const saved = await setContentValues(draft);
      notify(saved ? 'success' : 'error', saved ? 'تم حفظ إعدادات الاستشارات' : 'تعذر حفظ الإعدادات');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر حفظ الإعدادات');
    } finally { setSaving(false); }
  };

  const numberField = (key: string, label: string, hint: string, suffix: string) => (
    <div>
      <label className="text-xs text-gray-600 font-bold mb-1 block">{label}</label>
      <div className="flex items-center gap-2">
        <input type="number" min="0" value={draft[key] ?? ''} onChange={event => set(key, event.target.value)}
          className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" />
        <span className="text-xs text-gray-400 whitespace-nowrap">{suffix}</span>
      </div>
      <p className="text-[10px] text-gray-400 mt-1 leading-5">{hint}</p>
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

  return (
    <div className="space-y-5" dir="rtl">
      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
        <h3 className="font-bold text-gray-800 flex items-center gap-2"><Wallet size={16} className="text-blue-600" />السعر والمدة</h3>
        <div className="grid md:grid-cols-2 gap-4">
          {numberField(KEYS.price, 'سعر الاستشارة', 'السعر الافتراضي اللي يظهر للعميل. الدكتور اللي ليه سعر خاص بيغلب ده.', 'ج.م')}
          {numberField(KEYS.duration, 'مدة الجلسة', 'بتحدد طول الموعد الواحد في التقويم.', 'دقيقة')}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
        <h3 className="font-bold text-gray-800 flex items-center gap-2"><Eye size={16} className="text-emerald-600" />الظهور في الصفحة الرئيسية</h3>
        {toggle(KEYS.showOnHome, 'اعرض الاستشارات في الرئيسية', 'لو اتقفل، قسم الاستشارات بيختفي من الموقع والحجز بيتقفل معاه.')}
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-600 font-bold mb-1 block">العنوان في الرئيسية</label>
            <input value={draft[KEYS.homeHeadline] ?? ''} onChange={event => set(KEYS.homeHeadline, event.target.value)}
              placeholder="مثال: استشارة نفسية مع نخبة المتخصصين"
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-gray-600 font-bold mb-1 block">سطر توضيحي</label>
            <input value={draft[KEYS.homeNote] ?? ''} onChange={event => set(KEYS.homeNote, event.target.value)}
              placeholder="مثال: جلسة 60 دقيقة أونلاين أو في المقر"
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" />
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
        <h3 className="font-bold text-gray-800 flex items-center gap-2"><Clock size={16} className="text-amber-600" />قواعد الحجز</h3>
        <div className="grid md:grid-cols-3 gap-4">
          {numberField(KEYS.bookingWindowDays, 'الحجز مفتوح لغاية', 'أبعد يوم يقدر العميل يحجز فيه من دلوقتي.', 'يوم')}
          {numberField(KEYS.minNoticeHours, 'أقل مهلة قبل الموعد', 'بيمنع حجز موعد قرّب أوي على فريق العمل.', 'ساعة')}
          {numberField(KEYS.cancelWindowHours, 'الإلغاء مسموح قبل', 'بعد المهلة دي العميل لازم يكلم الدعم بدل ما يلغي بنفسه.', 'ساعة')}
        </div>
        {toggle(KEYS.autoConfirm, 'تأكيد الحجز تلقائياً', 'من غيره الحجز بيوصل «في الانتظار» وحد من الفريق بيأكده من تاب الحجوزات.')}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-1"><Stethoscope size={16} className="text-indigo-600" />مواعيد الدكاترة</h3>
        <p className="text-[11px] text-gray-500 mb-3 leading-5">
          المواعيد بتتظبط في ملف كل دكتور — دي عرض للي متظبّط دلوقتي عشان تشوف مين فاضي قبل ما توزّع الحجوزات.
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
