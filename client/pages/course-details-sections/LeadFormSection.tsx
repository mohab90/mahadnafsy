import React from 'react';
import { Check, MessageCircle, PhoneCall, Send } from 'lucide-react';
import { instituteWhatsApp } from '../../lib/whatsappLink';

interface LeadFormSectionProps {
  content: Record<string, string>;
  leadName: string;
  setLeadName: (v: string) => void;
  leadPhone: string;
  setLeadPhone: (v: string) => void;
  leadBranch: string;
  setLeadBranch: (v: string) => void;
  leadNotice: string;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  /** The path page's own wording (bundleDetails.form.*); the course page's keys otherwise. */
  title?: string;
  subtitle?: string;
  submitLabel?: string;
}

export const LeadFormSection: React.FC<LeadFormSectionProps> = ({
  content,
  leadName,
  setLeadName,
  leadPhone,
  setLeadPhone,
  leadBranch,
  setLeadBranch,
  leadNotice,
  onSubmit,
  title,
  subtitle,
  submitLabel,
}) => {
  let branchOptions: { id: string; label: string; internal_only?: boolean }[] = [];
  try { branchOptions = JSON.parse(content['institute.branches'] || '[]'); } catch {}
  branchOptions = branchOptions.filter(b => !b.internal_only);

  const field = 'min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10';

  return (
    <section id="lead-form" className="relative scroll-mt-32 overflow-hidden rounded-[32px] bg-gradient-to-br from-primary-700 via-primary-800 to-primary-900 p-5 text-white shadow-[0_50px_90px_-40px_rgba(76,5,25,.8)] sm:p-8 lg:p-10">
        <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(closest-side,rgba(227,182,90,.25),transparent)]" />
        <div className="relative grid items-center gap-7 md:grid-cols-[1fr_minmax(0,1.1fr)]">
        <div className="text-center md:text-right">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-extrabold text-gold-pale ring-1 ring-white/15"><PhoneCall size={14} /> استشارة مجانية</span>
            <h2 className="mt-3 text-balance text-[26px] font-black leading-tight sm:text-[34px]">{title || content['courseDetails.lead.title'] || 'لسه محتار؟ سيب رقمك ومستشار أكاديمي يكلمك'}</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/75 sm:text-base">{subtitle || content['courseDetails.lead.subtitle'] || 'هيجاوبك على كل أسئلتك، ويساعدك تختار نظام الدراسة والدفع الأنسب ليك.'}</p>
            <ul className="mx-auto mt-5 w-fit space-y-2.5 text-right text-[15px] font-bold text-white/90 md:mx-0">
              {['مكالمة مجانية من غير أي التزام', 'هنتواصل معاك خلال 48 ساعة', 'هنرشحلك الأنسب لهدفك وميزانيتك'].map(t => (
                <li key={t} className="flex items-center gap-2.5"><span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-gold-light text-ink"><Check size={14} strokeWidth={3} /></span>{t}</li>
              ))}
            </ul>
            <a href={`https://wa.me/${instituteWhatsApp(content)}`} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex min-h-[44px] items-center gap-2 text-sm font-extrabold text-white/85 underline-offset-4 hover:text-white hover:underline">
              <MessageCircle size={17} /> أو كلّمنا على واتساب دلوقتي
            </a>
        </div>
        <form className="relative w-full space-y-3 rounded-[24px] bg-white p-4 text-ink shadow-2xl sm:p-6" onSubmit={onSubmit}>
            <p className="text-center text-lg font-black text-ink">سجّل بياناتك</p>
            <div className="grid grid-cols-1 gap-3">
                <input type="text" value={leadName} onChange={(e) => setLeadName(e.target.value)} placeholder={content['courseDetails.lead.namePlaceholder'] || 'الاسم الكامل'} autoComplete="name" className={field} />
                <input type="tel" value={leadPhone} onChange={(e) => setLeadPhone(e.target.value)} placeholder={content['courseDetails.lead.phonePlaceholder'] || 'رقم الهاتف'} autoComplete="tel" className={field} />
            </div>
            <select value={leadBranch} onChange={(e) => setLeadBranch(e.target.value)} className={field}>
                <option value="">{content['courseDetails.lead.branchPlaceholder'] || 'اختر الفرع الأقرب إليك'}</option>
                {branchOptions.length > 0
                  ? branchOptions.map(b => <option key={b.id} value={b.id}>{b.label}</option>)
                  : (<>
                      <option value="online-egypt">{content['courseDetails.lead.branchOnline'] || 'أونلاين محلي'}</option>
                      <option value="online-saudi">{content['courseDetails.lead.branchSaudi'] || 'أونلاين سعودي'}</option>
                      <option value="online-abroad">{content['courseDetails.lead.branchAbroad'] || 'أونلاين دولي'}</option>
                      <option value="tagamoa">{content['courseDetails.lead.branchCairo'] || 'فرع التجمع'}</option>
                      <option value="daqqi">{content['courseDetails.lead.branchGiza'] || 'فرع الدقي'}</option>
                    </>)}
                <option value="other">{content['courseDetails.lead.branchAlex'] || 'أخرى'}</option>
            </select>
            {leadNotice && <div role="status" className="rounded-xl bg-paper px-3 py-2.5 text-sm font-bold text-muted-strong ring-1 ring-line">{leadNotice}</div>}

            <button type="submit" className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 text-lg font-black text-white shadow-[0_16px_30px_-12px_rgba(159,18,57,.8)] transition hover:bg-primary-800">
                 <Send size={18} />
                 {submitLabel || content['courseDetails.lead.submit'] || 'كلّموني'}
            </button>
            <p className="text-center text-xs text-muted">بياناتك في أمان، ومش هنستخدمها غير للتواصل معاك بخصوص البرنامج.</p>
        </form>
        </div>
    </section>
  );
};
