import { useMemo, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Building2, Facebook, Globe, ImageIcon, Instagram, Mail, MapPin, Phone, Youtube } from 'lucide-react';

import { ContentEditor } from './content-editor/ContentEditor';
import type { EditorApi, EditorSection } from './content-editor/types';
import { footerFields } from './contentFields';
import { BranchAddForm, type InstituteBranch } from './dashboardShared';

type Notify = (kind: 'success' | 'error' | 'warning' | 'info', message: string) => void;

type DashboardFooterSettingsPanelProps = {
  content: Record<string, string>;
  policyDrafts: Record<string, string>;
  setPolicyDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  setContentValue: (key: string, value: string) => Promise<boolean>;
  setContentValues: (entries: Record<string, string>) => Promise<boolean>;
  notify: Notify;
  instituteBranches: InstituteBranch[];
};

const SECTION_INFO: Record<string, { title: string; hint: string; icon: ReactNode }> = {
  logo: { title: 'شعار المعهد (اللوجو)', hint: 'رابط صورة اللوجو — بيظهر في الهيدر والفوتر والشهادات.', icon: <ImageIcon size={18} /> },
  contact: { title: 'بيانات التواصل', hint: 'اللي بيظهر في فوتر كل صفحة وفي صفحة التواصل.', icon: <Phone size={18} /> },
  social: { title: 'روابط السوشيال ميديا', hint: 'أيقونات الفوتر — الخانة الفاضية أيقونتها مش بتظهر.', icon: <Globe size={18} /> },
};

function FooterPreview({ api }: { api: EditorApi }) {
  const lines = [
    { icon: Phone, val: api.value('footer.phone') },
    { icon: Mail, val: api.value('footer.email') },
    { icon: MapPin, val: api.value('footer.address') },
  ].filter(line => line.val);
  const links = [
    { icon: Facebook, label: 'فيسبوك', href: api.value('footer.facebook'), color: 'text-blue-600' },
    { icon: Instagram, label: 'إنستجرام', href: api.value('footer.instagram'), color: 'text-pink-600' },
    { icon: Youtube, label: 'يوتيوب', href: api.value('footer.youtube'), color: 'text-red-600' },
  ].filter(link => link.href);
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
      <p className="mb-2 text-xs font-bold text-gray-500">معاينة سريعة (بالتعديلات اللي لسه متحفظتش)</p>
      <div className="flex flex-wrap gap-4 text-sm text-gray-600">
        {lines.map(({ icon: Icon, val }) => <span key={val} className="flex items-center gap-1.5"><Icon size={14} className="text-gray-400" />{val}</span>)}
      </div>
      {links.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-3">
          {links.map(({ icon: Icon, label, href, color }) => (
            <a key={label} href={href} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-1 text-xs hover:underline ${color}`}><Icon size={13} />{label}</a>
          ))}
        </div>
      )}
    </div>
  );
}

export function DashboardFooterSettingsPanel({
  content,
  policyDrafts,
  setPolicyDrafts,
  setContentValue,
  setContentValues,
  notify,
  instituteBranches,
}: DashboardFooterSettingsPanelProps) {
  const sections = useMemo<EditorSection[]>(() => [
    ...Object.entries(SECTION_INFO).map(([id, info]) => ({
      id,
      title: info.title,
      hint: info.hint,
      icon: info.icon,
      fields: footerFields.filter(field => field.section === id),
      after: id === 'social' ? (api: EditorApi) => <FooterPreview api={api} /> : undefined,
    })),
    {
      id: 'branches',
      title: 'الفروع والقاعات',
      hint: 'الفروع اللي هنا بتظهر لوحدها في نماذج التسجيل. كل فرع تقدر تضيف له قاعات (زي قاعات الدقي). بتتحفظ أول ما تضيفها.',
      icon: <Building2 size={18} />,
      keywords: 'فرع قاعة الدقي التجمع',
      fields: [],
      before: <BranchAddForm instituteBranches={instituteBranches} setContentValue={setContentValue} />,
    },
  ], [instituteBranches, setContentValue]);

  return (
    <ContentEditor
      title="الفوتر وبيانات التواصل"
      subtitle="اللوجو وأرقام التواصل والسوشيال ميديا والفروع — الحاجات اللي بتظهر في كل صفحة في الموقع."
      icon={<Phone size={20} />}
      sections={sections}
      content={content}
      drafts={policyDrafts}
      setDrafts={setPolicyDrafts}
      onSave={entries => setContentValues(entries)}
      notify={notify}
      successMessage="تم حفظ إعدادات الفوتر بنجاح."
    />
  );
}
