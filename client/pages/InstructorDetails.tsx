import React, { useMemo, useState, useEffect } from 'react';
import { Modal } from '../../shared/ui/Modal';
import { useParams, useNavigate } from 'react-router-dom';
import { Star, Shield, Users, BookOpen, MessageCircle, CalendarDays, Globe2, BriefcaseBusiness } from 'lucide-react';
import { instituteWhatsApp } from '../lib/whatsappLink';
import { cairoDateOnly } from '../../shared/cairoDate';
import CourseCard from '../components/CourseCard';
import { useSiteData } from '../context/SiteDataContext';
import { formatAvailabilitySlot, getTherapistActiveSlots, getTherapistSessionPrice, isConsultationEnabled, meetingProviderLabels } from '../lib/consultations';
import { cdnImg, cdnSrcSet } from '../lib/img';
import { setCanonical } from '../lib/useSeo';

const InstructorDetails: React.FC = () => {
  const { therapists, courses, currency, content } = useSiteData();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const instructor = therapists.find((t) => t.id === id);
  useEffect(() => { setCanonical('/instructors'); }, []);
  useEffect(() => { document.title = (instructor?.name || 'المحاضرون والخبراء') + ' | معهد الدراسات النفسية'; }, [instructor?.name]);

  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSessionType, setSelectedSessionType] = useState<'individual' | 'couple' | 'family'>('individual');

  const currencySymbol = currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : '$';

  // Computed before the "not found" return below, because a hook that runs only
  // when the instructor exists changes the hook count between renders — the
  // page crashed with React #300 the moment `therapists` loaded and an unknown
  // id stopped matching, or vice versa. Handles a missing instructor itself.
  const availableSlots = useMemo(
    () => (instructor ? getTherapistActiveSlots(instructor, selectedDate) : []),
    [instructor, selectedDate],
  );

  if (!instructor) {
    return (
      <div className="bg-paper px-4 py-24 text-center">
        <p className="text-lg font-bold text-muted-body">المدرب غير موجود</p>
      </div>
    );
  }

  const instructorCourses = courses.filter((c) => c.instructor === instructor.name);
  const canBookConsultation = isConsultationEnabled(instructor);

  const handleBookRegular = () => {
    if (selectedSlot && selectedDate) {
      navigate(`/checkout?type=consultation&subtype=regular&therapistId=${instructor.id}&slotId=${selectedSlot}&date=${selectedDate}&sessionType=${selectedSessionType}`);
    }
  };

  const field = 'min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10';
  const label = 'mb-1 block text-[13px] font-bold text-muted-strong';

  return (
    <div className="relative min-h-screen bg-white">
      {isBookingModalOpen && (
    <Modal
      open
      onClose={() => setIsBookingModalOpen(false)}
      title={`حجز موعد مع ${instructor.name}`}
      size="lg"
    >

            <div className="p-5 sm:p-6">
              <div className="mb-6 flex items-center gap-4 rounded-2xl bg-paper p-4 ring-1 ring-line">
                {instructor.image ? <img loading="lazy" decoding="async" src={cdnImg(instructor.image, 120)} width={48} height={48} className="h-12 w-12 flex-none rounded-full object-cover" alt={instructor.name} /> : <div className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-primary-50 text-lg font-black text-primary-700">{instructor.name?.[0] ?? '?'}</div>}
                <div>
                  <p className="text-[13px] font-bold text-muted">سعر الجلسة</p>
                  <p className="text-2xl font-black tabular-nums text-ink">{getTherapistSessionPrice(instructor, currency)} <span className="text-base text-primary-700">{currencySymbol}</span></p>
                </div>
              </div>

              <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className={label}>نوع الجلسة</label>
                  <select className={field} value={selectedSessionType} onChange={(e) => setSelectedSessionType(e.target.value as 'individual' | 'couple' | 'family')}>
                    <option value="individual">فردية</option>
                    <option value="couple">زوجية</option>
                    <option value="family">أسرية</option>
                  </select>
                </div>
                <div>
                  <label className={label}>التاريخ</label>
                  <div className="relative">
                    <CalendarDays className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-soft" size={18} />
                    {/* The other entry point to the same booking. Same min, for
                        the same reason: the date travels to /checkout in the
                        URL, and a day that has already gone is not bookable. */}
                    <input type="date" min={cairoDateOnly()} className={`${field} pr-10`} value={selectedDate} onChange={(e) => { setSelectedDate(e.target.value); setSelectedSlot(''); }} />
                  </div>
                </div>
              </div>

              <h4 className="mb-3 text-sm font-extrabold text-ink">المواعيد المتاحة (بتوقيت القاهرة)</h4>
              <div className="mb-6 grid grid-cols-1 gap-2 md:grid-cols-2">
                {availableSlots.map((slot) => (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => setSelectedSlot(slot.id)}
                    aria-pressed={selectedSlot === slot.id}
                    className={`min-h-[48px] rounded-xl border px-4 text-right text-sm font-bold transition ${selectedSlot === slot.id ? 'border-ink bg-ink text-white shadow-lg' : 'border-line bg-paper text-muted-strong hover:border-ink/30'}`}
                  >
                    {formatAvailabilitySlot(slot)}
                  </button>
                ))}
              </div>
              {selectedDate && availableSlots.length === 0 && <p className="mb-6 rounded-xl bg-paper p-3 text-sm font-bold text-gold-deep ring-1 ring-line">لا توجد مواعيد لهذا اليوم.</p>}

              <button
                disabled={!selectedSlot || !selectedDate}
                onClick={handleBookRegular}
                className={`flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl font-black transition ${selectedSlot && selectedDate ? 'bg-primary-700 text-white shadow-[0_16px_30px_-12px_rgba(159,18,57,.8)] hover:bg-primary-800' : 'cursor-not-allowed bg-line text-muted-soft'}`}
              >
                تأكيد الحجز والدفع
              </button>
            </div>
    </Modal>
      )}

      {/* Profile header */}
      <section className="relative overflow-hidden border-b border-line bg-paper">
        <div aria-hidden="true" className="pointer-events-none absolute -left-40 -top-48 h-[460px] w-[460px] rounded-full bg-[radial-gradient(closest-side,rgba(190,18,60,.12),transparent)]" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -right-32 h-[360px] w-[360px] rounded-full bg-[radial-gradient(closest-side,rgba(200,150,46,.14),transparent)]" />
        <div className="container relative mx-auto grid items-center gap-8 px-4 py-10 sm:py-14 lg:grid-cols-[300px_1fr] lg:gap-12">
          <div className="mx-auto aspect-[4/5] w-44 overflow-hidden rounded-[28px] bg-sand shadow-[0_40px_80px_-45px_rgba(26,15,18,.6)] ring-1 ring-line sm:w-56 lg:w-full">
            {instructor.image ? (
              <img fetchPriority="high" decoding="async" src={cdnImg(instructor.image, 640)} srcSet={cdnSrcSet(instructor.image, [240, 400, 640])} sizes="(min-width: 1024px) 300px, (min-width: 640px) 224px, 176px" width={300} height={375} className="h-full w-full object-cover object-top" alt={instructor.name} />
            ) : (
              <span aria-hidden="true" className="flex h-full w-full items-center justify-center text-7xl font-black text-line-deep">{instructor.name?.[0] ?? '?'}</span>
            )}
          </div>

          <div className="min-w-0 text-center lg:text-right">
            <h1 className="text-balance text-3xl font-black leading-tight text-ink sm:text-4xl lg:text-[44px]">{instructor.name}</h1>
            <p className="mt-2 text-lg font-extrabold text-primary-700">{instructor.title}</p>

            {(instructor.focusAreas || []).length > 0 && (
              <div className="mt-4 flex flex-wrap justify-center gap-2 lg:justify-start">
                {(instructor.focusAreas || []).map((item) => (
                  <span key={item} className="rounded-full bg-white px-3 py-1 text-xs font-extrabold text-muted-strong ring-1 ring-line">{item}</span>
                ))}
              </div>
            )}

            <p className="mx-auto mt-5 max-w-3xl text-base leading-relaxed text-muted-body sm:text-lg lg:mx-0">
              {instructor.bio || 'نبذة مختصرة عن المدرب وخبراته...'}
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <button
                type="button"
                onClick={() => { if (canBookConsultation) setIsBookingModalOpen(true); }}
                disabled={!canBookConsultation}
                className={`inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl px-7 font-black transition ${canBookConsultation ? 'bg-primary-700 text-white shadow-[0_16px_30px_-12px_rgba(159,18,57,.8)] hover:bg-primary-800' : 'cursor-not-allowed bg-line text-muted-soft'}`}
              >
                <MessageCircle size={18} />
                {canBookConsultation ? 'حجز استشارة خاصة' : 'الاستشارات غير مفعلة لهذا المحاضر'}
              </button>
              {/* Three Facebook/Twitter/LinkedIn buttons used to sit here with no
                  handler and no data behind them — Therapist carries no social
                  fields, so they could never have linked anywhere. Replaced with
                  the one contact route that does exist and does work. */}
              <a href={`https://wa.me/${instituteWhatsApp(content)}?text=${encodeURIComponent(`مرحباً، أود الاستفسار عن ${instructor.name}`)}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border-[1.5px] border-ink/15 bg-white px-7 font-extrabold text-ink transition hover:border-ink/40">
                <MessageCircle size={18} className="text-green-600" /> استفسار عن المحاضر
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Numbers and details */}
      <section className="py-10 sm:py-14">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            {[
              { icon: Users, value: '5000+', text: 'طالب ومتدرب', gold: false },
              { icon: Shield, value: instructor.experience, text: 'سنوات خبرة', gold: false },
              { icon: Star, value: instructor.rating, text: 'تقييم المدرب', gold: true },
              { icon: BookOpen, value: instructorCourses.length, text: 'دبلومات منشورة', gold: false },
            ].map(({ icon: Icon, value, text, gold }) => (
              <div key={text} className="rounded-[24px] border border-line bg-white p-4 sm:p-5">
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${gold ? 'bg-paper text-gold-deep' : 'bg-primary-50 text-primary-700'}`}>
                  <Icon size={18} fill={gold ? 'currentColor' : 'none'} />
                </span>
                <b className="mt-3 block text-2xl font-black tabular-nums text-ink sm:text-3xl">{value}</b>
                <span className="text-sm text-muted">{text}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-3">
            <div className="rounded-[24px] border border-line bg-paper p-5">
              <div className="mb-2 flex items-center gap-2 font-extrabold text-ink">
                <Globe2 size={18} className="text-primary-700" />
                <span>اللغات</span>
              </div>
              <p className="text-sm leading-relaxed text-muted-body">{(instructor.languages || []).join(' - ') || 'العربية'}</p>
            </div>
            <div className="rounded-[24px] border border-line bg-paper p-5">
              <div className="mb-2 flex items-center gap-2 font-extrabold text-ink">
                <BriefcaseBusiness size={18} className="text-primary-700" />
                <span>المؤهلات</span>
              </div>
              <p className="text-sm leading-relaxed text-muted-body">{(instructor.qualifications || []).slice(0, 2).join(' - ') || instructor.specialty}</p>
            </div>
            <div className="rounded-[24px] border border-line bg-paper p-5">
              <div className="mb-2 flex items-center gap-2 font-extrabold text-ink">
                <CalendarDays size={18} className="text-primary-700" />
                <span>الاستشارات</span>
              </div>
              <p className="text-sm leading-relaxed text-muted-body">{canBookConsultation ? `${meetingProviderLabels[instructor.consultationSettings!.meetingProvider]} • ${getTherapistSessionPrice(instructor, currency)} ${currencySymbol}` : 'غير متاح حالياً'}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Programmes */}
      <section className="bg-paper py-14 sm:py-20">
        <div className="container mx-auto px-4">
          <div className="mb-8 text-center lg:text-right">
            <h2 className="text-3xl font-black leading-tight text-ink sm:text-4xl">الدبلومات والكورسات المقدمة</h2>
          </div>
          {instructorCourses.length > 0 ? (
            <div className="grid grid-cols-1 gap-5 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
              {instructorCourses.map((course) => (
                <CourseCard key={course.id} course={course} currency={currency} />
              ))}
            </div>
          ) : (
            <p className="rounded-[24px] border border-line bg-white px-5 py-10 text-center text-muted-body">لا توجد كورسات مسجلة لهذا المدرب حالياً.</p>
          )}
        </div>
      </section>
    </div>
  );
};

export default InstructorDetails;