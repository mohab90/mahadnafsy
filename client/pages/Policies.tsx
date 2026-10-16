import React, { useEffect } from 'react';
import { useSiteData } from '../context/SiteDataContext';
import { useSeo } from '../lib/useSeo';
import PageHeader from '../components/PageHeader';

const Policies: React.FC = () => {
  useSeo({ title: 'سياسات المعهد | معهد الدراسات النفسية', path: '/policies', description: 'سياسة الخصوصية وشروط الاستخدام وسياسة الاسترداد في معهد الدراسات النفسية.' });
  const { content } = useSiteData();

  return (
    <div className="min-h-screen bg-paper" dir="rtl">
      <PageHeader
        eyebrow="الخصوصية والشروط"
        title="سياسات المعهد"
        subtitle="سياسة الخصوصية وشروط الاستخدام وسياسة الاسترداد في معهد الدراسات النفسية."
      >
        <div className="flex flex-wrap justify-center gap-2">
          <a href="#privacy" className="inline-flex min-h-[44px] items-center rounded-full bg-white px-4 text-sm font-extrabold text-muted-strong ring-1 ring-line transition hover:text-ink hover:ring-line-deep">{content['privacy.title'] || 'سياسة الخصوصية'}</a>
          <a href="#terms" className="inline-flex min-h-[44px] items-center rounded-full bg-white px-4 text-sm font-extrabold text-muted-strong ring-1 ring-line transition hover:text-ink hover:ring-line-deep">{content['terms.title'] || 'الشروط والأحكام'}</a>
        </div>
      </PageHeader>
      <div className="container mx-auto max-w-4xl px-4 py-14 sm:py-20">

        {/* ── سياسة الخصوصية ──────────────────────────────────── */}
        <div id="privacy" className="mb-8 scroll-mt-24 rounded-[28px] border border-line bg-white p-5 sm:p-8 lg:p-10">
          <h2 className="mb-8 border-b border-line pb-5 text-2xl font-black leading-tight text-ink sm:text-3xl">
            {content['privacy.title'] || 'سياسة الخصوصية'}
          </h2>

          <div className="space-y-8 text-[15px] leading-[1.9] text-muted-body sm:text-base">
            <section>
              <h3 className="mb-2 text-lg font-black text-ink sm:text-xl">{content['privacy.s1.title'] || '1. مقدمة'}</h3>
              <p>{content['privacy.s1.body'] || 'نحن في معهد الدراسات النفسية نولي اهتماماً كبيراً لخصوصية زوارنا وعملائنا. توضح هذه السياسة كيفية جمعنا واستخدامنا وحمايتنا لمعلوماتك الشخصية.'}</p>
            </section>

            <section>
              <h3 className="mb-2 text-lg font-black text-ink sm:text-xl">{content['privacy.s2.title'] || '2. المعلومات التي نجمعها'}</h3>
              <ul className="list-disc space-y-2 pr-5 marker:text-primary-700">
                <li>{content['privacy.s2.item1'] || 'المعلومات الشخصية (الاسم، البريد الإلكتروني، رقم الهاتف) عند التسجيل.'}</li>
                <li>{content['privacy.s2.item2'] || 'بيانات الدفع (يتم معالجتها بشكل آمن عبر مزودي خدمة الدفع ولا يتم تخزينها لدينا).'}</li>
                <li>{content['privacy.s2.item3'] || 'سجلات التعلم (الدورات المشاهدة، الشهادات، نتائج الاختبارات).'}</li>
              </ul>
            </section>

            <section>
              <h3 className="mb-2 text-lg font-black text-ink sm:text-xl">{content['privacy.s3.title'] || '3. كيف نستخدم معلوماتك'}</h3>
              <p>{content['privacy.s3.body'] || 'نستخدم المعلومات لتقديم خدماتنا التعليمية، إصدار الشهادات، التواصل معك بخصوص التحديثات، وتحسين تجربة المستخدم في الموقع.'}</p>
            </section>

            <section>
              <h3 className="mb-2 text-lg font-black text-ink sm:text-xl">{content['privacy.s4.title'] || '4. خصوصية الاستشارات النفسية'}</h3>
              <p className="font-bold text-ink">{content['privacy.s4.lead'] || 'نلتزم بأعلى معايير السرية المهنية.'}</p>
              <p>{content['privacy.s4.body'] || 'جميع بيانات الجلسات الاستشارية (سواء النصية أو المرئية) مشفرة تماماً ولا يتم الاطلاع عليها من قبل أي طرف ثالث. الهوية يمكن أن تكون مجهولة في خدمة "الاستشارة السريعة".'}</p>
            </section>

            <section>
              <h3 className="mb-2 text-lg font-black text-ink sm:text-xl">{content['privacy.s5.title'] || '5. مشاركة البيانات'}</h3>
              <p>{content['privacy.s5.body'] || 'لا نقوم ببيع أو تأجير بياناتك الشخصية لأي طرف ثالث. قد نشارك البيانات فقط مع شركاء الخدمة الضروريين (مثل بوابات الدفع) لإتمام العمليات.'}</p>
            </section>
          </div>
        </div>

        {/* ── الشروط والأحكام ──────────────────────────────────── */}
        <div id="terms" className="scroll-mt-24 rounded-[28px] border border-line bg-white p-5 sm:p-8 lg:p-10">
          <h2 className="mb-8 border-b border-line pb-5 text-2xl font-black leading-tight text-ink sm:text-3xl">
            {content['terms.title'] || 'الشروط والأحكام'}
          </h2>

          <div className="space-y-8 text-[15px] leading-[1.9] text-muted-body sm:text-base">
            <section>
              <h3 className="mb-2 text-lg font-black text-ink sm:text-xl">{content['terms.s1.title'] || '1. قبول الشروط'}</h3>
              <p>{content['terms.s1.body'] || 'باستخدامك لموقع معهد الدراسات النفسية، فإنك توافق على الالتزام بهذه الشروط والأحكام. إذا كنت لا توافق على أي جزء منها، فلا يحق لك استخدام الموقع.'}</p>
            </section>

            <section>
              <h3 className="mb-2 text-lg font-black text-ink sm:text-xl">{content['terms.s2.title'] || '2. حقوق الملكية الفكرية'}</h3>
              <p>{content['terms.s2.body'] || 'جميع المحتويات الموجودة على الموقع (نصوص، صور، فيديوهات، مواد تعليمية) هي ملكية حصرية للمعهد ومحمية بموجب قوانين حقوق النشر. يمنع نسخ أو توزيع أو بيع أي محتوى دون إذن كتابي.'}</p>
            </section>

            <section>
              <h3 className="mb-2 text-lg font-black text-ink sm:text-xl">{content['terms.s3.title'] || '3. سياسة الاسترجاع'}</h3>
              <ul className="list-disc space-y-2 pr-5 marker:text-primary-700">
                <li>{content['terms.s3.item1'] || 'يمكن استرداد رسوم الكورسات المسجلة خلال 14 يوم من الشراء بشرط عدم مشاهدة أكثر من 20% من المحتوى.'}</li>
                <li>{content['terms.s3.item2'] || 'الدبلومات الأونلاين (Live): لا يمكن استرداد المبلغ بعد بدء الدراسة بأسبوع.'}</li>
                <li>{content['terms.s3.item3'] || 'الاستشارات: يمكن إلغاء الحجز قبل الموعد بـ 24 ساعة لاسترداد المبلغ كاملاً.'}</li>
              </ul>
            </section>

            <section>
              <h3 className="mb-2 text-lg font-black text-ink sm:text-xl">{content['terms.s4.title'] || '4. سلوك المستخدم'}</h3>
              <p>{content['terms.s4.body'] || 'يجب استخدام مجتمع المعهد والمنتديات بشكل لائق. يحظر نشر أي محتوى مسيء، عنصري، أو ينتهك خصوصية الآخرين. يحتفظ المعهد بحق إيقاف حساب أي مستخدم يخالف هذه القواعد.'}</p>
            </section>

            <section>
              <h3 className="mb-2 text-lg font-black text-ink sm:text-xl">{content['terms.s5.title'] || '5. إخلاء المسؤولية'}</h3>
              <p>{content['terms.s5.body'] || 'المحتوى التعليمي المقدم هو لأغراض التدريب والتوعية. لا يعتبر بديلاً عن العلاج الطبي أو النفسي المتخصص في حالات الطوارئ الطبية.'}</p>
            </section>
          </div>
        </div>

      </div>
    </div>
  );
};

export default Policies;
