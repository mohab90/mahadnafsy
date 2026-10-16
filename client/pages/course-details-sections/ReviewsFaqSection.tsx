import React from 'react';
import { Award, PlayCircle, Plus, Quote, Star } from 'lucide-react';
import type { TestimonialItem } from '../../types';
import { cdnImg } from '../../lib/img';

// Default FAQ — editable from لوحة التحكم → صفحات الموقع → صفحة الكورسات (key: courseDetails.faqList).
// Format: one "السؤال :: الجواب" per line.
const DEFAULT_FAQ = [
  'هل الشهادة معتمدة وموثّقة؟ :: نعم، شهاداتنا معتمدة وموثّقة برقم تسلسلي، ويمكن توثيقها من جهات خارجية حسب البرنامج.',
  'المحتوى مسجّل أم مباشر؟ :: حسب نوع البرنامج (مسجّل / مباشر / هجين) موضّح أعلى الصفحة، والمسجّل تقدر تشاهده في أي وقت.',
  'كم مدة الوصول للمحتوى؟ :: وصول كامل لمدة سنة من تاريخ الاشتراك.',
  'هل يوجد تقسيط؟ :: نعم، نوفّر خطط تقسيط مرنة — تواصل معنا على واتساب لمعرفة التفاصيل.',
  'ماذا لو لم يناسبني البرنامج؟ :: لديك ضمان استرداد خلال 14 يوم، بشرط عدم مشاهدة أكثر من 20% من المحتوى.',
  'هل أحصل على دعم أثناء الدراسة؟ :: نعم، دعم مستمر عبر المجتمع والواتساب طوال فترة البرنامج.',
].join('\n');

interface ReviewsFaqSectionProps {
  content: Record<string, string>;
  testimonials: TestimonialItem[];
  openFaq: number | null;
  setOpenFaq: (idx: number | null) => void;
}

export const ReviewsFaqSection: React.FC<ReviewsFaqSectionProps> = ({ content, testimonials, openFaq, setOpenFaq }) => {
  const h2 = 'mb-5 text-2xl font-black leading-tight text-ink sm:text-3xl';
  const faq = (content['courseDetails.faqList'] || DEFAULT_FAQ).split('\n').map(l => l.split('::')).filter(p => p[0]?.trim() && p[1]?.trim());
  return (
    <>
      {/* FAQ */}
      <section>
          <h2 className={h2}>{content['courseDetails.faq.title'] || 'أسئلة شائعة'}</h2>
          <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[24px] border border-line bg-white p-5 sm:p-6">
                  <h3 className="mb-2 flex items-center gap-2.5 font-black text-ink">
                      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700"><Award size={18} /></span>
                      {content['courseDetails.faq.q1'] || 'هل الشهادة معتمدة؟'}
                  </h3>
                  <p className="text-[15px] leading-relaxed text-muted-body">{content['courseDetails.faq.a1'] || 'نعم، الشهادة معتمدة من المعهد وتحمل كود تحقق (QR Code). كما يمكن توثيقها من الخارجية وجهات دولية برسوم إضافية.'}</p>
              </div>
              <div className="rounded-[24px] border border-line bg-white p-5 sm:p-6">
                  <h3 className="mb-2 flex items-center gap-2.5 font-black text-ink">
                      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700"><PlayCircle size={18} /></span>
                      {content['courseDetails.faq.q2'] || 'هل يمكنني مشاهدة المحاضرات لاحقاً؟'}
                  </h3>
                  <p className="text-[15px] leading-relaxed text-muted-body">{content['courseDetails.faq.a2'] || 'بالتأكيد! جميع المحاضرات (سواء المسجلة أو البث المباشر) تظل محفوظة في حسابك لمدة سنة واحدة ويمكنك الرجوع إليها في أي وقت.'}</p>
              </div>
          </div>
      </section>

      {/* ── Customer Reviews ── */}
      {testimonials.length > 0 && (
        <section className="rounded-[28px] border border-line bg-paper p-5 sm:p-7">
          <h2 className={h2}>{content['courseDetails.reviews.title'] || 'آراء طلاب الكورس'}</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {testimonials.slice(0, 3).map((t) => (
              <div key={t.id} className="relative rounded-[22px] bg-white p-5 ring-1 ring-line">
                <Quote size={28} className="absolute left-4 top-4 text-primary-100" />
                <div className="mb-3 flex items-center gap-3">
                  {t.image ? (
                    <img loading="lazy" decoding="async" src={cdnImg(t.image, 120)} width={44} height={44} alt={t.name} className="h-11 w-11 flex-shrink-0 rounded-full object-cover ring-2 ring-line" />
                  ) : (
                    <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-primary-50 text-lg font-black text-primary-700">{t.name.charAt(0)}</div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-ink">{t.name}</p>
                    <p className="truncate text-xs text-muted">{t.role}</p>
                  </div>
                </div>
                <div className="mb-2 flex gap-0.5 text-gold">
                  {[...Array(5)].map((_, i) => <Star key={i} size={13} fill="currentColor" />)}
                </div>
                <p className="relative z-10 line-clamp-4 text-sm leading-relaxed text-muted-body">{t.text}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* FAQ — editable: لوحة التحكم → صفحات الموقع → صفحة الكورسات (courseDetails.faqList) */}
      <section>
        <h2 className={h2}>{content['courseDetails.faqTitle'] || 'الأسئلة الشائعة'}</h2>
        <div className="divide-y divide-line rounded-[26px] border border-line bg-white">
          {faq.map((p, i) => {
            const on = openFaq === i;
            return (
              <div key={i}>
                <button onClick={() => setOpenFaq(on ? null : i)} aria-expanded={on}
                  className="flex min-h-[60px] w-full items-center justify-between gap-4 px-5 py-4 text-right text-base font-extrabold text-ink">
                  <span>{p[0].trim()}</span>
                  <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-full transition ${on ? 'rotate-45 bg-primary-700 text-white' : 'bg-paper text-muted-strong'}`}><Plus size={18} /></span>
                </button>
                {on && <div className="px-5 pb-5 text-[15px] leading-[1.9] text-muted-body">{p[1].trim()}</div>}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
};
