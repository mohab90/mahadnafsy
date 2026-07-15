import type { Dispatch, SetStateAction } from 'react';
import { Plus, Save, Trash2, X } from 'lucide-react';

type ContentMap = Record<string, string>;
type NotifyFn = (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;

interface DashboardContentHubAdvancedPanelProps {
  content: ContentMap;
  policyDrafts: ContentMap;
  setPolicyDrafts: Dispatch<SetStateAction<ContentMap>>;
  setContentValue: (key: string, value: string) => void;
  notify: NotifyFn;
  contentEdits: ContentMap;
  setContentEdits: Dispatch<SetStateAction<ContentMap>>;
  newContentKey: string;
  setNewContentKey: Dispatch<SetStateAction<string>>;
  newContentValue: string;
  setNewContentValue: Dispatch<SetStateAction<string>>;
  addContentKey: (key: string, value: string) => void;
  searchText: string;
  setSearchText: Dispatch<SetStateAction<string>>;
  filteredContent: [string, string][];
  removeContentKey: (key: string) => void;
}

export function DashboardContentHubAdvancedPanel({
  content,
  policyDrafts,
  setPolicyDrafts,
  setContentValue,
  notify,
  contentEdits,
  setContentEdits,
  newContentKey,
  setNewContentKey,
  newContentValue,
  setNewContentValue,
  addContentKey,
  searchText,
  setSearchText,
  filteredContent,
  removeContentKey,
}: DashboardContentHubAdvancedPanelProps) {
  const videoKeys = ['video.autoplay', 'video.muted', 'video.loop', 'video.heroUrl'];

  return (
    <div className="space-y-4">
      <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
        <h3 className="font-bold text-gray-900">🖼️ شعار المعهد (اللوجو)</h3>
        <div>
          <label className="block text-xs font-bold text-gray-600 mb-1">رابط الشعار <span className="text-gray-400 font-normal">• institute.logo</span></label>
          <div className="flex gap-2 items-start">
            <input
              type="url"
              placeholder="https://..."
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={policyDrafts['institute.logo'] ?? content['institute.logo'] ?? ''}
              onChange={(event) => setPolicyDrafts((prev) => ({ ...prev, 'institute.logo': event.target.value }))}
            />
            <button
              onClick={() => {
                setContentValue('institute.logo', policyDrafts['institute.logo'] ?? content['institute.logo'] ?? '');
                setPolicyDrafts((prev) => { const next = { ...prev }; delete next['institute.logo']; return next; });
                notify('success', 'تم حفظ الشعار بنجاح.');
              }}
              className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-bold whitespace-nowrap"
            >
              حفظ الشعار
            </button>
          </div>
          {(policyDrafts['institute.logo'] || content['institute.logo']) && (
            <div className="mt-3 p-3 border border-gray-100 rounded-xl bg-gray-50 inline-block">
              <p className="text-xs text-gray-400 mb-2">معاينة:</p>
              <img src={policyDrafts['institute.logo'] || content['institute.logo']} alt="logo preview" className="h-16 w-auto object-contain" />
            </div>
          )}
        </div>
      </article>

      <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
        <h3 className="font-bold text-gray-900">▶️ إعدادات تشغيل الفيديوهات</h3>
        <div className="space-y-3">
          {[
            { key: 'video.autoplay', label: 'تشغيل الفيديو تلقائياً عند فتح الصفحة', hint: 'true أو false' },
            { key: 'video.muted', label: 'تشغيل الفيديو بدون صوت (مطلوب للتشغيل التلقائي)', hint: 'true أو false' },
            { key: 'video.loop', label: 'تكرار تشغيل الفيديو', hint: 'true أو false' },
            { key: 'video.heroUrl', label: 'رابط فيديو الهيرو في الصفحة الرئيسية', hint: 'https://...' },
          ].map((field) => (
            <div key={field.key} className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block text-xs font-bold text-gray-600 mb-1">{field.label} • <code className="text-primary-500 text-xs">{field.key}</code></label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder={field.hint}
                  value={policyDrafts[field.key] ?? content[field.key] ?? ''}
                  onChange={(event) => setPolicyDrafts((prev) => ({ ...prev, [field.key]: event.target.value }))}
                />
              </div>
            </div>
          ))}
          <button
            onClick={() => {
              videoKeys.forEach((key) => {
                if (policyDrafts[key] !== undefined) setContentValue(key, policyDrafts[key]);
              });
              setPolicyDrafts((prev) => {
                const next = { ...prev };
                videoKeys.forEach((key) => delete next[key]);
                return next;
              });
              notify('success', 'تم حفظ إعدادات الفيديو بنجاح.');
            }}
            className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-bold"
          >
            حفظ إعدادات الفيديو
          </button>
        </div>
      </article>

      <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="font-bold text-gray-900">محرر المحتوى المتقدم (جميع المفاتيح)</h3>
          {Object.keys(contentEdits).length > 0 && (
            <button
              onClick={() => {
                Object.entries(contentEdits).forEach(([key, value]) => setContentValue(key, value));
                setContentEdits({});
                notify('success', `تم حفظ ${Object.keys(contentEdits).length} تعديل بنجاح.`);
              }}
              className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-primary-700 transition"
            >
              <Save size={14} /> حفظ كل التعديلات ({Object.keys(contentEdits).length})
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-3 mb-4">
          <input value={newContentKey} onChange={(event) => setNewContentKey(event.target.value)} placeholder="مثال: new.key" className="border border-gray-300 rounded-xl px-3 py-2" />
          <input value={newContentValue} onChange={(event) => setNewContentValue(event.target.value)} placeholder="القيمة" className="border border-gray-300 rounded-xl px-3 py-2" />
          <button onClick={() => { if (!newContentKey) return; addContentKey(newContentKey, newContentValue); setNewContentKey(''); setNewContentValue(''); }} className="bg-primary-600 text-white rounded-xl px-4 py-2 font-bold">
            <Plus size={16} className="inline ml-1" />إضافة
          </button>
        </div>
        <div className="mb-4">
          <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="ابحث داخل المفاتيح والقيم" className="w-full border border-gray-300 rounded-xl px-3 py-2" />
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-right border-b border-gray-100">
              <th className="py-2">المفتاح</th><th className="py-2">القيمة</th><th className="py-2">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {filteredContent.map(([key, savedValue]) => {
              const isDirty = contentEdits[key] !== undefined && contentEdits[key] !== savedValue;
              const displayValue = contentEdits[key] !== undefined ? contentEdits[key] : savedValue;
              return (
                <tr key={key} className={`border-b border-gray-50 align-top ${isDirty ? 'bg-amber-50/50' : ''}`}>
                  <td className="py-3 font-medium text-gray-700 pr-1">
                    {key}
                    {isDirty && <span className="mr-1 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">غير محفوظ</span>}
                  </td>
                  <td className="py-3">
                    <textarea
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-24 focus:border-primary-400 focus:outline-none"
                      value={displayValue}
                      onChange={(event) => setContentEdits((prev) => ({ ...prev, [key]: event.target.value }))}
                    />
                  </td>
                  <td className="py-3 pl-2">
                    <div className="flex flex-col gap-1">
                      {isDirty && (
                        <button
                          onClick={() => {
                            setContentValue(key, contentEdits[key]);
                            setContentEdits((prev) => { const next = { ...prev }; delete next[key]; return next; });
                          }}
                          className="flex items-center gap-1 px-2 py-1.5 bg-primary-600 text-white rounded-lg text-xs font-bold hover:bg-primary-700 transition whitespace-nowrap"
                        >
                          <Save size={11} /> حفظ
                        </button>
                      )}
                      {isDirty && (
                        <button
                          onClick={() => setContentEdits((prev) => { const next = { ...prev }; delete next[key]; return next; })}
                          className="flex items-center gap-1 px-2 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs hover:bg-gray-200 transition whitespace-nowrap"
                        >
                          <X size={11} /> تراجع
                        </button>
                      )}
                      <button onClick={() => { if (window.confirm('حذف هذا المفتاح نهائياً؟')) removeContentKey(key); }} className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </article>
    </div>
  );
}
