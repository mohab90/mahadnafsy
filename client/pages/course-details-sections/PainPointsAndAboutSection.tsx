import React from 'react';
import { AlertCircle, Check } from 'lucide-react';
import { SafeHtml } from '../../../shared/ui/SafeHtml';

interface PainPointsAndAboutSectionProps {
  content: Record<string, string>;
  description: string;
}

export const PainPointsAndAboutSection: React.FC<PainPointsAndAboutSectionProps> = ({ content, description }) => {
  return (
    <>
      {/* Pain Points & Solution */}
      <section className="bg-red-50 p-8 rounded-2xl border border-red-100">
          <h2 className="text-2xl font-bold mb-6 text-gray-900 flex items-center gap-2">
              <AlertCircle className="text-primary-600" />
              {content['courseDetails.pain.title'] || 'هل هذه الدبلومة لك؟'}
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
              <div>
                  <h3 className="font-bold text-gray-800 mb-3">{content['courseDetails.pain.leftTitle'] || 'إذا كنت تعاني من:'}</h3>
                  <ul className="space-y-2">
                      <li className="flex gap-2 text-gray-600 text-sm">
                          <span className="text-red-500">✕</span>
                          {content['courseDetails.pain.left1'] || 'صعوبة في تطبيق النظريات عملياً داخل العيادة.'}
                      </li>
                      <li className="flex gap-2 text-gray-600 text-sm">
                          <span className="text-red-500">✕</span>
                          {content['courseDetails.pain.left2'] || 'عدم الثقة في التشخيص وصياغة الحالة.'}
                      </li>
                      <li className="flex gap-2 text-gray-600 text-sm">
                          <span className="text-red-500">✕</span>
                          {content['courseDetails.pain.left3'] || 'نقص الأدوات والفنيات العلاجية الحديثة.'}
                      </li>
                  </ul>
              </div>
              <div>
                  <h3 className="font-bold text-gray-800 mb-3">{content['courseDetails.pain.rightTitle'] || 'فإن هذه الدبلومة ستمنحك:'}</h3>
                  <ul className="space-y-2">
                      <li className="flex gap-2 text-gray-600 text-sm">
                          <Check className="text-green-500" size={18} />
                          {content['courseDetails.pain.right1'] || 'تدريب عملي مكثف ورول بلاي (Role Play).'}
                      </li>
                      <li className="flex gap-2 text-gray-600 text-sm">
                          <Check className="text-green-500" size={18} />
                          {content['courseDetails.pain.right2'] || 'نماذج جاهزة لصياغة الحالة والتقييم.'}
                      </li>
                      <li className="flex gap-2 text-gray-600 text-sm">
                          <Check className="text-green-500" size={18} />
                          {content['courseDetails.pain.right3'] || 'ثقة كاملة لإدارة الجلسات العلاجية.'}
                      </li>
                  </ul>
              </div>
          </div>
      </section>

      {/* About */}
      <section>
          <h2 className="text-2xl font-bold mb-4 text-gray-900 border-r-4 border-primary-600 pr-3">{content['courseDetails.about.title'] || 'تفاصيل البرنامج التدريبي'}</h2>
          <div className="prose max-w-none text-gray-600 leading-loose">
              <SafeHtml html={description || ''} />
              <p className="mt-4">
                  {content['courseDetails.about.extraParagraph'] || 'تم تصميم هذا المنهج ليناسب المعايير الدولية في التدريب النفسي، حيث نركز على الجانب التطبيقي بنسبة 70% مقابل 30% للجانب النظري. ستحصل على حقيبة تدريبية كاملة تحتوي على المقاييس، استمارات التقييم، ودليل المعالج.'}
              </p>
          </div>
      </section>
    </>
  );
};
