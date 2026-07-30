import type { Dispatch, SetStateAction } from 'react';
import { Facebook, Globe, Instagram, Mail, MapPin, Phone, Save, Youtube } from 'lucide-react';

import { BranchAddForm, type InstituteBranch } from './dashboardShared';

type Notify = (kind: 'success' | 'error' | 'warning' | 'info', message: string) => void;

type DashboardFooterSettingsPanelProps = {
  content: Record<string, string>;
  policyDrafts: Record<string, string>;
  setPolicyDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  setContentValue: (key: string, value: string) => Promise<boolean>;
  notify: Notify;
  instituteBranches: InstituteBranch[];
};

export function DashboardFooterSettingsPanel({
  content,
  policyDrafts,
  setPolicyDrafts,
  setContentValue,
  notify,
  instituteBranches,
}: DashboardFooterSettingsPanelProps) {
  return (
  <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-bold text-gray-900 text-lg">إعدادات الفوتر والتواصل الاجتماعي</h3>
      <button
        onClick={async () => {
          const entries = Object.entries(policyDrafts)
            .filter(([key]) => key.startsWith('footer.') || key === 'institute.logo');
          const saved = await Promise.all(entries.map(([key, value]) => setContentValue(key, value)));
          if (!saved.every(Boolean)) {
            notify('error', 'تعذر حفظ بعض إعدادات الفوتر على السيرفر.');
            return;
          }
          setPolicyDrafts(prev => {
            const next = { ...prev };
            Object.keys(next).filter(k => k.startsWith('footer.') || k === 'institute.logo').forEach(k => delete next[k]);
            return next;
          });
          notify('success', 'تم حفظ إعدادات الفوتر بنجاح.');
        }}
        className="px-5 py-2 rounded-xl bg-primary-600 text-white text-sm font-bold flex items-center gap-2 hover:bg-primary-700 transition"
      >
        <Save size={15} />حفظ التغييرات
      </button>
    </div>

    {/* Logo */}
    <section className="border border-gray-200 rounded-xl p-5 space-y-3">
      <h4 className="font-bold text-gray-800">🖼️ شعار المعهد (اللوجو)</h4>
      <div className="flex gap-2 items-start">
        <input
          type="url"
          placeholder="https://..."
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
          value={policyDrafts['institute.logo'] ?? content['institute.logo'] ?? ''}
          onChange={e => setPolicyDrafts(prev => ({ ...prev, 'institute.logo': e.target.value }))}
        />
        {(policyDrafts['institute.logo'] || content['institute.logo']) && (
          <img
            src={policyDrafts['institute.logo'] || content['institute.logo']}
            alt="logo"
            className="h-12 w-auto object-contain border border-gray-200 rounded-lg p-1 bg-gray-50"
          />
        )}
      </div>
      <p className="text-xs text-gray-400">الشعار يظهر في الهيدر، الفوتر، والشهادات. • المفتاح: <code>institute.logo</code></p>
    </section>

    {/* Contact Info */}
    <section className="border border-gray-200 rounded-xl p-5 space-y-4">
      <h4 className="font-bold text-gray-800 flex items-center gap-2"><Phone size={16} className="text-primary-500" />معلومات التواصل</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { key: 'footer.phone', label: 'رقم الهاتف', type: 'text' },
          { key: 'footer.email', label: 'البريد الإلكتروني', type: 'email' },
          { key: 'footer.whatsapp', label: 'رقم واتساب (أرقام فقط بدون +)', type: 'text' },
          { key: 'footer.address', label: 'العنوان', type: 'text' },
        ].map(f => (
          <div key={f.key}>
            <label className="block text-xs font-bold text-gray-600 mb-1">{f.label} <span className="text-gray-400 font-normal">• {f.key}</span></label>
            <input
              type={f.type}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-primary-400 focus:outline-none"
              value={policyDrafts[f.key] ?? content[f.key] ?? ''}
              onChange={e => setPolicyDrafts(prev => ({ ...prev, [f.key]: e.target.value }))}
            />
          </div>
        ))}
        <div className="md:col-span-2">
          <label className="block text-xs font-bold text-gray-600 mb-1">وصف المعهد في الفوتر <span className="text-gray-400 font-normal">• footer.description</span></label>
          <textarea
            rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-primary-400 focus:outline-none"
            value={policyDrafts['footer.description'] ?? content['footer.description'] ?? ''}
            onChange={e => setPolicyDrafts(prev => ({ ...prev, 'footer.description': e.target.value }))}
          />
        </div>
      </div>
    </section>

    {/* Social Media Links */}
    <section className="border border-gray-200 rounded-xl p-5 space-y-4">
      <h4 className="font-bold text-gray-800 flex items-center gap-2"><Globe size={16} className="text-blue-500" />روابط التواصل الاجتماعي</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { key: 'footer.facebook', label: 'فيسبوك', icon: Facebook, color: 'text-blue-600' },
          { key: 'footer.instagram', label: 'إنستجرام', icon: Instagram, color: 'text-pink-600' },
          { key: 'footer.youtube', label: 'يوتيوب', icon: Youtube, color: 'text-red-600' },
        ].map(f => {
          const Icon = f.icon;
          return (
            <div key={f.key}>
              <label className="block text-xs font-bold text-gray-600 mb-1 flex items-center gap-1.5">
                <Icon size={13} className={f.color} />{f.label} <span className="text-gray-400 font-normal">• {f.key}</span>
              </label>
              <input
                type="url"
                placeholder="https://..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-primary-400 focus:outline-none"
                value={policyDrafts[f.key] ?? content[f.key] ?? ''}
                onChange={e => setPolicyDrafts(prev => ({ ...prev, [f.key]: e.target.value }))}
              />
            </div>
          );
        })}
      </div>
    </section>

    {/* Preview */}
    <section className="border border-dashed border-gray-300 rounded-xl p-4 bg-gray-50">
      <h4 className="text-sm font-bold text-gray-600 mb-3">معاينة سريعة للبيانات الحالية</h4>
      <div className="flex flex-wrap gap-4 text-sm text-gray-600">
        {[
          { icon: Phone, val: policyDrafts['footer.phone'] || content['footer.phone'] },
          { icon: Mail, val: policyDrafts['footer.email'] || content['footer.email'] },
          { icon: MapPin, val: policyDrafts['footer.address'] || content['footer.address'] },
        ].filter(i => i.val).map((i, idx) => {
          const Icon = i.icon;
          return <span key={idx} className="flex items-center gap-1.5"><Icon size={14} className="text-gray-400" />{i.val}</span>;
        })}
      </div>
      <div className="flex gap-3 mt-3">
        {(policyDrafts['footer.facebook'] || content['footer.facebook']) && (
          <a href={policyDrafts['footer.facebook'] || content['footer.facebook']} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-600 text-xs hover:underline"><Facebook size={13} />فيسبوك</a>
        )}
        {(policyDrafts['footer.instagram'] || content['footer.instagram']) && (
          <a href={policyDrafts['footer.instagram'] || content['footer.instagram']} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-pink-600 text-xs hover:underline"><Instagram size={13} />إنستجرام</a>
        )}
        {(policyDrafts['footer.youtube'] || content['footer.youtube']) && (
          <a href={policyDrafts['footer.youtube'] || content['footer.youtube']} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-red-600 text-xs hover:underline"><Youtube size={13} />يوتيوب</a>
        )}
      </div>
    </section>

    {/* Branches management (including Dokki rooms) */}
    <section className="border border-gray-200 rounded-xl p-5 space-y-4">
      <h4 className="font-bold text-gray-800">🏢 إدارة الفروع والقاعات</h4>
      <p className="text-xs text-gray-500">الفروع التي تضيفها هنا ستظهر تلقائياً في نماذج التسجيل. يمكنك إضافة قاعات لكل فرع (مثل قاعات الدقي).</p>
      <BranchAddForm instituteBranches={instituteBranches} setContentValue={setContentValue} />
    </section>
  </article>
  );
}
