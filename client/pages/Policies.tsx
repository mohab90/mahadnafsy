import React, { useEffect } from 'react';
import { useSiteData } from '../context/SiteDataContext';

const Policies: React.FC = () => {
  useEffect(() => { document.title = 'سياسات المعهد | معهد الدراسات النفسية'; }, []);
  const { content } = useSiteData();

  return (
    <div className="bg-gray-50 min-h-screen py-16 animate-fade-in" dir="rtl">
      <div className="container mx-auto px-4 max-w-4xl">

        {/* ── سياسة الخصوصية ──────────────────────────────────── */}
        <div className="bg-white p-5 sm:p-8 lg:p-10 rounded-3xl shadow-sm border border-gray-100 mb-10">
          <h1 className="text-3xl font-bold text-gray-900 mb-8 border-b pb-4">
            {content['privacy.title'] || 'سياسة الخصوصية'}
          </h1>

          <div className="space-y-8 text-gray-700 leading-relaxed">
            <section>
              <h2 className="text-xl font-bold text-primary-700 mb-3">{content['privacy.s1.title'] || '1. مقدمة'}</h2>
              <p>{content['privacy.s1.body'] || 'نحن في معهد الدراسات النفسية نولي اهتماماً كبيراً لخصوصية زوارنا وعملائنا. توضح هذه السياسة كيفية جمعنا واستخدامنا وحمايتنا لمعلوماتك الشخصية.'}</p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-primary-700 mb-3">{content['privacy.s2.title'] || '2. المعلومات التي نجمعها'}</h2>
              <ul className="list-disc list-inside space-y-2">
                <li>{content['privacy.s2.item1'] || 'المعلومات الشخصية (الاسم، البريد الإلكتروني، رقم الهاتف) عند التسجيل.'}</li>
                <li>{content['privacy.s2.item2'] || 'بيانات الدفع (يتم معالجتها بشكل آمن عبر مزودي خدمة الدفع ولا يتم تخزينها لدينا).'}</li>
                <li>{content['privacy.s2.item3'] || 'سجلات التعلم (الدورات المشاهدة، الشهادات، نتائج الاختبارات).'}</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-primary-700 mb-3">{content['privacy.s3.title'] || '3. كيف نستخدم معلوماتك'}</h2>
              <p>{content['privacy.s3.body'] || 'نستخدم المعلومات لتقديم خدماتنا التعليمية، إصدار الشهادات، التواصل معك بخصوص التحديثات، وتحسين تجربة المستخدم في الموقع.'}</p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-primary-700 mb-3">{content['privacy.s4.title'] || '4. خصوصية الاستشارات النفسية'}</h2>
              <p className="font-bold">{content['privacy.s4.lead'] || 'نلتزم بأعلى معايير السرية المهنية.'}</p>
              <p>{content['privacy.s4.body'] || 'جميع بيانات الجلسات الاستشارية (سواء النصية أو المرئية) مشفرة تماماً ولا يتم الاطلاع عليها من قبل أي طرف ثالث. الهوية يمكن أن تكون مجهولة في خدمة "الاستشارة السريعة".'}</p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-primary-700 mb-3">{content['privacy.s5.title'] || '5. مشاركة البيانات'}</h2>
              <p>{content['privacy.s5.body'] || 'لا نقوم ببيع أو تأجير بياناتك الشخصية لأي طرف ثالث. قد نشارك البيانات فقط مع شركاء الخدمة الضروريين (مثل بوابات الدفع) لإتمام العمليات.'}</p>
            </section>
          </div>
        </div>

        {/* ── الشروط والأحكام ──────────────────────────────────── */}
        <div className="bg-white p-5 sm:p-8 lg:p-10 rounded-3xl shadow-sm border border-gray-100">
          <h1 className="text-3xl font-bold text-gray-900 mb-8 border-b pb-4">
            {content['terms.title'] || 'الشروط والأحكام'}
          </h1>

          <div className="space-y-8 text-gray-700 leading-relaxed">
            <section>
              <h2 className="text-xl font-bold text-primary-700 mb-3">{content['terms.s1.title'] || '1. قبول الشروط'}</h2>
              <p>{content['terms.s1.body'] || 'باستخدامك لموقع معهد الدراسات النفسية، فإنك توافق على الالتزام بهذه الشروط والأحكام. إذا كنت لا توافق على أي جزء منها، فلا يحق لك استخدام الموقع.'}</p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-primary-700 mb-3">{content['terms.s2.title'] || '2. حقوق الملكية الفكرية'}</h2>
              <p>{content['terms.s2.body'] || 'جميع المحتويات الموجودة على الموقع (نصوص، صور، فيديوهات، مواد تعليمية) هي ملكية حصرية للمعهد ومحمية بموجب قوانين حقوق النشر. يمنع نسخ أو توزيع أو بيع أي محتوى دون إذن كتابي.'}</p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-primary-700 mb-3">{content['terms.s3.title'] || '3. سياسة الاسترجاع'}</h2>
              <ul className="list-disc list-inside space-y-2">
                <li>{content['terms.s3.item1'] || 'يمكن استرداد رسوم الكورسات المسجلة خلال 14 يوم من الشراء بشرط عدم مشاهدة أكثر من 20% من المحتوى.'}</li>
                <li>{content['terms.s3.item2'] || 'الدبلومات الأونلاين (Live): لا يمكن استرداد المبلغ بعد بدء الدراسة بأسبوع.'}</li>
                <li>{content['terms.s3.item3'] || 'الاستشارات: يمكن إلغاء الحجز قبل الموعد بـ 24 ساعة لاسترداد المبلغ كاملاً.'}</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-primary-700 mb-3">{content['terms.s4.title'] || '4. سلوك المستخدم'}</h2>
              <p>{content['terms.s4.body'] || 'يجب استخدام مجتمع المعهد والمنتديات بشكل لائق. يحظر نشر أي محتوى مسيء، عنصري، أو ينتهك خصوصية الآخرين. يحتفظ المعهد بحق إيقاف حساب أي مستخدم يخالف هذه القواعد.'}</p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-primary-700 mb-3">{content['terms.s5.title'] || '5. إخلاء المسؤولية'}</h2>
              <p>{content['terms.s5.body'] || 'المحتوى التعليمي المقدم هو لأغراض التدريب والتوعية. لا يعتبر بديلاً عن العلاج الطبي أو النفسي المتخصص في حالات الطوارئ الطبية.'}</p>
            </section>
          </div>
        </div>

      </div>
    </div>
  );
};

export default Policies;
