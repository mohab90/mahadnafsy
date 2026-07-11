import React from 'react';
import JobPostingsPanel from '../JobPostingsPanel';
import type { NotifyFn } from './shared';

interface Props {
  talent: any[];
  loadingTalent: boolean;
  talentBusy: string | null;
  talentAction: (url: string, id: string, ok: string) => void;
  recruitTab: 'instructors' | 'employees';
  setRecruitTab: React.Dispatch<React.SetStateAction<'instructors' | 'employees'>>;
  notify: NotifyFn;
}

const RecruitingTab: React.FC<Props> = ({ talent, loadingTalent, talentBusy, talentAction, recruitTab, setRecruitTab, notify }) => {
  const isEmp = (x: any) => String(x.applicant_type || '').toUpperCase() === 'EMPLOYEE';
  const shown = talent.filter(t => recruitTab === 'employees' ? isEmp(t) : !isEmp(t));
  const empCount = talent.filter(isEmp).length;
  const instCount = talent.length - empCount;
  return (
    <div className="space-y-3">
      {/* Job postings management — feeds the public careers/employee-join page */}
      <JobPostingsPanel notify={notify} />
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-700">📨 طلبات الانضمام</h3>
        {loadingTalent && <span className="text-xs text-gray-400">جارٍ التحميل…</span>}
      </div>
      {/* Inner tabs: instructor/consultant vs employee applications */}
      <div className="flex gap-2">
        {([['instructors', `طلبات المحاضرين (${instCount})`], ['employees', `طلبات الموظفين (${empCount})`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setRecruitTab(k)}
            className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${recruitTab === k ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-gray-600 border-gray-200 hover:border-slate-400'}`}>{l}</button>
        ))}
      </div>
      {shown.length === 0 && !loadingTalent ? (
        <div className="text-center py-12 text-gray-400 bg-white rounded-2xl border border-gray-100">لا توجد طلبات في هذا القسم بعد</div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl divide-y divide-gray-50">
          {shown.map((t: any) => {
            const stage = t.applicant_stage || (t.converted_applicant_id ? 'applied' : 'new');
            const stageLabel: Record<string, string> = { new: 'جديد', applied: 'في المسار', screening: 'فرز', interview: 'مقابلة', offer: 'عرض', hired: 'تم التعيين', rejected: 'مرفوض' };
            return (
              <div key={t.id} className="flex items-start gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-gray-800 text-sm">{t.name}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600">{t.applicant_type || '—'}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${stage === 'hired' ? 'bg-emerald-100 text-emerald-700' : stage === 'rejected' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600'}`}>{stageLabel[stage] || stage}</span>
                    <span className="text-[10px] text-gray-400">{String(t.created_at).slice(0, 10)}</span>
                  </div>
                  <p className="text-xs text-gray-600 truncate">{t.specialty}{t.email ? ` · ${t.email}` : ''}{t.phone ? ` · ${t.phone}` : ''}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!t.converted_applicant_id && (
                    <button disabled={talentBusy === t.id} onClick={() => talentAction(`/api/admin/hr/join-us/${t.id}/to-applicant`, t.id, 'أُضيف إلى مسار التوظيف')}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-bold disabled:opacity-40">↦ إلى المسار</button>
                  )}
                  {t.converted_applicant_id && stage !== 'hired' && (
                    <button disabled={talentBusy === t.id} onClick={() => talentAction(`/api/admin/hr/applicants/${t.converted_applicant_id}/hire`, t.id, 'تم التعيين — يحتاج تفعيل الحساب')}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-700 font-bold disabled:opacity-40">✓ تعيين</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-gray-400 text-center">طلبات الانضمام من الموقع تدخل هذا المسار تلقائياً — انقلها إلى مسار المتقدمين ثم عيّنها كموظف.</p>
    </div>
  );
};

export default RecruitingTab;
