import React, { useMemo, useState, useEffect } from 'react';
import { Zap, Star, Shield, Clock, ArrowLeft, Search, UserCheck, Lock, CalendarDays, Plus, Video, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Therapist } from '../types';
import { useSiteData } from '../context/SiteDataContext';
import { useEscapeKey } from '../../shared/ui/useEscapeKey';
import { expressPrice as expressPriceIn, formatAvailabilitySlot, getTherapistActiveSlots, getTherapistSessionPrice, isConsultationEnabled, meetingProviderLabels } from '../lib/consultations';
import { cdnImg } from '../lib/img';
import { cairoDateOnly } from '../../shared/cairoDate';
import { useSeo } from '../lib/useSeo';
import PageHeader from '../components/PageHeader';

const inputClass = 'min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10';

const Consultations: React.FC = () => {
    const navigate = useNavigate();
    const { therapists, content, currency } = useSiteData();
    const [searchTerm, setSearchTerm] = useState('');
    const [specialtyFilter, setSpecialtyFilter] = useState('All');
    const [selectedTherapist, setSelectedTherapist] = useState<Therapist | null>(null);
    const [selectedSlot, setSelectedSlot] = useState('');
    const [selectedDate, setSelectedDate] = useState('');
    const [selectedSessionType, setSelectedSessionType] = useState<'individual' | 'couple' | 'family'>('individual');
    const [bookingStep, setBookingStep] = useState(0);
    // Escape closes the booking dialog. Left as a hand-rolled overlay on
    // purpose: this file's JSX nesting does not follow its indentation — the
    // booking overlay and the therapist list below it sit inside one conditional
    // — so restructuring it wants a proper read, not a line edit on a live
    // booking page. The accessibility gap is closed either way.
    useEscapeKey(() => setBookingStep(0), bookingStep === 1);

    const currencySymbol = currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : '$';

    useSeo({ title: 'العيادة النفسية | معهد الدراسات النفسية', path: '/consultations', description: 'استشارات نفسية أونلاين مع نخبة من المعالجين المتخصصين في معهد الدراسات النفسية.' });

    const consultationTherapists = useMemo(() => therapists.filter(isConsultationEnabled), [therapists]);
    const availableSlots = selectedTherapist ? getTherapistActiveSlots(selectedTherapist, selectedDate) : [];

    const expressTherapist = useMemo(() => {
        const tid = content['express.therapistId'];
        return tid ? therapists.find((t) => t.id === tid) ?? null : null;
    }, [content, therapists]);
    const expressPrice = expressPriceIn(content, currency);

    const handleBookExpress = () => {
        navigate(`/checkout?type=consultation&subtype=express&price=${expressPrice}${expressTherapist ? `&therapistId=${expressTherapist.id}` : ''}`);
    };

    const handleBookRegular = () => {
        if (selectedTherapist && selectedSlot && selectedDate) {
            navigate(`/checkout?type=consultation&subtype=regular&therapistId=${selectedTherapist.id}&slotId=${selectedSlot}&date=${selectedDate}&sessionType=${selectedSessionType}`);
        }
    };

    const [faqOpen, setFaqOpen] = useState<number | null>(null);
    const specialties = Array.from(new Set(consultationTherapists.map((t) => t.specialty)));
    const filteredTherapists = consultationTherapists.filter((t) => {
        const matchesSearch = t.name.includes(searchTerm) || t.specialty.includes(searchTerm) || (t.focusAreas || []).some((item) => item.includes(searchTerm));
        const matchesSpecialty = specialtyFilter === 'All' || t.specialty === specialtyFilter;
        return matchesSearch && matchesSpecialty;
    });

    const pill = (on: boolean) => `inline-flex min-h-[44px] flex-none items-center whitespace-nowrap rounded-full border px-4 text-sm font-extrabold transition ${on ? 'border-ink bg-ink text-white' : 'border-line bg-paper text-muted-strong hover:border-line-deep'}`;

    return (
        <div className="min-h-screen bg-white">
            {/* Hero */}
            <PageHeader
                eyebrow={(
                    <span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-[13px] text-ink ring-1 ring-line">
                        <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-70 motion-safe:animate-ping" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" /></span>
                        {consultationTherapists.length} معالج متاح الآن
                    </span>
                )}
                title="العيادة النفسية"
                subtitle="احجز جلستك مع نخبة من المعالجين النفسيين المعتمدين. سرية تامة، مواعيد مرنة، ونتائج مثبتة علمياً."
            >
                <div className="mx-auto grid max-w-3xl grid-cols-2 gap-2.5 sm:grid-cols-4">
                    {[
                        { icon: Shield, label: 'سرية تامة', sub: '100% خصوصية' },
                        { icon: UserCheck, label: 'معالجون معتمدون', sub: 'خبرات موثقة' },
                        { icon: Clock, label: 'مواعيد مرنة', sub: 'أسبوعياً وعطل' },
                        { icon: Star, label: 'تقييم مرتفع', sub: '4.9 من 5 نجوم' },
                    ].map(({ icon: Icon, label, sub }) => (
                        <div key={label} className="flex items-center gap-2.5 rounded-2xl bg-white px-3 py-3 text-right ring-1 ring-line">
                            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700"><Icon size={18} /></span>
                            <span className="min-w-0">
                                <span className="block text-sm font-extrabold leading-tight text-ink">{label}</span>
                                <span className="block text-xs text-muted">{sub}</span>
                            </span>
                        </div>
                    ))}
                </div>
            </PageHeader>

            {/* How it works */}
            <section className="bg-white py-14 sm:py-20">
                <div className="container mx-auto max-w-5xl px-4">
                    <div className="text-center">
                        <span className="text-sm font-extrabold text-gold-deep">ثلاث خطوات بسيطة</span>
                        <h2 className="mt-2 text-3xl font-black leading-tight text-ink sm:text-4xl">كيف تحجز جلستك؟</h2>
                    </div>
                    <ol className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
                        {[
                            { step: '1', icon: Search, title: 'اختر المعالج', desc: 'ابحث في نخبة معالجينا المعتمدين واختر من يناسب احتياجك وميزانيتك' },
                            { step: '2', icon: CalendarDays, title: 'حدد موعدك', desc: 'اختر التاريخ والوقت المناسب من جدول المعالج المتاح أو احجز جلسة سريعة فورية' },
                            { step: '3', icon: Video, title: 'ابدأ جلستك', desc: 'تأكيد الحجز وإتمام الدفع، ثم احضر جلستك عبر المنصة المحددة في الوقت المناسب' },
                        ].map(({ step, icon: Icon, title, desc }) => (
                            <li key={step} className="flex gap-3.5 rounded-[24px] border border-line bg-paper p-5 sm:p-6">
                                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-ink text-base font-black text-gold-pale">{step}</span>
                                <span className="min-w-0">
                                    <span className="flex items-center gap-2">
                                        <Icon size={18} className="text-primary-700" />
                                        <b className="text-base font-black text-ink">{title}</b>
                                    </span>
                                    <span className="mt-1 block text-sm leading-relaxed text-muted-body">{desc}</span>
                                </span>
                            </li>
                        ))}
                    </ol>
                </div>
            </section>

            {bookingStep === 1 && selectedTherapist && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 animate-fade-in">
                    <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] bg-white shadow-[0_40px_80px_-30px_rgba(26,15,18,.6)]">
                        <div className="flex items-center justify-between gap-3 border-b border-line bg-paper px-5 py-4">
                            <h3 className="min-w-0 text-lg font-black text-ink">حجز موعد مع {selectedTherapist.name}</h3>
                            <button onClick={() => setBookingStep(0)} className="inline-flex min-h-[44px] flex-none items-center gap-1.5 rounded-xl px-3 text-sm font-extrabold text-muted-strong transition hover:bg-white hover:text-primary-700">
                                <X size={16} />
                                إغلاق
                            </button>
                        </div>
                        <div className="space-y-6 overflow-y-auto p-5 sm:p-8">
                            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                                <div className="flex gap-4">
                                    <img loading="lazy" decoding="async" width={64} height={64} src={cdnImg(selectedTherapist.image, 160)} className="h-16 w-16 flex-none rounded-2xl bg-sand object-cover object-top ring-1 ring-line" alt={selectedTherapist.name} />
                                    <div className="min-w-0">
                                        <p className="font-extrabold text-primary-700">{selectedTherapist.specialty}</p>
                                        <p className="text-sm text-muted">سعر الجلسة: <span className="font-black tabular-nums text-ink">{getTherapistSessionPrice(selectedTherapist, currency)} {currencySymbol}</span></p>
                                        <p className="text-sm text-muted">المنصة: <span className="font-bold text-ink">{meetingProviderLabels[selectedTherapist.consultationSettings!.meetingProvider]}</span></p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                    <div className="rounded-2xl border border-line bg-paper p-3">
                                        <p className="text-muted">مدة الجلسة</p>
                                        <p className="font-black text-ink">{selectedTherapist.consultationSettings!.sessionDurationMinutes} دقيقة</p>
                                    </div>
                                    <div className="rounded-2xl border border-line bg-paper p-3">
                                        <p className="text-muted">المواعيد المفعلة</p>
                                        <p className="font-black tabular-nums text-ink">{selectedTherapist.consultationSettings!.availableSlots.filter((slot) => slot.isActive).length}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <div>
                                    <label className="mb-1 block text-[13px] font-bold text-muted-strong">نوع الجلسة</label>
                                    <select className={inputClass} value={selectedSessionType} onChange={(e) => setSelectedSessionType(e.target.value as 'individual' | 'couple' | 'family')}>
                                        <option value="individual">فردية</option>
                                        <option value="couple">زوجية</option>
                                        <option value="family">أسرية</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-[13px] font-bold text-muted-strong">اختر التاريخ</label>
                                    <div className="relative">
                                        <CalendarDays className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-soft" size={18} />
                                        {/* min, so the picker cannot offer a day that has
                                            already gone — the date travels to /checkout in
                                            the URL and was stored verbatim, so a session
                                            could be booked into the past. The route refuses
                                            it too; this is the courtesy, not the guard. */}
                                        <input type="date" min={cairoDateOnly()} className={`${inputClass} pr-11`} value={selectedDate} onChange={(e) => { setSelectedDate(e.target.value); setSelectedSlot(''); }} />
                                    </div>
                                </div>
                            </div>

                            <div>
                                <h4 className="mb-3 text-base font-black text-ink">المواعيد المتاحة</h4>
                                {selectedDate ? (
                                    availableSlots.length > 0 ? (
                                        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                                            {availableSlots.map((slot) => (
                                                <button
                                                    key={slot.id}
                                                    onClick={() => setSelectedSlot(slot.id)}
                                                    aria-pressed={selectedSlot === slot.id}
                                                    className={`min-h-[50px] rounded-xl border-2 px-4 py-3 text-right text-sm font-extrabold transition ${selectedSlot === slot.id ? 'border-primary-700 bg-primary-50/60 text-primary-800' : 'border-line bg-white text-ink hover:border-line-deep'}`}
                                                >
                                                    {formatAvailabilitySlot(slot)}
                                                </button>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="rounded-2xl border border-gold/30 bg-gold-pale/10 p-4 text-sm font-bold text-gold-deep">
                                            لا توجد مواعيد متاحة في هذا اليوم. اختر تاريخاً آخر يوافق جدول المحاضر.
                                        </div>
                                    )
                                ) : (
                                    <div className="rounded-2xl border border-dashed border-line-deep p-4 text-sm text-muted">
                                        اختر التاريخ أولاً لنظهر لك المواعيد المطابقة لجدول المحاضر.
                                    </div>
                                )}
                            </div>

                            {selectedTherapist.consultationSettings?.bookingNotes && (
                                <div className="rounded-2xl border border-line bg-paper p-4 text-sm leading-relaxed text-muted-strong">
                                    {selectedTherapist.consultationSettings.bookingNotes}
                                </div>
                            )}

                            <button
                                disabled={!selectedSlot || !selectedDate}
                                onClick={handleBookRegular}
                                className={`flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl px-7 font-black transition ${selectedSlot && selectedDate ? 'bg-primary-700 text-white hover:bg-primary-800' : 'cursor-not-allowed bg-line text-muted-soft'}`}
                            >
                                تأكيد الحجز والدفع
                                <ArrowLeft size={18} />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Express */}
            <section className="bg-paper px-4 py-14 sm:py-20">
                <div className="container mx-auto max-w-6xl">
                    <div className="grid overflow-hidden rounded-[32px] bg-white shadow-[0_40px_80px_-45px_rgba(26,15,18,.5)] ring-1 ring-line lg:grid-cols-[1.25fr_.75fr]">
                        <div className="flex flex-col justify-center p-6 text-center sm:p-10 lg:p-12 lg:text-right">
                            <span className="mx-auto inline-flex w-fit items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1 text-xs font-extrabold text-primary-700 ring-1 ring-primary-100 lg:mx-0">
                                <Zap size={14} fill="currentColor" />
                                {content['consult.express.badge'] || 'متاح الآن 24/7'}
                            </span>
                            <h2 className="mt-3 text-3xl font-black leading-tight text-ink sm:text-4xl">جلسة استشارة سريعة (Express)</h2>
                            <p className="mt-3 text-base leading-relaxed text-muted-body sm:text-lg">
                                {content['consult.express.desc'] || 'خدمة مخصصة للحالات الطارئة أو لمن يحتاج للفضفضة الفورية. تحدث مع أخصائي نفسي مرخص خلال أقل من 60 دقيقة.'}
                            </p>

                            <div className="mt-6 grid grid-cols-1 gap-2.5 text-right sm:grid-cols-3">
                                {[
                                    { icon: Clock, title: content['consult.express.timeLabel'] || 'فوري', text: content['consult.express.timeValue'] || 'خلال ساعة واحدة' },
                                    { icon: UserCheck, title: 'معتمد', text: 'معالج معتمد ومضمون' },
                                    { icon: Lock, title: 'السرية', text: 'الجلسة تتم في سرية تامة' },
                                ].map(({ icon: Icon, title, text }) => (
                                    <div key={title} className="flex items-center gap-2.5 rounded-2xl bg-paper p-3.5 ring-1 ring-line">
                                        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700"><Icon size={18} /></span>
                                        <span className="min-w-0">
                                            <h4 className="text-sm font-black text-ink">{title}</h4>
                                            <p className="text-xs text-muted">{text}</p>
                                        </span>
                                    </div>
                                ))}
                            </div>

                            <button onClick={handleBookExpress} className="mt-8 inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 px-8 text-lg font-black text-white shadow-[0_16px_30px_-12px_rgba(159,18,57,.8)] transition hover:bg-primary-800 sm:w-auto lg:self-start">
                                احجز جلستك الآن{expressPrice > 0 ? ` (${expressPrice.toLocaleString('ar-EG-u-nu-latn')} ${currencySymbol})` : ''}
                                <ArrowLeft size={20} />
                            </button>
                        </div>
                        <div className="relative flex flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-primary-700 via-primary-800 to-[#4c0519] px-6 py-10 text-center text-white sm:py-12">
                            <div aria-hidden="true" className="absolute inset-0 opacity-[.12]" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.7) 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
                            <span className="relative block rounded-full bg-gradient-to-br from-gold-pale to-gold p-1.5 shadow-2xl">
                                <span className="flex h-40 w-40 items-center justify-center overflow-hidden rounded-full border-4 border-[#4c0519] bg-primary-50 sm:h-48 sm:w-48">
                                    {expressTherapist?.image ? (
                                        <img loading="lazy" decoding="async" width={192} height={192} src={cdnImg(expressTherapist.image, 400)} alt={expressTherapist.name} className="h-full w-full object-cover object-top" />
                                    ) : (
                                        <span className="text-primary-300">
                                            <svg width="80" height="80" fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v2h20v-2c0-3.3-6.7-5-10-5z"/></svg>
                                        </span>
                                    )}
                                </span>
                            </span>
                            <span className="relative mt-5 inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-ink shadow-lg">
                                <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-70 motion-safe:animate-ping" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" /></span>
                                {expressTherapist ? (
                                    <span className="text-sm font-bold">{expressTherapist.name}</span>
                                ) : (
                                    <span className="text-sm font-bold">{consultationTherapists.length} معالجين متاحين</span>
                                )}
                            </span>
                        </div>
                    </div>
                </div>
            </section>

            {/* Therapists */}
            <section id="therapists" className="scroll-mt-24 bg-white py-14 sm:py-20">
                <div className="container mx-auto max-w-6xl px-4">
                    <div className="mb-8 text-center lg:text-right">
                        <span className="text-sm font-extrabold text-gold-deep">احجز مع من يناسبك</span>
                        <h2 className="mt-2 text-3xl font-black leading-tight text-ink sm:text-4xl">نخبة المعالجين النفسيين</h2>
                        <p className="mt-3 text-base leading-relaxed text-muted-body">المعروض هنا فقط هم المحاضرون الذين تم تفعيل خدمة الاستشارات لهم داخل لوحة الإدارة.</p>
                    </div>

                    <div className="mb-8 space-y-3">
                        <div className="relative">
                            <Search className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muted-soft" size={20} />
                            <input
                                type="text"
                                placeholder="ابحث بالاسم أو التخصص أو مجال الخبرة..."
                                className={`${inputClass} pr-12`}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        {specialties.length > 0 && (
                            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="التخصص">
                                <button type="button" aria-pressed={specialtyFilter === 'All'} onClick={() => setSpecialtyFilter('All')} className={pill(specialtyFilter === 'All')}>كل التخصصات</button>
                                {specialties.map((s) => (
                                    <button key={s} type="button" aria-pressed={specialtyFilter === s} onClick={() => setSpecialtyFilter(s)} className={pill(specialtyFilter === s)}>{s}</button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                        {filteredTherapists.map((therapist) => (
                            <article key={therapist.id} className="flex flex-col rounded-[24px] border border-line bg-white p-5 transition duration-300 hover:-translate-y-1 hover:shadow-[0_30px_50px_-25px_rgba(26,15,18,.35)] sm:p-6">
                                <div className="mb-4 flex items-start gap-4">
                                    <div className="relative flex-none">
                                        <img loading="lazy" decoding="async" width={80} height={80} src={cdnImg(therapist.image, 160)} className="h-20 w-20 rounded-[20px] bg-sand object-cover object-top ring-1 ring-line" alt={therapist.name} />
                                        <span aria-hidden="true" className="absolute -bottom-1 -left-1 h-5 w-5 rounded-full border-[3px] border-white bg-green-500" />
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="text-lg font-black leading-snug text-ink">{therapist.name}</h3>
                                        <p className="mt-1 inline-block rounded-full bg-primary-50 px-3 py-1 text-xs font-extrabold text-primary-700">{therapist.specialty}</p>
                                    </div>
                                </div>

                                <div className="mb-4 flex-grow space-y-3">
                                    <p className="line-clamp-2 text-sm leading-relaxed text-muted">{therapist.bio}</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {(therapist.focusAreas || []).slice(0, 3).map((item) => (
                                            <span key={item} className="rounded-full bg-paper px-3 py-1 text-xs font-extrabold text-muted-strong ring-1 ring-line">{item}</span>
                                        ))}
                                    </div>
                                </div>

                                <dl className="mb-5 divide-y divide-line rounded-2xl border border-line text-sm">
                                    <div className="flex items-center justify-between px-4 py-2.5">
                                        <dt className="text-muted">الخبرة</dt>
                                        <dd className="font-bold text-ink">{therapist.experience} سنوات</dd>
                                    </div>
                                    <div className="flex items-center justify-between px-4 py-2.5">
                                        <dt className="text-muted">التقييم</dt>
                                        <dd className="flex items-center gap-1 font-bold text-ink">{therapist.rating} <Star size={13} className="text-gold" fill="currentColor" /></dd>
                                    </div>
                                    <div className="flex items-center justify-between px-4 py-2.5">
                                        <dt className="text-muted">المنصة</dt>
                                        <dd className="font-bold text-ink">{meetingProviderLabels[therapist.consultationSettings!.meetingProvider]}</dd>
                                    </div>
                                </dl>

                                <div className="mt-auto flex items-end justify-between gap-3">
                                    <div>
                                        <span className="block text-[13px] text-muted-soft">سعر الجلسة</span>
                                        <span className="whitespace-nowrap text-[22px] font-black leading-none tabular-nums text-ink">{getTherapistSessionPrice(therapist, currency)} <span className="text-sm font-extrabold text-primary-700">{currencySymbol}</span></span>
                                    </div>
                                    <button onClick={() => { setSelectedTherapist(therapist); setSelectedSlot(''); setSelectedDate(''); setSelectedSessionType('individual'); setBookingStep(1); }} className="inline-flex min-h-[46px] flex-none items-center gap-1.5 whitespace-nowrap rounded-xl bg-primary-700 px-4 text-[15px] font-extrabold text-white transition hover:bg-primary-800">
                                        حجز موعد
                                        <ArrowLeft size={17} />
                                    </button>
                                </div>
                            </article>
                        ))}
                    </div>

                    {filteredTherapists.length === 0 && (
                        <div className="rounded-[24px] border border-dashed border-line-deep bg-paper px-5 py-16 text-center">
                            <p className="text-base leading-relaxed text-muted-body sm:text-lg">لا يوجد معالجون مطابقون للبحث أو لم يتم تفعيل الجلسات لأي محاضر بعد.</p>
                            <button onClick={() => { setSearchTerm(''); setSpecialtyFilter('All'); }} className="mt-5 inline-flex min-h-[48px] items-center justify-center rounded-2xl border-[1.5px] border-ink/15 bg-white px-7 font-extrabold text-ink transition hover:border-ink/40">
                                عرض الكل
                            </button>
                        </div>
                    )}
                </div>
            </section>

            {/* FAQ Section */}
            <section className="bg-paper py-14 sm:py-20">
                <div className="container mx-auto max-w-3xl px-4">
                    <div className="mb-8 text-center">
                        <h2 className="text-3xl font-black leading-tight text-ink sm:text-4xl">الأسئلة الشائعة</h2>
                        <p className="mt-3 text-base leading-relaxed text-muted-body sm:text-lg">إجابات على أكثر الأسئلة شيوعاً حول جلسات الاستشارة</p>
                    </div>
                    <div className="divide-y divide-line rounded-[26px] border border-line bg-white">
                        {[
                            { q: 'هل الجلسات سرية تماماً؟', a: 'نعم، جميع جلساتنا محمية بالكامل. لا يُشارك أي معلومة شخصية مع طرف ثالث، وتجري الجلسات عبر منصات مشفرة ومرخصة.' },
                            { q: 'كيف أختار المعالج المناسب لي؟', a: 'يمكنك مراجعة تخصص كل معالج، ومجالات خبرته، وتقييماته، وسعر الجلسة. نوصي باختيار من يتخصص في مشكلتك تحديداً.' },
                            { q: 'ما الفرق بين الجلسة السريعة والعادية؟', a: 'الجلسة السريعة (Express) متاحة فوراً خلال ساعة للحالات الطارئة بسعر موحد. الجلسة المجدولة تُحجز مسبقاً مع معالج محدد تختاره بنفسك.' },
                            { q: 'هل يمكنني إلغاء الجلسة بعد الحجز؟', a: content['consult.cancelPolicy'] || 'يمكن إلغاء الجلسة قبل 24 ساعة من موعدها واسترداد المبلغ كاملاً. الإلغاء المتأخر يخضع لسياسة الاسترداد الجزئي.' },
                            { q: 'ما المنصات المستخدمة في الجلسات عن بعد؟', a: 'تتفاوت المنصة حسب المعالج المختار (Zoom, Google Meet, Microsoft Teams). ستجد المنصة موضحة في صفحة كل معالج.' },
                        ].map((item, i) => (
                            <div key={i}>
                                <button type="button" aria-expanded={faqOpen === i} onClick={() => setFaqOpen(faqOpen === i ? null : i)} className="flex min-h-[60px] w-full items-center justify-between gap-4 px-5 py-4 text-right text-base font-extrabold text-ink sm:text-[17px]">
                                    <span>{item.q}</span>
                                    <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-full transition ${faqOpen === i ? 'rotate-45 bg-primary-700 text-white' : 'bg-paper text-muted-strong'}`}><Plus size={18} /></span>
                                </button>
                                {faqOpen === i && (
                                    <div className="px-5 pb-5 text-[15px] leading-[1.9] text-muted-body">{item.a}</div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </section>
        </div>
    );
};

export default Consultations;
