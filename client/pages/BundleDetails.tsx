import React, { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { BranchType } from '../types';
import { useSiteData } from '../context/SiteDataContext';
import CourseCertificate from '../components/CourseCertificate';
import { CAIRO_TIME_ZONE } from '../../shared/cairoDate';
import { discountPercent, formatAmount } from '../../shared/priceFormat';
import { useSeo, seoSummary } from '../lib/useSeo';
import { CourseBookingCard, scrollToLeadForm } from './course-details-sections/CourseHeroSection';
import { AboutSection } from './course-details-sections/PainPointsAndAboutSection';
import { CertificateShowcase, FinalCtaSection, ProofSection, SectionNav } from './course-details-sections/CourseSalesSections';
import { FaqSection } from './course-details-sections/ReviewsFaqSection';
import { LeadFormSection } from './course-details-sections/LeadFormSection';
import { MobileStickyCta } from './course-details-sections/MobileStickyCta';
import { BundleHero, BundleValueSection, OtherBundles, PathMap, WhyPathSection, bundleEnrollHref, type Station } from './bundle-details-sections/BundleSections';

// Editable from لوحة التحكم (bundleDetails.faqList): one «السؤال :: الجواب» per line.
const BUNDLE_FAQ = [
  'ليه المسار أحسن من إني أشتري الدبلومات لوحدها؟ :: بتوفّر كتير مقارنة بشراء كل دبلومة لوحدها، وبتمشي في ترتيب مدروس، وبتاخد شهادة مجمعة بتفرق في السيرة الذاتية.',
  'لازم أدرس الدبلومات بالترتيب؟ :: الترتيب اللي في خريطة المسار هو الأنسب لأن كل دبلومة بتبني على اللي قبلها، وفريقنا بيساعدك تنظم جدولك.',
  'هاخد كام شهادة؟ :: شهادة لكل دبلومة تخلصها، وشهادة مجمعة للمسار كله في الآخر — وكلها بكود تحقق.',
  'ينفع أقسّط المسار؟ :: أيوه، تقدر تدفع كاش بخصم أكبر، أو تقسّط وتبدأ بأول دفعة بس.',
  'الدراسة أونلاين ولا في الفرع؟ :: الاتنين متاحين: أونلاين من أي مكان، أو حضور في فروعنا.',
  'ماذا لو لم يناسبني البرنامج؟ :: عندك ضمان استرداد خلال 14 يوم، بشرط عدم مشاهدة أكثر من 20% من المحتوى.',
].join('\n');

const NAV = [
  { id: 'about', label: 'عن المسار' },
  { id: 'path', label: 'المحطات' },
  { id: 'why', label: 'ليه المسار؟' },
  { id: 'certificate', label: 'الشهادة' },
  { id: 'reviews', label: 'الآراء' },
  { id: 'pricing', label: 'السعر' },
  { id: 'faq', label: 'الأسئلة' },
];

// A plain-text description keeps its line breaks once it is drawn as HTML.
const asHtml = (text: string) => (/<[a-z][\s\S]*>/i.test(text) ? text : text
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br/>')}</p>`).join(''));

const BundleDetails: React.FC = () => {
  const { bundles, courses, addPublicLead, content: globalContent, currency, testimonials, remoteReady, catalogFailed, retryCatalog } = useSiteData();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [bundleLeadName, setBundleLeadName] = useState('');
  const [bundleLeadPhone, setBundleLeadPhone] = useState('');
  const [bundleLeadBranch, setBundleLeadBranch] = useState('');
  const [bundleLeadNotice, setBundleLeadNotice] = useState('');
  const [certModalOpen, setCertModalOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Match by id OR slug
  const bundle = bundles.find(b => b.id === id || b.slug === id);
  // A bundle priced in EGP only rendered a bold "0" to a visitor browsing in
  // USD, with a live checkout button under it.
  const priceAvailable = (bundle?.price?.[currency] ?? 0) > 0;
  useSeo({
    title: (bundle?.seo_title || (bundle?.title ? `${bundle.title} — مسار` : 'المسارات والباقات')) + ' | معهد الدراسات النفسية',
    path: bundle?.id ? `/bundle/${bundle.id}` : '/bundles',
    description: seoSummary(bundle?.seo_description || bundle?.shortDescription || bundle?.description,
      'مسار تعليمي متكامل من معهد الدراسات النفسية.'),
    image: bundle?.thumbnail || bundle?.courses?.[0]?.thumbnail,
    type: bundle ? 'article' : 'website',
  });

  // Each station with the catalog's full course over it: its price on its own,
  // how many took it, its picture.
  const stations: Station[] = useMemo(
    () => (bundle?.courses || []).map(c => ({ ...c, full: courses.find(x => x.id === c.id || (c.slug && x.slug === c.slug)) })),
    [bundle, courses],
  );

  if (!bundle) {
    // Still loading the catalog is not «not found».
    if (!remoteReady) {
      return (
        <div className="flex min-h-[70vh] items-center justify-center bg-paper">
          <div className="h-10 w-10 rounded-full border-4 border-line border-t-primary-700 motion-safe:animate-spin" />
        </div>
      );
    }
    // Nor is a list that never arrived.
    if (catalogFailed) {
      return (
        <div className="flex flex-col items-center gap-4 bg-paper px-4 py-24 text-center">
          <p className="text-lg font-bold text-ink">تعذر تحميل المسار. تحقق من اتصالك وحاول مرة أخرى.</p>
          <button type="button" onClick={retryCatalog} className="rounded-xl bg-primary-700 px-6 py-2.5 font-bold text-white hover:bg-primary-800">إعادة المحاولة</button>
        </div>
      );
    }
    return <div className="bg-paper px-4 py-24 text-center text-lg font-bold text-muted">{globalContent['bundleDetails.notFound'] || 'المسار غير موجود'}</div>;
  }

  const content = { ...globalContent, ...(bundle.detailsContent || {}) };
  const currentPrice = bundle.price?.[currency] ?? 0;
  const oldPrice = bundle.originalPrice?.[currency] ?? 0;
  const currencySymbol = currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : '$';
  const savePct = discountPercent(oldPrice, currentPrice);
  const students = stations.reduce((sum, s) => sum + (Number(s.full?.students) || 0), 0);
  // What the courses cost one by one — only when every one of them has a price here.
  const separateTotal = stations.length > 0 && stations.every(s => Number(s.full?.price?.[currency]) > 0)
    ? stations.reduce((sum, s) => sum + Number(s.full!.price[currency]), 0)
    : 0;
  const enrollHref = bundleEnrollHref(bundle);

  const handleBundleLeadSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!bundleLeadName.trim() || !bundleLeadPhone.trim()) {
      setBundleLeadNotice('يرجى إدخال الاسم ورقم الهاتف.');
      return;
    }
    const generatedEmail = `${bundleLeadPhone.replace(/\D/g, '') || Date.now()}@lead.local`;
    const payload = {
      id: `l-${Date.now()}`,
      name: bundleLeadName.trim(),
      email: generatedEmail,
      phone: bundleLeadPhone.trim(),
      branch: bundleLeadBranch as BranchType,
      source: `طلب مسار - ${bundle.title}`,
      status: 'new' as const,
      leadType: 'course' as const,
      createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    };
    try {
      await addPublicLead(payload);
      setBundleLeadName('');
      setBundleLeadPhone('');
      setBundleLeadBranch('');
      setBundleLeadNotice('تم تسجيل بياناتك وسيتم التواصل معك خلال 48 ساعة من خدمة العملاء.');
    } catch {
      setBundleLeadNotice('تعذر تسجيل بياناتك حاليًا. حاول مرة أخرى أو تواصل معنا على واتساب.');
    }
  };

  const description = content['bundleDetails.about.text'] || bundle.description || '';

  return (
    <div className="bg-white pb-24 motion-safe:animate-fade-in lg:pb-0" dir="rtl">
      <BundleHero bundle={bundle} content={content} stations={stations} students={students} savePct={savePct} priceAvailable={priceAvailable} />

      <SectionNav showBook={priceAvailable} enrollHref={enrollHref} sections={NAV} />

      <div className="container mx-auto px-4 py-10 sm:py-14">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_370px] xl:grid-cols-[minmax(0,1fr)_390px] xl:gap-14">
          <aside className="lg:col-start-2 lg:row-start-1">
            <div className="lg:sticky lg:top-[136px]">
              {/* The checkout buttons are gated on a price in the visitor's currency. */}
              {priceAvailable ? (
                <CourseBookingCard
                  course={bundle}
                  content={content}
                  enrollHref={enrollHref}
                  features={[
                    `${stations.length} ${content['bundleDetails.sidebar.featureCoursesSuffix'] || 'دبلومات كاملة'}`,
                    content['bundleDetails.sidebar.featureCertificates'] || 'شهادات فردية + شهادة مجمعة',
                    content['bundleDetails.sidebar.featureSupervision'] || 'إشراف مهني لمدة 3 أشهر',
                    content['bundleDetails.sidebar.featureAccess'] || 'وصول لمدة سنتين للمحتوى',
                  ]}
                  extra={separateTotal > currentPrice ? (
                    <p className="mt-3 rounded-xl bg-green-50 px-3 py-2 text-center text-sm font-extrabold text-green-700 ring-1 ring-green-200">
                      الدبلومات لوحدها بـ {formatAmount(separateTotal)} {currencySymbol} — في المسار هتوفّر {formatAmount(separateTotal - currentPrice)} {currencySymbol}
                    </p>
                  ) : null}
                  currentPrice={currentPrice}
                  oldPrice={oldPrice}
                  discountedPrice={null}
                  currencySymbol={currencySymbol}
                  isSubscribed={false}
                  onBuyNow={() => navigate(`/checkout?type=bundle&id=${bundle.id}`)}
                  onPreviewCertificate={() => setCertModalOpen(true)}
                />
              ) : (
                <div className="rounded-[28px] border border-line bg-white p-6 text-center">
                  <p className="font-bold text-muted-strong">السعر غير متاح في دولتك حالياً</p>
                  <button type="button" onClick={scrollToLeadForm} className="mt-4 flex min-h-[54px] w-full items-center justify-center rounded-2xl bg-primary-700 font-black text-white">سجّل بياناتك ونجهزلك العرض</button>
                </div>
              )}
            </div>
          </aside>

          <div className="min-w-0 space-y-14 sm:space-y-20 lg:col-start-1 lg:row-start-1">
            {description && (
              <AboutSection
                content={content}
                kicker="عن المسار"
                title={content['bundleDetails.about.headline'] || 'إيه هو المسار ده؟'}
                subtitle={content['bundleDetails.about.subtitle'] || 'برنامج متكامل بياخدك من الأساس لحد الممارسة المهنية.'}
                showExtra={false}
                description={asHtml(description)}
              />
            )}

            <PathMap content={content} stations={stations} currency={currency} onPreviewCertificate={() => setCertModalOpen(true)} />

            <WhyPathSection content={content} separateTotal={separateTotal} pathPrice={priceAvailable ? currentPrice : 0} currencySymbol={currencySymbol} count={stations.length} />

            <CertificateShowcase
              course={{ titleEn: bundle.titleEn, instructor: content['bundleDetails.cert.instructorName'] || 'معهد الدراسات النفسية' }}
              content={{ ...content, 'courseDetails.cert.previewBtn': content['bundleDetails.cert.previewBtn'] || 'معاينة الشهادة' }}
              subtitle="شهادة لكل دبلومة تخلصها، وفي آخر المسار شهادة مجمعة باسمك — ودي شكلها بالظبط."
              onPreview={() => setCertModalOpen(true)}
            />

            {content['bundleDetails.gallery.motivational'] && !/^(https?:|data:image|\/)/.test(content['bundleDetails.gallery.motivational']) && (
              <section className="rounded-[28px] bg-gradient-to-br from-primary-700 via-primary-800 to-primary-900 p-6 text-center text-white sm:p-8">
                <p className="whitespace-pre-line text-xl font-black leading-relaxed">{content['bundleDetails.gallery.motivational']}</p>
              </section>
            )}

            <ProofSection content={{ ...content, 'courseDetails.reviews.title': content['bundleDetails.testimonials.title'] || 'خريجينا بيتكلموا' }} testimonials={testimonials} rating={null} students={students} />

            <BundleValueSection bundle={bundle} content={content} count={stations.length} currentPrice={currentPrice} oldPrice={oldPrice} currencySymbol={currencySymbol} priceAvailable={priceAvailable} />

            <FaqSection content={content} openFaq={openFaq} setOpenFaq={setOpenFaq} list={content['bundleDetails.faqList'] || BUNDLE_FAQ} />

            <LeadFormSection
              content={content}
              title={content['bundleDetails.form.title'] || 'لسه محتار؟ سيب رقمك ومستشار أكاديمي يكلمك'}
              subtitle={content['bundleDetails.form.subtitle'] || 'هيوضحلك تفاصيل المسار والدفع والجدول الزمني، ويساعدك تبدأ صح.'}
              submitLabel={content['bundleDetails.form.submit'] || 'كلّموني'}
              leadName={bundleLeadName}
              setLeadName={setBundleLeadName}
              leadPhone={bundleLeadPhone}
              setLeadPhone={setBundleLeadPhone}
              leadBranch={bundleLeadBranch}
              setLeadBranch={setBundleLeadBranch}
              leadNotice={bundleLeadNotice}
              onSubmit={handleBundleLeadSubmit}
            />
          </div>
        </div>
      </div>

      <FinalCtaSection
        course={bundle}
        content={{ ...content, 'courseDetails.final.title': content['bundleDetails.final.title'] || 'مكانك في المسار مستنيك', 'courseDetails.final.subtitle': content['bundleDetails.final.subtitle'] || `ابدأ ${bundle.title} النهارده، واطلع منه جاهز للشغل بشهادة مجمعة.` }}
        // No price in the visitor's currency: nothing to book, so no closing call.
        isSubscribed={!priceAvailable}
        enrollHref={enrollHref}
      />
      <OtherBundles bundles={bundles} currentId={bundle.id} currency={currency} />

      {priceAvailable && (
        <MobileStickyCta
          currentPrice={currentPrice}
          oldPrice={oldPrice}
          discountedPrice={null}
          currencySymbol={currencySymbol}
          isSubscribed={false}
          onBuyNow={() => navigate(enrollHref)}
          onRegisterClick={scrollToLeadForm}
        />
      )}

      {/* ──────────────── CERTIFICATE PREVIEW ──────────────── */}
      {certModalOpen && (
        <CourseCertificate
          studentName={content['bundleDetails.cert.sampleName'] || 'اسم الطالب'}
          studentNameEn={content['bundleDetails.cert.sampleNameEn'] || 'Student Name'}
          courseName={bundle.title}
          courseNameEn={bundle.titleEn}
          instructorName={content['bundleDetails.cert.instructorName'] || 'معهد الدراسات النفسية'}
          certNumber="SAMPLE-2025"
          issuedAt={new Date().toLocaleDateString('ar-EG-u-nu-latn', { timeZone: CAIRO_TIME_ZONE })}
          onClose={() => setCertModalOpen(false)}
          sample
        />
      )}
    </div>
  );
};

export default BundleDetails;
