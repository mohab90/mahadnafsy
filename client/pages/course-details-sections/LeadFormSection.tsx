import React from 'react';
import { Send } from 'lucide-react';

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
}) => {
  let branchOptions: { id: string; label: string; internal_only?: boolean }[] = [];
  try { branchOptions = JSON.parse(content['institute.branches'] || '[]'); } catch {}
  branchOptions = branchOptions.filter(b => !b.internal_only);

  const field = 'min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10';

  return (
    <section id="lead-form" className="relative scroll-mt-24 overflow-hidden rounded-[32px] bg-gradient-to-br from-primary-700 via-primary-800 to-[#4c0519] p-5 text-white shadow-[0_50px_90px_-40px_rgba(76,5,25,.8)] sm:p-8 lg:p-10">
        <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(closest-side,rgba(227,182,90,.25),transparent)]" />
        <div className="relative mb-6 text-center sm:mb-8">
            <h2 className="text-2xl font-black leading-tight sm:text-3xl">{content['courseDetails.lead.title'] || 'لست متأكداً؟ سجل اهتمامك وسنتواصل معك'}</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-white/70 sm:text-base">{content['courseDetails.lead.subtitle'] || 'املأ النموذج أدناه وسيقوم أحد مستشارينا الأكاديميين بالتواصل معك للإجابة على جميع استفساراتك.'}</p>
        </div>
        <form className="relative mx-auto max-w-xl space-y-3 rounded-[24px] bg-white p-4 text-ink shadow-2xl sm:p-6" onSubmit={onSubmit}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                 {content['courseDetails.lead.submit'] || 'إرسال الطلب'}
            </button>
        </form>
    </section>
  );
};
