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

  return (
    <section id="lead-form" className="bg-gray-900 text-white p-8 rounded-3xl shadow-xl mt-8">
        <div className="text-center mb-8">
            <h2 className="text-2xl font-bold mb-2">{content['courseDetails.lead.title'] || 'لست متأكداً؟ سجل اهتمامك وسنتواصل معك'}</h2>
            <p className="text-gray-400 text-sm">{content['courseDetails.lead.subtitle'] || 'املأ النموذج أدناه وسيقوم أحد مستشارينا الأكاديميين بالتواصل معك للإجابة على جميع استفساراتك.'}</p>
        </div>
        <form className="max-w-xl mx-auto space-y-4" onSubmit={onSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input type="text" value={leadName} onChange={(e) => setLeadName(e.target.value)} placeholder={content['courseDetails.lead.namePlaceholder'] || 'الاسم الكامل'} className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:border-primary-500 transition" />
                <input type="tel" value={leadPhone} onChange={(e) => setLeadPhone(e.target.value)} placeholder={content['courseDetails.lead.phonePlaceholder'] || 'رقم الهاتف'} className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:border-primary-500 transition" />
            </div>
            <select value={leadBranch} onChange={(e) => setLeadBranch(e.target.value)} className="w-full bg-gray-800 border border-gray-700 text-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:border-primary-500 transition">
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
            {leadNotice && <div className="text-sm rounded-lg px-3 py-2 bg-white/10 border border-white/10 text-gray-100">{leadNotice}</div>}

            <button type="submit" className="w-full bg-primary-600 hover:bg-primary-700 text-white font-bold py-3 rounded-xl transition flex justify-center items-center gap-2">
                 <Send size={18} />
                 {content['courseDetails.lead.submit'] || 'إرسال الطلب'}
            </button>
        </form>
    </section>
  );
};
