import React, { useMemo, useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Star, Shield, Users, BookOpen, Facebook, Twitter, Linkedin, MessageCircle, X, CalendarDays, Globe2, BriefcaseBusiness } from 'lucide-react';
import { Currency } from '../types';
import CourseCard from '../components/CourseCard';
import { useSiteData } from '../context/SiteDataContext';
import { formatAvailabilitySlot, getTherapistActiveSlots, getTherapistSessionPrice, isConsultationEnabled, meetingProviderLabels } from '../lib/consultations';
import { cdnImg } from '../lib/img';

const InstructorDetails: React.FC = () => {
  const { therapists, courses, currency } = useSiteData();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const instructor = therapists.find((t) => t.id === id);
  useEffect(() => { document.title = (instructor?.name || 'المحاضرون والخبراء') + ' | معهد الدراسات النفسية'; }, [instructor?.name]);

  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSessionType, setSelectedSessionType] = useState<'individual' | 'couple' | 'family'>('individual');

  const currencySymbol = currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : '$';

  if (!instructor) {
    return <div className="text-center py-20">المدرب غير موجود</div>;
  }

  const instructorCourses = courses.filter((c) => c.instructor === instructor.name);
  const canBookConsultation = isConsultationEnabled(instructor);
  const availableSlots = useMemo(() => getTherapistActiveSlots(instructor, selectedDate), [instructor, selectedDate]);

  const handleBookRegular = () => {
    if (selectedSlot && selectedDate) {
      navigate(`/checkout?type=consultation&subtype=regular&therapistId=${instructor.id}&slotId=${selectedSlot}&date=${selectedDate}&sessionType=${selectedSessionType}`);
    }
  };

  return (
    <div className="bg-gray-50 min-h-screen pb-20 relative">
      {isBookingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden">
            <div className="bg-gray-50 p-4 border-b flex justify-between items-center">
              <h3 className="font-bold text-gray-800">حجز موعد مع {instructor.name}</h3>
              <button onClick={() => setIsBookingModalOpen(false)} className="text-gray-500 hover:text-red-600 transition">
                <X size={24} />
              </button>
            </div>

            <div className="p-6">
              <div className="flex items-center gap-4 mb-6 bg-primary-50 p-4 rounded-xl border border-primary-100">
                {instructor.image ? <img loading="lazy" decoding="async" src={cdnImg(instructor.image, 120)} className="w-12 h-12 rounded-full object-cover" alt={instructor.name} /> : <div className="w-12 h-12 rounded-full bg-primary-200 flex items-center justify-center text-primary-700 font-bold text-lg">{instructor.name?.[0] ?? '?'}</div>}
                <div>
                  <p className="font-bold text-primary-900 text-sm">سعر الجلسة</p>
                  <p className="font-bold text-xl text-primary-600">{getTherapistSessionPrice(instructor, currency)} {currencySymbol}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block font-bold mb-2 text-gray-800 text-sm">نوع الجلسة</label>
                  <select className="w-full border border-gray-300 rounded-xl px-4 py-3" value={selectedSessionType} onChange={(e) => setSelectedSessionType(e.target.value as 'individual' | 'couple' | 'family')}>
                    <option value="individual">فردية</option>
                    <option value="couple">زوجية</option>
                    <option value="family">أسرية</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold mb-2 text-gray-800 text-sm">التاريخ</label>
                  <div className="relative">
                    <CalendarDays className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input type="date" className="w-full border border-gray-300 rounded-xl px-10 py-3" value={selectedDate} onChange={(e) => { setSelectedDate(e.target.value); setSelectedSlot(''); }} />
                  </div>
                </div>
              </div>

              <h4 className="font-bold mb-3 text-gray-800 text-sm">المواعيد المتاحة (بتوقيت القاهرة)</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-6">
                {availableSlots.map((slot) => (
                  <button
                    key={slot.id}
                    onClick={() => setSelectedSlot(slot.id)}
                    className={`py-3 px-3 rounded-lg text-sm font-medium border transition text-right ${selectedSlot === slot.id ? 'bg-primary-600 text-white border-primary-600 shadow-md' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                  >
                    {formatAvailabilitySlot(slot)}
                  </button>
                ))}
              </div>
              {selectedDate && availableSlots.length === 0 && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-6">لا توجد مواعيد لهذا اليوم.</p>}

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

      <div className="h-64 bg-gray-900 relative">
        <div className="absolute inset-0 bg-gradient-to-r from-primary-900 to-gray-900 opacity-90"></div>
      </div>

      <div className="container mx-auto px-4 -mt-32 relative z-10">
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
          <div className="flex flex-col md:flex-row gap-8 items-start">
            <div className="w-40 h-40 rounded-2xl overflow-hidden border-4 border-white shadow-lg flex-shrink-0 bg-gray-200">
              <img loading="lazy" decoding="async" src={cdnImg(instructor.image, 640)} className="w-full h-full object-cover" alt={instructor.name} />
            </div>

            <div className="flex-1 pt-2">
              <div className="flex justify-between items-start flex-wrap gap-4">
                <div>
                  <h1 className="text-3xl font-bold text-gray-900 mb-1">{instructor.name}</h1>
                  <p className="text-primary-600 font-medium text-lg">{instructor.title}</p>
                </div>
                <div className="flex gap-3">
                  <button className="bg-gray-100 hover:bg-gray-200 p-2 rounded-full text-blue-600 transition"><Facebook size={20} /></button>
                  <button className="bg-gray-100 hover:bg-gray-200 p-2 rounded-full text-blue-400 transition"><Twitter size={20} /></button>
                  <button className="bg-gray-100 hover:bg-gray-200 p-2 rounded-full text-blue-800 transition"><Linkedin size={20} /></button>
                </div>
              </div>

              <p className="text-gray-600 mt-6 leading-relaxed text-lg max-w-3xl">
                {instructor.bio || 'نبذة مختصرة عن المدرب وخبراته...'}
              </p>

              <div className="flex flex-wrap gap-2 mt-4">
                {(instructor.focusAreas || []).map((item) => (
                  <span key={item} className="px-3 py-1 rounded-full bg-primary-50 text-primary-700 text-sm font-medium">{item}</span>
                ))}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                  <div className="flex items-center gap-2 text-primary-600 mb-1">
                    <Users size={20} />
                    <span className="font-bold text-xl">5000+</span>
                  </div>
                  <p className="text-gray-500 text-sm">طالب ومتدرب</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                  <div className="flex items-center gap-2 text-primary-600 mb-1">
                    <Shield size={20} />
                    <span className="font-bold text-xl">{instructor.experience}</span>
                  </div>
                  <p className="text-gray-500 text-sm">سنوات خبرة</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                  <div className="flex items-center gap-2 text-yellow-500 mb-1">
                    <Star size={20} fill="currentColor" />
                    <span className="font-bold text-xl">{instructor.rating}</span>
                  </div>
                  <p className="text-gray-500 text-sm">تقييم المدرب</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                  <div className="flex items-center gap-2 text-primary-600 mb-1">
                    <BookOpen size={20} />
                    <span className="font-bold text-xl">{instructorCourses.length}</span>
                  </div>
                  <p className="text-gray-500 text-sm">دبلومات منشورة</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                  <div className="flex items-center gap-2 text-primary-600 mb-2">
                    <Globe2 size={18} />
                    <span className="font-bold">اللغات</span>
                  </div>
                  <p className="text-gray-600 text-sm">{(instructor.languages || []).join(' - ') || 'العربية'}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                  <div className="flex items-center gap-2 text-primary-600 mb-2">
                    <BriefcaseBusiness size={18} />
                    <span className="font-bold">المؤهلات</span>
                  </div>
                  <p className="text-gray-600 text-sm">{(instructor.qualifications || []).slice(0, 2).join(' - ') || instructor.specialty}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                  <div className="flex items-center gap-2 text-primary-600 mb-2">
                    <CalendarDays size={18} />
                    <span className="font-bold">الاستشارات</span>
                  </div>
                  <p className="text-gray-600 text-sm">{canBookConsultation ? `${meetingProviderLabels[instructor.consultationSettings!.meetingProvider]} • ${getTherapistSessionPrice(instructor, currency)} ${currencySymbol}` : 'غير متاح حالياً'}</p>
                </div>
              </div>

              <div className="mt-8 flex gap-4">
                <button
                  onClick={() => { if (canBookConsultation) setIsBookingModalOpen(true); }}
                  disabled={!canBookConsultation}
                  className={`px-6 py-3 rounded-xl font-bold transition flex items-center gap-2 shadow-lg ${canBookConsultation ? 'bg-primary-600 hover:bg-primary-700 text-white shadow-primary-500/30' : 'bg-gray-200 text-gray-500 cursor-not-allowed shadow-transparent'}`}
                >
                  <MessageCircle size={18} />
                  {canBookConsultation ? 'حجز استشارة خاصة' : 'الاستشارات غير مفعلة لهذا المحاضر'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-6 border-r-4 border-primary-600 pr-3">الدبلومات والكورسات المقدمة</h2>
          {instructorCourses.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {instructorCourses.map((course) => (
                <CourseCard key={course.id} course={course} currency={currency} />
              ))}
            </div>
          ) : (
            <p className="text-gray-500">لا توجد كورسات مسجلة لهذا المدرب حالياً.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default InstructorDetails;