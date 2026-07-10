import React from 'react';
import { Award, PlayCircle, Quote, Star, ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';
import type { TestimonialItem } from '../../types';

// Default FAQ — editable from لوحة التحكم → صفحات الموقع → صفحة الكورسات (key: courseDetails.faqList).
// Format: one "السؤال :: الجواب" per line.
const DEFAULT_FAQ = [
  'هل الشهادة معتمدة وموثّقة؟ :: نعم، شهاداتنا معتمدة وموثّقة برقم تسلسلي، ويمكن توثيقها من جهات خارجية حسب البرنامج.',
  'المحتوى مسجّل أم مباشر؟ :: حسب نوع البرنامج (مسجّل / مباشر / هجين) موضّح أعلى الصفحة، والمسجّل تقدر تشاهده في أي وقت.',
  'كم مدة الوصول للمحتوى؟ :: وصول كامل لمدة سنة من تاريخ الاشتراك.',
  'هل يوجد تقسيط؟ :: نعم، نوفّر خطط تقسيط مرنة — تواصل معنا على واتساب لمعرفة التفاصيل.',
  'ماذا لو لم يناسبني البرنامج؟ :: لديك ضمان استرداد خلال 7 أيام إن لم يكن البرنامج مناسباً لك.',
  'هل أحصل على دعم أثناء الدراسة؟ :: نعم، دعم مستمر عبر المجتمع والواتساب طوال فترة البرنامج.',
].join('\n');

interface ReviewsFaqSectionProps {
  content: Record<string, string>;
  testimonials: TestimonialItem[];
  openFaq: number | null;
  setOpenFaq: (idx: number | null) => void;
}

export const ReviewsFaqSection: React.FC<ReviewsFaqSectionProps> = ({ content, testimonials, openFaq, setOpenFaq }) => {
  return (
    <>
      {/* FAQ */}
      <section>
          <h2 className="text-2xl font-bold mb-6 text-gray-900 border-r-4 border-primary-600 pr-3">{content['courseDetails.faq.title'] || 'أسئلة شائعة'}</h2>
          <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition">
                  <h3 className="font-bold flex items-center gap-2 mb-2 text-gray-800">
                      <Award size={20} className="text-primary-500" />
                      {content['courseDetails.faq.q1'] || 'هل الشهادة معتمدة؟'}
                  </h3>
                  <p className="text-gray-600 text-sm leading-relaxed">{content['courseDetails.faq.a1'] || 'نعم، الشهادة معتمدة من المعهد وتحمل كود تحقق (QR Code). كما يمكن توثيقها من الخارجية وجهات دولية برسوم إضافية.'}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition">
                  <h3 className="font-bold flex items-center gap-2 mb-2 text-gray-800">
                      <PlayCircle size={20} className="text-primary-500" />
                      {content['courseDetails.faq.q2'] || 'هل يمكنني مشاهدة المحاضرات لاحقاً؟'}
                  </h3>
                  <p className="text-gray-600 text-sm leading-relaxed">{content['courseDetails.faq.a2'] || 'بالتأكيد! جميع المحاضرات (سواء المسجلة أو البث المباشر) تظل محفوظة في حسابك لمدة سنة واحدة ويمكنك الرجوع إليها في أي وقت.'}</p>
              </div>
          </div>
      </section>

      {/* ── Customer Reviews ── */}
      {testimonials.length > 0 && (
        <section className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm">
          <h2 className="text-2xl font-bold mb-6 text-gray-900 border-r-4 border-red-500 pr-3">{content['courseDetails.reviews.title'] || 'آراء طلاب الكورس'}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {testimonials.slice(0, 3).map((t) => (
              <div key={t.id} className="bg-gray-50 border border-gray-100 rounded-2xl p-5 relative shadow-sm hover:shadow-md transition">
                <Quote size={28} className="text-red-200 absolute top-4 left-4" />
                <div className="flex items-center gap-3 mb-3">
                  {t.image ? (
                    <img loading="lazy" decoding="async" src={t.image} alt={t.name} className="w-11 h-11 rounded-full object-cover border-2 border-red-200 flex-shrink-0" />
                  ) : (
                    <div className="w-11 h-11 rounded-full bg-red-100 text-red-700 flex items-center justify-center font-bold text-lg flex-shrink-0">{t.name.charAt(0)}</div>
                  )}
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 text-sm truncate">{t.name}</p>
                    <p className="text-xs text-gray-500 truncate">{t.role}</p>
                  </div>
                </div>
                <div className="flex gap-0.5 mb-2">
                  {[...Array(5)].map((_, i) => <Star key={i} size={13} className="text-yellow-400 fill-yellow-400" />)}
                </div>
                <p className="text-sm text-gray-700 leading-relaxed line-clamp-4 relative z-10">{t.text}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* FAQ — editable: لوحة التحكم → صفحات الموقع → صفحة الكورسات (courseDetails.faqList) */}
      <section>
        <h2 className="text-2xl font-bold text-gray-900 mb-5 flex items-center gap-2">
          <HelpCircle size={20} className="text-primary-600" /> {content['courseDetails.faqTitle'] || 'الأسئلة الشائعة'}
        </h2>
        <div className="space-y-2">
          {(content['courseDetails.faqList'] || DEFAULT_FAQ).split('\n').map(l => l.split('::')).filter(p => p[0]?.trim() && p[1]?.trim()).map((p, i) => (
            <div key={i} className="border border-gray-200 rounded-xl overflow-hidden bg-white">
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-right hover:bg-gray-50 transition">
                <span className="font-bold text-gray-800 text-sm">{p[0].trim()}</span>
                {openFaq === i ? <ChevronUp size={16} className="text-gray-400 shrink-0" /> : <ChevronDown size={16} className="text-gray-400 shrink-0" />}
              </button>
              {openFaq === i && <div className="px-4 pb-3 text-sm text-gray-600 leading-relaxed">{p[1].trim()}</div>}
            </div>
          ))}
        </div>
      </section>
    </>
  );
};
