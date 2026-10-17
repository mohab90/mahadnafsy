import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Sparkles, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SafeHtml } from '../../../shared/ui/SafeHtml';

export const SectionHead: React.FC<{ kicker: string; title: string; subtitle?: string; light?: boolean; center?: boolean }> = ({ kicker, title, subtitle, light, center }) => (
  <div className={`mb-7 ${center ? 'text-center' : ''}`}>
    <span className={`text-sm font-extrabold ${light ? 'text-gold-light' : 'text-gold-deep'}`}>{kicker}</span>
    <h2 className={`mt-1.5 text-balance text-[26px] font-black leading-tight sm:text-[34px] ${light ? 'text-white' : 'text-ink'}`}>{title}</h2>
    {subtitle && <p className={`mt-2 text-base leading-relaxed ${center ? 'mx-auto max-w-2xl' : ''} ${light ? 'text-white/70' : 'text-muted-body'}`}>{subtitle}</p>}
  </div>
);

/** «هل الدبلومة دي ليك؟» — where the reader is now, and where the course takes them. */
export const PainPointsSection: React.FC<{ content: Record<string, string>; courseId: string; isSubscribed: boolean }> = ({ content, courseId, isSubscribed }) => {
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
    <section id="for-you" className="scroll-mt-32">
      <SectionHead
        kicker="قبل ما تحجز"
        title={content['courseDetails.pain.title'] || 'هل الدبلومة دي ليك؟'}
        subtitle={content['courseDetails.pain.subtitle'] || 'لو لقيت نفسك في أي نقطة من دول، فالبرنامج ده معمول علشانك.'}
      />
      <div className="relative grid gap-4 md:grid-cols-2">
        <div className="rounded-[26px] border border-line bg-paper p-5 sm:p-7">
          <h3 className="mb-4 text-lg font-black text-ink">{content['courseDetails.pain.leftTitle'] || 'إذا كنت تعاني من:'}</h3>
          <ul className="space-y-3.5">
            {left.map((text, i) => (
              <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-muted-body">
                <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-white text-primary-700 ring-1 ring-line"><X size={15} strokeWidth={3} /></span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <span aria-hidden="true" className="absolute left-1/2 top-1/2 z-10 hidden h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary-700 text-white shadow-xl ring-8 ring-white md:flex"><ArrowLeft size={24} /></span>
        <div className="rounded-[26px] bg-ink p-5 text-white sm:p-7">
          <h3 className="mb-4 text-lg font-black text-gold-light">{content['courseDetails.pain.rightTitle'] || 'فإن هذه الدبلومة ستمنحك:'}</h3>
          <ul className="space-y-3.5">
            {right.map((text, i) => (
              <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-white/85">
                <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-gold-light text-ink"><Check size={15} strokeWidth={3} /></span>
                {text}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {!isSubscribed && (
        <div className="mt-5 flex flex-col items-center justify-between gap-3 rounded-[22px] bg-primary-50 px-5 py-4 ring-1 ring-primary-100 sm:flex-row">
          <p className="text-center text-[15px] font-extrabold text-primary-800 sm:text-right"><Sparkles size={17} className="ml-1.5 inline text-primary-700" />الخطوة الجاية سهلة: احجز مكانك، وفريقنا يأكد معاك كل التفاصيل.</p>
          <Link to={`/enroll?course=${encodeURIComponent(courseId)}`} className="inline-flex min-h-[48px] flex-none items-center gap-2 rounded-xl bg-primary-700 px-5 text-[15px] font-black text-white transition hover:bg-primary-800">
            احجز مكانك <ArrowLeft size={18} />
          </Link>
        </div>
      )}
    </section>
  );
};

/**
 * «هتتعلم إيه؟» — the course's own modules when it has them, then the full
 * description, folded after a few lines so it does not bury the rest of the page.
 */
export const AboutSection: React.FC<{ content: Record<string, string>; description: string; modules?: { title: string; items: string[] }[] }> = ({ content, description, modules }) => {
  const filled = (modules || []).filter(m => m?.title?.trim());
  const body = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [tall, setTall] = useState(false);
  useEffect(() => {
    const el = body.current;
    if (el) setTall(el.scrollHeight > 420);
  }, [description]);

  return (
    <section id="about" className="scroll-mt-32">
      <SectionHead
        kicker="محتوى البرنامج"
        title={content['courseDetails.about.title'] || 'هتتعلم إيه في البرنامج؟'}
        subtitle={content['courseDetails.about.subtitle'] || 'منهج متدرج من الأساس للتطبيق، بيركز على الجانب العملي اللي هتحتاجه في الشغل.'}
      />

      {filled.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          {filled.map((m, i) => (
            <div key={i} className="rounded-[22px] border border-line bg-white p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-ink text-sm font-black text-gold-pale">{i + 1}</span>
                <h3 className="font-black leading-snug text-ink">{m.title}</h3>
              </div>
              {m.items?.filter(Boolean).length > 0 && (
                <ul className="mt-3 space-y-1.5 pr-1">
                  {m.items.filter(Boolean).map((item, j) => (
                    <li key={j} className="flex gap-2 text-sm leading-relaxed text-muted-body"><Check size={15} className="mt-0.5 flex-none text-green-600" />{item}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="relative rounded-[26px] border border-line bg-white p-5 sm:p-7">
        <div
          ref={body}
          className={`max-w-none overflow-hidden break-words text-base leading-loose text-muted-body [&_a]:font-bold [&_a]:text-primary-700 [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-black [&_h2]:text-ink [&_h3]:mt-4 [&_h3]:font-black [&_h3]:text-ink [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-2xl [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pr-5 [&_strong]:text-ink [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_ul]:list-disc [&_ul]:pr-5 ${tall && !open ? 'max-h-[420px]' : ''}`}
        >
          <SafeHtml html={description || ''} />
          <p className="mt-4">
            {content['courseDetails.about.extraParagraph'] || 'تم تصميم هذا المنهج ليناسب المعايير الدولية في التدريب النفسي، حيث نركز على الجانب التطبيقي بنسبة 70% مقابل 30% للجانب النظري. ستحصل على حقيبة تدريبية كاملة تحتوي على المقاييس، استمارات التقييم، ودليل المعالج.'}
          </p>
        </div>
        {tall && (
          <>
            {!open && <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-[68px] h-24 rounded-b-[26px] bg-gradient-to-t from-white to-transparent" />}
            <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
              className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-paper px-4 text-sm font-extrabold text-ink ring-1 ring-line transition hover:ring-ink/30">
              {open ? 'اعرض أقل' : 'اقرأ التفاصيل كاملة'} <ChevronDown size={16} className={`transition ${open ? 'rotate-180' : ''}`} />
            </button>
          </>
        )}
      </div>
    </section>
  );
};
