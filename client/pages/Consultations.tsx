import React, { useMemo, useState, useEffect } from 'react';
import { Zap, Star, Shield, Clock, ChevronLeft, Search, Filter, UserCheck, Lock, CalendarDays, CheckCircle, ChevronDown, ChevronUp, BookOpen, Phone, Video, MessageCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Currency, Therapist } from '../types';
import { useSiteData } from '../context/SiteDataContext';
import { formatAvailabilitySlot, getTherapistActiveSlots, getTherapistSessionPrice, isConsultationEnabled, meetingProviderLabels } from '../lib/consultations';

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

    const currencySymbol = currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : '$';

    useEffect(() => { document.title = 'العيادة النفسية | معهد الدراسات النفسية'; }, []);

    const consultationTherapists = useMemo(() => therapists.filter(isConsultationEnabled), [therapists]);
    const availableSlots = selectedTherapist ? getTherapistActiveSlots(selectedTherapist, selectedDate) : [];

    const expressTherapist = useMemo(() => {
        const tid = content['express.therapistId'];
        return tid ? therapists.find((t) => t.id === tid) ?? null : null;
    }, [content, therapists]);
    const expressPriceEGP = Number(content['express.price.EGP'] || '300');
    const expressPriceSAR = Number(content['express.price.SAR'] || '100');
    const expressPriceUSD = Number(content['express.price.USD'] || '20');
    const expressPrice = currency === 'EGP' ? expressPriceEGP : currency === 'SAR' ? expressPriceSAR : expressPriceUSD;

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

    return (
        <div className="bg-gray-50 min-h-screen">
            {/* Hero */}
            <div className="bg-gradient-to-br from-gray-900 via-red-950 to-gray-900 text-white py-20 relative overflow-hidden">
                <div className="absolute inset-0" style={{ backgroundImage: `url('https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=1400&q=80')`, backgroundSize: 'cover', backgroundPosition: 'center', opacity: 0.12 }}></div>
                <div className="absolute top-0 right-0 w-96 h-96 bg-red-700 rounded-full blur-[120px] opacity-20"></div>
                <div className="absolute bottom-0 left-0 w-80 h-80 bg-primary-800 rounded-full blur-[100px] opacity-20"></div>
                <div className="container mx-auto px-4 relative z-10 text-center">
                    <div className="inline-flex items-center gap-2 bg-red-600/20 border border-red-400/30 rounded-full px-4 py-1.5 text-sm font-medium mb-5">
                        <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                        {consultationTherapists.length} معالج متاح الآن
                    </div>
                    <h1 className="text-4xl md:text-5xl font-extrabold mb-4">العيادة النفسية</h1>
                    <p className="text-gray-300 text-lg max-w-2xl mx-auto leading-relaxed">
                        احجز جلستك مع نخبة من المعالجين النفسيين المعتمدين. سرية تامة، مواعيد مرنة، ونتائج مثبتة علمياً.
                    </p>
                    <div className="flex flex-wrap justify-center gap-4 mt-8">
                        {[
                            { icon: Shield, label: 'سرية تامة', sub: '100% خصوصية' },
                            { icon: UserCheck, label: 'معالجون معتمدون', sub: 'خبرات موثقة' },
                            { icon: Clock, label: 'مواعيد مرنة', sub: 'أسبوعياً وعطل' },
                            { icon: Star, label: 'تقييم مرتفع', sub: '4.9 من 5 نجوم' },
                        ].map(({ icon: Icon, label, sub }) => (
                            <div key={label} className="flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/10 rounded-2xl px-4 py-3 text-sm">
                                <Icon size={18} className="text-red-300" />
                                <div className="text-right">
                                    <div className="font-bold text-white">{label}</div>
                                    <div className="text-gray-400 text-xs">{sub}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* How it works */}
            <div className="bg-white border-b border-gray-100">
                <div className="container mx-auto px-4 py-12 max-w-5xl">
                    <h2 className="text-2xl font-extrabold text-gray-900 text-center mb-2">كيف تحجز جلستك؟</h2>
                    <p className="text-gray-500 text-center text-sm mb-10">ثلاث خطوات بسيطة</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
                        <div className="hidden md:block absolute top-10 left-1/4 right-1/4 h-0.5 bg-gradient-to-r from-primary-200 to-red-200"></div>
                        {[
                            { step: '١', icon: Search, title: 'اختر المعالج', desc: 'ابحث في نخبة معالجينا المعتمدين واختر من يناسب احتياجك وميزانيتك', color: 'bg-blue-50 text-blue-600' },
                            { step: '٢', icon: CalendarDays, title: 'حدد موعدك', desc: 'اختر التاريخ والوقت المناسب من جدول المعالج المتاح أو احجز جلسة سريعة فورية', color: 'bg-emerald-50 text-emerald-600' },
                            { step: '٣', icon: Video, title: 'ابدأ جلستك', desc: 'تأكيد الحجز وإتمام الدفع، ثم احضر جلستك عبر المنصة المحددة في الوقت المناسب', color: 'bg-primary-50 text-primary-600' },
                        ].map(({ step, icon: Icon, title, desc, color }) => (
                            <div key={step} className="flex flex-col items-center text-center p-6 rounded-2xl border border-gray-100 bg-gray-50 relative">
                                <div className="absolute -top-4 right-1/2 translate-x-1/2 w-8 h-8 bg-white border-2 border-primary-200 rounded-full flex items-center justify-center font-extrabold text-primary-600 text-sm shadow">{step}</div>
                                <div className={`p-4 rounded-2xl mb-4 mt-4 ${color}`}><Icon size={26} /></div>
                                <h3 className="font-bold text-gray-900 mb-2">{title}</h3>
                                <p className="text-gray-500 text-sm leading-relaxed">{desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="container mx-auto px-4 max-w-6xl relative z-20 py-12">
                {bookingStep === 1 && selectedTherapist && (
                    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden">
                            <div className="bg-gray-50 p-4 border-b flex justify-between items-center">
                                <h3 className="font-bold text-gray-800">حجز موعد مع {selectedTherapist.name}</h3>
                                <button onClick={() => setBookingStep(0)} className="text-gray-500 hover:text-red-600 font-bold transition">إغلاق</button>
                            </div>
                            <div className="p-4 sm:p-8 space-y-6 overflow-y-auto max-h-[75vh]">
                                <div className="flex flex-col md:flex-row gap-4 md:items-center md:justify-between">
                                    <div className="flex gap-4">
                                        <img loading="lazy" decoding="async" src={selectedTherapist.image} className="w-16 h-16 rounded-full object-cover border border-gray-200" alt={selectedTherapist.name} />
                                        <div>
                                            <p className="text-primary-600 font-bold">{selectedTherapist.specialty}</p>
                                            <p className="text-gray-500 text-sm">سعر الجلسة: <span className="text-black font-bold">{getTherapistSessionPrice(selectedTherapist, currency)} {currencySymbol}</span></p>
                                            <p className="text-gray-500 text-sm">المنصة: <span className="text-black font-bold">{meetingProviderLabels[selectedTherapist.consultationSettings!.meetingProvider]}</span></p>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 text-sm">
                                        <div className="border border-gray-200 rounded-xl p-3 bg-gray-50">
                                            <p className="text-gray-500">مدة الجلسة</p>
                                            <p className="font-bold text-gray-900">{selectedTherapist.consultationSettings!.sessionDurationMinutes} دقيقة</p>
                                        </div>
                                        <div className="border border-gray-200 rounded-xl p-3 bg-gray-50">
                                            <p className="text-gray-500">المواعيد المفعلة</p>
                                            <p className="font-bold text-gray-900">{selectedTherapist.consultationSettings!.availableSlots.filter((slot) => slot.isActive).length}</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block font-bold mb-2 text-gray-800">نوع الجلسة</label>
                                        <select className="w-full border border-gray-300 rounded-xl px-4 py-3" value={selectedSessionType} onChange={(e) => setSelectedSessionType(e.target.value as 'individual' | 'couple' | 'family')}>
                                            <option value="individual">فردية</option>
                                            <option value="couple">زوجية</option>
                                            <option value="family">أسرية</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block font-bold mb-2 text-gray-800">اختر التاريخ</label>
                                        <div className="relative">
                                            <CalendarDays className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                            <input type="date" className="w-full border border-gray-300 rounded-xl px-10 py-3" value={selectedDate} onChange={(e) => { setSelectedDate(e.target.value); setSelectedSlot(''); }} />
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <h4 className="font-bold mb-3 text-gray-800">المواعيد المتاحة</h4>
                                    {selectedDate ? (
                                        availableSlots.length > 0 ? (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                {availableSlots.map((slot) => (
                                                    <button
                                                        key={slot.id}
                                                        onClick={() => setSelectedSlot(slot.id)}
                                                        className={`py-3 px-4 rounded-xl text-sm font-bold border transition text-right ${selectedSlot === slot.id ? 'bg-primary-600 text-white border-primary-600 shadow-md' : 'bg-white border-gray-200 hover:border-primary-500 text-gray-700 hover:bg-gray-50'}`}
                                                    >
                                                        {formatAvailabilitySlot(slot)}
                                                    </button>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="border border-amber-200 bg-amber-50 text-amber-700 rounded-xl p-4 text-sm">
                                                لا توجد مواعيد متاحة في هذا اليوم. اختر تاريخاً آخر يوافق جدول المحاضر.
                                            </div>
                                        )
                                    ) : (
                                        <div className="border border-dashed border-gray-300 rounded-xl p-4 text-sm text-gray-500">
                                            اختر التاريخ أولاً لنظهر لك المواعيد المطابقة لجدول المحاضر.
                                        </div>
                                    )}
                                </div>

                                {selectedTherapist.consultationSettings?.bookingNotes && (
                                    <div className="border border-blue-200 bg-blue-50 text-blue-700 rounded-xl p-4 text-sm">
                                        {selectedTherapist.consultationSettings.bookingNotes}
                                    </div>
                                )}

                                <button
                                    disabled={!selectedSlot || !selectedDate}
                                    onClick={handleBookRegular}
                                    className={`w-full py-3 rounded-xl font-bold transition flex items-center justify-center gap-2 ${selectedSlot && selectedDate ? 'bg-primary-600 text-white hover:bg-primary-700 shadow-lg' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
                                >
                                    تأكيد الحجز والدفع
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                <div className="bg-white rounded-3xl shadow-xl mb-16 animate-fade-in border border-gray-200 overflow-hidden">
                    <div className="bg-gradient-to-br from-red-600 to-red-800 p-1">
                        <div className="bg-white rounded-[20px] p-8 md:p-12 overflow-hidden relative">
                            <div className="absolute top-0 right-0 w-64 h-64 bg-red-50 blur-[80px] opacity-50"></div>
                            <div className="flex flex-col md:flex-row gap-12 items-center relative z-10">
                                <div className="flex-1">
                                    <div className="inline-flex items-center gap-2 bg-red-100 text-red-700 text-xs font-bold px-3 py-1 rounded-full mb-4">
                                        <Zap size={14} fill="currentColor" />
                                        {content['consult.express.badge'] || 'متاح الآن 24/7'}
                                    </div>
                                    <h2 className="text-3xl font-bold text-gray-900 mb-4">جلسة استشارة سريعة (Express)</h2>
                                    <p className="text-gray-600 mb-8 leading-relaxed text-lg">
                                        {content['consult.express.desc'] || 'خدمة مخصصة للحالات الطارئة أو لمن يحتاج للفضفضة الفورية. تحدث مع أخصائي نفسي مرخص خلال أقل من 60 دقيقة.'}
                                    </p>

                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                                        <div className="bg-gray-50 p-5 rounded-xl border border-gray-100 hover:border-red-200 transition duration-300">
                                            <Clock className="text-red-600 mb-3" size={24} />
                                            <h4 className="text-gray-900 font-bold text-sm mb-1">{content['consult.express.timeLabel'] || 'فوري'}</h4>
                                            <p className="text-gray-500 text-xs">{content['consult.express.timeValue'] || 'خلال ساعة واحدة'}</p>
                                        </div>
                                        <div className="bg-gray-50 p-5 rounded-xl border border-gray-100 hover:border-red-200 transition duration-300">
                                            <UserCheck className="text-red-600 mb-3" size={24} />
                                            <h4 className="text-gray-900 font-bold text-sm mb-1">معتمد</h4>
                                            <p className="text-gray-500 text-xs">معالج معتمد ومضمون</p>
                                        </div>
                                        <div className="bg-gray-50 p-5 rounded-xl border border-gray-100 hover:border-red-200 transition duration-300">
                                            <Lock className="text-red-600 mb-3" size={24} />
                                            <h4 className="text-gray-900 font-bold text-sm mb-1">السرية</h4>
                                            <p className="text-gray-500 text-xs">الجلسة تتم في سرية تامة</p>
                                        </div>
                                    </div>

                                    <button onClick={handleBookExpress} className="w-full sm:w-auto bg-primary-600 hover:bg-primary-700 text-white font-bold py-4 px-8 rounded-xl transition shadow-lg shadow-primary-200 text-lg flex items-center justify-center gap-2">
                                        احجز جلستك الآن ({expressPrice.toLocaleString('ar-EG-u-nu-latn')} {currencySymbol})
                                        <ChevronLeft className="rtl:rotate-180" />
                                    </button>
                                </div>
                                <div className="w-full md:w-1/3 flex justify-center">
                                    <div className="relative group">
                                        <div className="absolute inset-0 bg-red-200 rounded-full blur-2xl opacity-40 group-hover:opacity-60 transition duration-500"></div>
                                        <div className="w-64 h-64 md:w-80 md:h-80 rounded-full border-8 border-white shadow-2xl relative z-10 bg-gradient-to-br from-primary-50 to-red-50 flex items-center justify-center overflow-hidden">
                                            {expressTherapist?.image ? (
                                                <img loading="lazy" decoding="async" src={expressTherapist.image} alt={expressTherapist.name} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="text-primary-300 opacity-60">
                                                    <svg width="80" height="80" fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v2h20v-2c0-3.3-6.7-5-10-5z"/></svg>
                                                </div>
                                            )}
                                        </div>
                                        <div className="absolute bottom-6 right-0 bg-white text-gray-800 p-3 rounded-xl shadow-lg border border-gray-100 z-20 flex gap-3 items-center">
                                            <div className="w-3 h-3 bg-green-500 rounded-full animate-ping"></div>
                                            {expressTherapist ? (
                                                <span className="text-sm font-bold">{expressTherapist.name}</span>
                                            ) : (
                                                <span className="text-sm font-bold">{consultationTherapists.length} معالجين متاحين</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div id="therapists" className="animate-slide-up">
                    <div className="flex flex-col md:flex-row justify-between items-end mb-8 gap-4">
                        <div>
                            <h2 className="text-3xl font-bold text-gray-900 mb-2">نخبة المعالجين النفسيين</h2>
                            <p className="text-gray-500">المعروض هنا فقط هم المحاضرون الذين تم تفعيل خدمة الاستشارات لهم داخل لوحة الإدارة.</p>
                        </div>
                    </div>

                    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm mb-8 flex flex-col md:flex-row gap-4">
                        <div className="flex-1 relative">
                            <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                            <input
                                type="text"
                                placeholder="ابحث بالاسم أو التخصص أو مجال الخبرة..."
                                className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-lg pl-4 pr-10 py-3 focus:outline-none focus:border-primary-600 focus:ring-1 focus:ring-primary-600 placeholder-gray-400 transition"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <div className="w-full md:w-1/4 relative">
                            <Filter className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                            <select
                                className="w-full bg-gray-50 border border-gray-200 text-gray-700 rounded-lg pl-4 pr-10 py-3 focus:outline-none focus:border-primary-600 appearance-none cursor-pointer transition"
                                value={specialtyFilter}
                                onChange={(e) => setSpecialtyFilter(e.target.value)}
                            >
                                <option value="All">كل التخصصات</option>
                                {specialties.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredTherapists.map((therapist) => (
                            <div key={therapist.id} className="bg-white rounded-2xl p-6 hover:shadow-xl transition duration-300 group border border-gray-100 hover:border-primary-100 relative overflow-hidden flex flex-col">
                                <div className="flex items-start gap-4 mb-4">
                                    <div className="relative">
                                        <img loading="lazy" decoding="async" src={therapist.image} className="w-20 h-20 rounded-full object-cover border-2 border-gray-100 group-hover:border-primary-600 transition" alt={therapist.name} />
                                        <div className="absolute bottom-0 right-0 w-5 h-5 bg-green-500 border-2 border-white rounded-full"></div>
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-xl text-gray-900 mb-1">{therapist.name}</h3>
                                        <p className="text-primary-600 text-sm font-medium bg-primary-50 px-2 py-1 rounded-md inline-block">{therapist.specialty}</p>
                                    </div>
                                </div>

                                <div className="flex-grow mb-4 space-y-3">
                                    <p className="text-gray-500 text-sm line-clamp-2 leading-relaxed">{therapist.bio}</p>
                                    <div className="flex flex-wrap gap-2">
                                        {(therapist.focusAreas || []).slice(0, 3).map((item) => (
                                            <span key={item} className="px-2 py-1 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">{item}</span>
                                        ))}
                                    </div>
                                </div>

                                <div className="space-y-3 mb-6">
                                    <div className="flex items-center justify-between text-sm border-b border-gray-50 pb-2">
                                        <span className="text-gray-500">الخبرة</span>
                                        <span className="font-bold text-gray-800">{therapist.experience} سنوات</span>
                                    </div>
                                    <div className="flex items-center justify-between text-sm border-b border-gray-50 pb-2">
                                        <span className="text-gray-500">التقييم</span>
                                        <span className="font-bold text-yellow-500 flex items-center gap-1">{therapist.rating} <Star size={12} fill="currentColor" /></span>
                                    </div>
                                    <div className="flex items-center justify-between text-sm border-b border-gray-50 pb-2">
                                        <span className="text-gray-500">المنصة</span>
                                        <span className="font-bold text-gray-800">{meetingProviderLabels[therapist.consultationSettings!.meetingProvider]}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="text-gray-500">سعر الجلسة</span>
                                        <span className="font-bold text-gray-900 text-lg">{getTherapistSessionPrice(therapist, currency)} <span className="text-xs font-normal text-gray-500">{currencySymbol}</span></span>
                                    </div>
                                </div>

                                <button onClick={() => { setSelectedTherapist(therapist); setSelectedSlot(''); setSelectedDate(''); setSelectedSessionType('individual'); setBookingStep(1); }} className="w-full bg-gray-900 text-white font-bold py-3 rounded-xl hover:bg-primary-600 transition shadow-md hover:shadow-lg mt-auto">
                                    حجز موعد
                                </button>
                            </div>
                        ))}
                    </div>

                    {filteredTherapists.length === 0 && (
                        <div className="text-center py-20 bg-white rounded-2xl border border-gray-200">
                            <p className="text-gray-500 text-lg">لا يوجد معالجون مطابقون للبحث أو لم يتم تفعيل الجلسات لأي محاضر بعد.</p>
                            <button onClick={() => { setSearchTerm(''); setSpecialtyFilter('All'); }} className="mt-4 text-primary-600 font-bold hover:underline">
                                عرض الكل
                            </button>
                        </div>
                    )}
                </div>

                {/* FAQ Section */}
                <div className="mt-20 animate-fade-in">
                    <div className="text-center mb-10">
                        <h2 className="text-3xl font-extrabold text-gray-900 mb-2">الأسئلة الشائعة</h2>
                        <p className="text-gray-500">إجابات على أكثر الأسئلة شيوعاً حول جلسات الاستشارة</p>
                    </div>
                    <div className="max-w-3xl mx-auto space-y-3">
                        {[
                            { q: 'هل الجلسات سرية تماماً؟', a: 'نعم، جميع جلساتنا محمية بالكامل. لا يُشارك أي معلومة شخصية مع طرف ثالث، وتجري الجلسات عبر منصات مشفرة ومرخصة.' },
                            { q: 'كيف أختار المعالج المناسب لي؟', a: 'يمكنك مراجعة تخصص كل معالج، ومجالات خبرته، وتقييماته، وسعر الجلسة. نوصي باختيار من يتخصص في مشكلتك تحديداً.' },
                            { q: 'ما الفرق بين الجلسة السريعة والعادية؟', a: 'الجلسة السريعة (Express) متاحة فوراً خلال ساعة للحالات الطارئة بسعر موحد. الجلسة المجدولة تُحجز مسبقاً مع معالج محدد تختاره بنفسك.' },
                            { q: 'هل يمكنني إلغاء الجلسة بعد الحجز؟', a: content['consult.cancelPolicy'] || 'يمكن إلغاء الجلسة قبل 24 ساعة من موعدها واسترداد المبلغ كاملاً. الإلغاء المتأخر يخضع لسياسة الاسترداد الجزئي.' },
                            { q: 'ما المنصات المستخدمة في الجلسات عن بعد؟', a: 'تتفاوت المنصة حسب المعالج المختار (Zoom, Google Meet, Microsoft Teams). ستجد المنصة موضحة في صفحة كل معالج.' },
                        ].map((item, i) => (
                            <div key={i} className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                                <button onClick={() => setFaqOpen(faqOpen === i ? null : i)} className="w-full flex items-center justify-between p-5 text-right hover:bg-gray-50 transition">
                                    <span className="font-bold text-gray-900">{item.q}</span>
                                    {faqOpen === i ? <ChevronUp size={18} className="text-primary-600 flex-shrink-0" /> : <ChevronDown size={18} className="text-gray-400 flex-shrink-0" />}
                                </button>
                                {faqOpen === i && (
                                    <div className="px-5 pb-5 text-gray-600 text-sm leading-relaxed border-t border-gray-50 pt-4">{item.a}</div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Consultations;