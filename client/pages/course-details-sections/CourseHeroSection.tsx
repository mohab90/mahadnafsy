import React from 'react';
import { Check, PlayCircle, Award, Users, Send, Share2, MessageCircle, ShieldCheck, Clock } from 'lucide-react';
import type { Course } from '../../types';
import { SafeHtml } from '../../components/SafeHtml';
import { cdnImg } from '../../lib/img';

interface CourseHeroSectionProps {
  course: Course;
  content: Record<string, string>;
  currentPrice: number;
  oldPrice: number;
  discountedPrice: number | null;
  currencySymbol: string;
  applicableDiscount: { discountPercent: number; label?: string } | undefined;
  isSubscribed: boolean;
  onBuyNow: () => void;
}

export const CourseHeroSection: React.FC<CourseHeroSectionProps> = ({
  course,
  content,
  currentPrice,
  oldPrice,
  discountedPrice,
  currencySymbol,
  applicableDiscount,
  isSubscribed,
  onBuyNow,
}) => {
  return (
    <div className="bg-gray-900 text-white relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-r from-primary-900 via-primary-800 to-gray-900 opacity-95 z-10"></div>
      <img loading="lazy" decoding="async" src={cdnImg(course.thumbnail, 800)} alt={course.title} className="absolute inset-0 w-full h-full object-cover opacity-20 mix-blend-overlay" />

      <div className="container mx-auto px-4 py-12 md:py-16 relative z-20">
        <div className="flex flex-col lg:flex-row gap-12 items-start">
          {/* Left Content */}
          <div className="flex-1">
            <div className="flex gap-3 mb-6">
               <span className="bg-secondary-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg shadow-secondary-500/20">{course.level}</span>
               <span className="bg-white/10 backdrop-blur border border-white/20 text-white text-xs font-bold px-3 py-1 rounded-full">{course.category === 'Therapy' ? (content['courseDetails.category.therapy'] || 'علاج نفسي') : (content['courseDetails.category.general'] || 'صحة نفسية')}</span>
            </div>
            <h1 className="text-3xl md:text-5xl font-extrabold mb-6 leading-tight">{course.title}</h1>
                          <SafeHtml
                              html={course.shortDescription || ''}
                              className="text-lg md:text-xl text-gray-200 mb-8 leading-relaxed max-w-2xl border-r-4 border-secondary-500 pr-4"
                          />

            <div className="flex flex-wrap gap-6 mb-8 text-sm font-medium">
              <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-lg backdrop-blur-sm">
                <PlayCircle size={18} className="text-secondary-400" />
                                  <span>{course.type === 'Mix' ? (content['courseDetails.type.mix'] || 'نظام هجين (مسجل + لايف)') : course.type === 'Live' ? (content['courseDetails.type.live'] || 'بث مباشر تفاعلي') : (content['courseDetails.type.recorded'] || 'مسجل بجودة عالية')}</span>
              </div>
              <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-lg backdrop-blur-sm">
                <Users size={18} className="text-secondary-400" />
                                  <span>{course.students} {content['courseDetails.studentsSuffix'] || 'طالب مشترك'}</span>
              </div>
              <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-lg backdrop-blur-sm">
                  <Award size={18} className="text-secondary-400" />
                                      <span>{content['courseDetails.certificateBadge'] || 'شهادة معتمدة'}</span>
              </div>
            </div>

            <div className="flex items-center gap-4 bg-gray-800/50 p-4 rounded-xl border border-gray-700 w-fit">
               <img loading="lazy" decoding="async" src={`https://ui-avatars.com/api/?name=${course.instructor}&background=random`} className="w-12 h-12 rounded-full border-2 border-secondary-500" alt={course.instructor} />
               <div>
                        <p className="text-xs text-gray-400">{content['courseDetails.instructorLabel'] || 'مدرب الدبلومة'}</p>
                  <p className="font-bold text-white text-lg">{course.instructor}</p>
               </div>
            </div>
          </div>

          {/* Right Card (Pricing) - Desktop Only */}
          <div className="hidden lg:block w-96 relative">
             <div className="bg-white text-gray-900 rounded-2xl p-6 shadow-2xl border-t-8 border-primary-600 sticky top-24">
                <div className="mb-6 text-center border-b pb-4 border-gray-100">
                  <p className="text-gray-400 text-sm line-through mb-1">{content['courseDetails.price.originalLabel'] || 'السعر الرسمي:'} {discountedPrice !== null ? currentPrice : oldPrice} {currencySymbol}</p>
                  <div className="flex justify-center items-center gap-3">
                      <span className="text-4xl font-extrabold text-primary-600">{discountedPrice !== null ? discountedPrice : currentPrice} <span className="text-xl">{currencySymbol}</span></span>
                  </div>
                  {applicableDiscount ? (
                    <span className="bg-red-100 text-red-600 text-xs font-bold px-3 py-1 rounded-full mt-2 inline-block">
                      خصم {applicableDiscount.discountPercent}%{applicableDiscount.label ? ` — ${applicableDiscount.label}` : ''}
                    </span>
                  ) : (
                    <span className="bg-red-100 text-red-600 text-xs font-bold px-3 py-1 rounded-full mt-2 inline-block">{content['courseDetails.price.discountBadge'] || 'خصم لفترة محدودة'}</span>
                  )}
                </div>

                {isSubscribed ? (
                  <div className="w-full bg-green-50 border-2 border-green-500 text-green-700 font-bold py-4 rounded-xl mb-3 flex justify-center items-center gap-2 text-lg">
                    <Check size={22} className="text-green-600" />
                    أنت مشترك في هذا الكورس
                  </div>
                ) : (
                  <>
                    <button onClick={onBuyNow} className="w-full bg-primary-600 hover:bg-primary-700 text-white font-bold py-4 rounded-xl mb-3 transition shadow-lg shadow-primary-500/30 text-lg flex justify-center items-center gap-2">
                      {content['courseDetails.price.cta'] || 'احجز الآن واستفد بخصم إضافي'}
                      <Check size={20} />
                    </button>
                  </>
                )}
                <button
                  onClick={() => setTimeout(() => document.getElementById('lead-form')?.scrollIntoView({ behavior: 'smooth' }), 100)}
                  className="w-full bg-white border-2 border-primary-600 text-primary-700 font-bold py-3 rounded-xl mb-4 transition hover:bg-primary-50 flex justify-center items-center gap-2"
                >
                  <Send size={18} />
                  سجل بياناتك للتواصل
                </button>

                <div className="space-y-3 text-sm text-gray-600 mb-6 bg-gray-50 p-4 rounded-lg">
                                       <p className="flex items-center gap-2"><Check size={16} className="text-green-500" /> {content['courseDetails.price.feature1'] || 'وصول لمدة سنة واحدة للمحتوى'}</p>
                                       <p className="flex items-center gap-2"><Check size={16} className="text-green-500" /> {content['courseDetails.price.feature2'] || 'شهادة إتمام موثقة برقم تسلسلي'}</p>
                                       <p className="flex items-center gap-2"><Check size={16} className="text-green-500" /> {content['courseDetails.price.feature3'] || 'المادة العلمية + نماذج العمل'}</p>
                </div>

                {/* Trust strip — guarantee + limited seats (editable: لوحة التحكم → صفحات الموقع → صفحة الكورسات) */}
                <div className="space-y-2 mb-4">
                  <div className="flex items-start gap-2 bg-green-50 border border-green-100 rounded-xl px-3 py-2 text-xs text-green-800">
                    <ShieldCheck size={15} className="shrink-0 mt-0.5 text-green-600" />
                    <span>{content['courseDetails.guaranteeText'] || 'ضمان استرداد خلال 7 أيام إن لم يناسبك البرنامج — اشترك بثقة.'}</span>
                  </div>
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 text-xs text-amber-800">
                    <Clock size={15} className="shrink-0 mt-0.5 text-amber-600" />
                    <span>{content['courseDetails.seatsNote'] || 'المقاعد محدودة لكل دفعة لضمان جودة المتابعة — احجز مكانك مبكراً.'}</span>
                  </div>
                </div>

                <div className="flex justify-center gap-4">
                    <button className="text-gray-500 hover:text-primary-600 text-sm flex items-center gap-1 transition">
                                                  <Share2 size={16} /> {content['courseDetails.actions.share'] || 'مشاركة'}
                    </button>
                    <a href={`https://wa.me/${(content['footer.whatsapp'] || '201096203090').replace(/\D/g,'')}`} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-green-600 text-sm flex items-center gap-1 transition">
                                                  <MessageCircle size={16} /> {content['courseDetails.actions.whatsapp'] || 'استفسار واتساب'}
                    </a>
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};
