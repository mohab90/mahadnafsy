import React from 'react';
import { AlertCircle, Check, X } from 'lucide-react';
import { SafeHtml } from '../../../shared/ui/SafeHtml';

interface PainPointsAndAboutSectionProps {
  content: Record<string, string>;
  description: string;
}

export const PainPointsAndAboutSection: React.FC<PainPointsAndAboutSectionProps> = ({ content, description }) => {
  const left = [
    content['courseDetails.pain.left1'] || 'صعوبة في تطبيق النظريات عملياً داخل العيادة.',
    content['courseDetails.pain.left2'] || 'عدم الثقة في التشخيص وصياغة الحالة.',
    content['courseDetails.pain.left3'] || 'نقص الأدوات والفنيات العلاجية الحديثة.',
  ];
  const right = [
    content['courseDetails.pain.right1'] || 'تدريب عملي مكثف ورول بلاي (Role Play).',
    content['courseDetails.pain.right2'] || 'نماذج جاهزة لصياغة الحالة والتقييم.',
    content['courseDetails.pain.right3'] || 'ثقة كاملة لإدارة الجلسات العلاجية.',
  ];
  return (
    <>
      {/* Pain Points & Solution */}
      <section>
          <h2 className="mb-5 flex items-center gap-2 text-2xl font-black leading-tight text-ink sm:text-3xl">
              <AlertCircle className="flex-none text-primary-700" />
              {content['courseDetails.pain.title'] || 'هل هذه الدبلومة لك؟'}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[24px] border border-line bg-paper p-5 sm:p-6">
                  <h3 className="mb-4 font-black text-ink">{content['courseDetails.pain.leftTitle'] || 'إذا كنت تعاني من:'}</h3>
                  <ul className="space-y-3">
                      {left.map((text, i) => (
                        <li key={i} className="flex gap-2.5 text-[15px] leading-relaxed text-muted-body">
                            <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-white text-primary-700 ring-1 ring-line"><X size={14} /></span>
                            {text}
                        </li>
                      ))}
                  </ul>
              </div>
              <div className="rounded-[24px] bg-ink p-5 text-white sm:p-6">
                  <h3 className="mb-4 font-black text-gold-light">{content['courseDetails.pain.rightTitle'] || 'فإن هذه الدبلومة ستمنحك:'}</h3>
                  <ul className="space-y-3">
                      {right.map((text, i) => (
                        <li key={i} className="flex gap-2.5 text-[15px] leading-relaxed text-white/80">
                            <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-gold-light text-ink"><Check size={14} /></span>
                            {text}
                        </li>
                      ))}
                  </ul>
              </div>
          </div>
      </section>

      {/* About */}
      <section className="rounded-[28px] border border-line bg-white p-5 sm:p-7">
          <h2 className="mb-4 text-2xl font-black leading-tight text-ink sm:text-3xl">{content['courseDetails.about.title'] || 'تفاصيل البرنامج التدريبي'}</h2>
          <div className="max-w-none break-words text-base leading-loose text-muted-body [&_a]:font-bold [&_a]:text-primary-700 [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-black [&_h2]:text-ink [&_h3]:mt-4 [&_h3]:font-black [&_h3]:text-ink [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-2xl [&_ol]:list-decimal [&_ol]:pr-5 [&_strong]:text-ink [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_ul]:list-disc [&_ul]:pr-5">
              <SafeHtml html={description || ''} />
              <p className="mt-4">
                  {content['courseDetails.about.extraParagraph'] || 'تم تصميم هذا المنهج ليناسب المعايير الدولية في التدريب النفسي، حيث نركز على الجانب التطبيقي بنسبة 70% مقابل 30% للجانب النظري. ستحصل على حقيبة تدريبية كاملة تحتوي على المقاييس، استمارات التقييم، ودليل المعالج.'}
              </p>
          </div>
      </section>
    </>
  );
};
