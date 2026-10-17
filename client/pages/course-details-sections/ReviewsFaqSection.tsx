import React from 'react';
import { MessageCircle, Plus } from 'lucide-react';
import { instituteWhatsApp } from '../../lib/whatsappLink';
import { SectionHead } from './PainPointsAndAboutSection';

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

interface FaqSectionProps {
  content: Record<string, string>;
  openFaq: number | null;
  setOpenFaq: (idx: number | null) => void;
}

/**
 * Every doubt answered in one list: courseDetails.faqList, then the two
 * questions that used to have their own cards (courseDetails.faq.q1/a1, q2/a2).
 */
export const FaqSection: React.FC<FaqSectionProps> = ({ content, openFaq, setOpenFaq }) => {
  const own = [1, 2].map(n => [content[`courseDetails.faq.q${n}`] || '', content[`courseDetails.faq.a${n}`] || '']);
  const listed = (content['courseDetails.faqList'] || DEFAULT_FAQ).split('\n').map(l => l.split('::'));
  // «هل الشهادة معتمدة؟» and «هل الشهادة معتمدة وموثّقة؟» are one question: the first three words decide.
  const seen = new Set<string>();
  const key = (q: string) => q.replace(/[؟?]/g, '').trim().split(/\s+/).slice(0, 3).join(' ');
  const faq = [...listed, ...own]
    .filter(p => p[0]?.trim() && p[1]?.trim())
    .filter(p => { const k = key(p[0]); if (seen.has(k)) return false; seen.add(k); return true; });
  return (
    <section id="faq" className="scroll-mt-32">
      <SectionHead kicker="عندك سؤال؟" title={content['courseDetails.faqTitle'] || content['courseDetails.faq.title'] || 'الأسئلة الشائعة'} />
      <div className="divide-y divide-line overflow-hidden rounded-[26px] border border-line bg-white">
        {faq.map((p, i) => {
          const on = openFaq === i;
          return (
            <div key={i}>
              <button type="button" onClick={() => setOpenFaq(on ? null : i)} aria-expanded={on}
                className="flex min-h-[64px] w-full items-center justify-between gap-4 px-5 py-4 text-right text-base font-extrabold text-ink transition hover:bg-paper/60">
                <span>{p[0].trim()}</span>
                <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-full transition ${on ? 'rotate-45 bg-primary-700 text-white' : 'bg-paper text-muted-strong'}`}><Plus size={18} /></span>
              </button>
              {on && <div className="px-5 pb-5 text-[15px] leading-[1.9] text-muted-body">{p[1].trim()}</div>}
            </div>
          );
        })}
      </div>
      <a href={`https://wa.me/${instituteWhatsApp(content)}`} target="_blank" rel="noopener noreferrer"
        className="mt-4 inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-green-50 px-4 text-sm font-extrabold text-green-700 ring-1 ring-green-200 transition hover:bg-green-100">
        <MessageCircle size={17} /> سؤالك مش موجود؟ اسألنا على واتساب
      </a>
    </section>
  );
};
