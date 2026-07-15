import type { Dispatch, SetStateAction } from 'react';

type ContentMap = Record<string, string>;
type ContentField = {
  key: string;
  label: string;
  multiline?: boolean;
};
type PolicySection = {
  title: string;
  fields: ContentField[];
};
type NotifyFn = (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;

type BaseProps = {
  content: ContentMap;
  policyDrafts: ContentMap;
  setPolicyDrafts: Dispatch<SetStateAction<ContentMap>>;
  setContentValue: (key: string, value: string) => void;
  notify: NotifyFn;
};

type SimpleEditorProps = BaseProps & {
  title: string;
  fields: ContentField[];
  successMessage: string;
};

function ContentFieldInput({
  field,
  value,
  setPolicyDrafts,
}: {
  field: ContentField;
  value: string;
  setPolicyDrafts: Dispatch<SetStateAction<ContentMap>>;
}) {
  return (
    <div key={field.key} className={field.multiline ? 'md:col-span-2' : ''}>
      <label className="block text-xs font-bold text-gray-600 mb-1">
        {field.label} • <code className="text-primary-500">{field.key}</code>
      </label>
      {field.multiline ? (
        <textarea
          className="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-24 text-sm"
          value={value}
          onChange={(e) => setPolicyDrafts((prev) => ({ ...prev, [field.key]: e.target.value }))}
        />
      ) : (
        <input
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          value={value}
          onChange={(e) => setPolicyDrafts((prev) => ({ ...prev, [field.key]: e.target.value }))}
        />
      )}
    </div>
  );
}

export function ContentHubSimpleEditor({
  title,
  fields,
  successMessage,
  content,
  policyDrafts,
  setPolicyDrafts,
  setContentValue,
  notify,
}: SimpleEditorProps) {
  return (
    <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-bold text-gray-900">{title}</h3>
        <div className="flex gap-2">
          <button onClick={() => setPolicyDrafts({})} className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm">إعادة تحميل</button>
          <button
            onClick={() => {
              fields.forEach((field) => {
                const value = policyDrafts[field.key] ?? content[field.key] ?? '';
                setContentValue(field.key, value);
              });
              notify('success', successMessage);
            }}
            className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-bold"
          >
            حفظ التعديلات
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {fields.map((field) => (
          <ContentFieldInput
            key={field.key}
            field={field}
            value={policyDrafts[field.key] ?? content[field.key] ?? ''}
            setPolicyDrafts={setPolicyDrafts}
          />
        ))}
      </div>
    </article>
  );
}

export function ContentHubPoliciesEditor({
  sections,
  content,
  policyDrafts,
  setPolicyDrafts,
  setContentValue,
  notify,
}: BaseProps & { sections: PolicySection[] }) {
  return (
    <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-bold text-gray-900">إدارة السياسات القانونية</h3>
        <div className="flex gap-2">
          <button onClick={() => setPolicyDrafts({})} className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm">إعادة تحميل</button>
          <button
            onClick={() => {
              sections.forEach((section) => {
                section.fields.forEach((field) => {
                  const value = policyDrafts[field.key] ?? content[field.key] ?? '';
                  setContentValue(field.key, value);
                });
              });
              notify('success', 'تم حفظ نصوص السياسات القانونية بنجاح.');
            }}
            className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-bold"
          >
            حفظ التعديلات
          </button>
        </div>
      </div>
      {sections.map((section) => (
        <section key={section.title} className="border border-gray-200 rounded-xl p-4 space-y-3">
          <h4 className="font-bold text-gray-800">{section.title}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {section.fields.map((field) => (
              <ContentFieldInput
                key={field.key}
                field={field}
                value={policyDrafts[field.key] ?? content[field.key] ?? ''}
                setPolicyDrafts={setPolicyDrafts}
              />
            ))}
          </div>
        </section>
      ))}
    </article>
  );
}

type GenericPageEditorProps = BaseProps & {
  activeTab: string;
  contentHubSubTab: string;
  pageConfigs: Record<string, {
    title: string;
    subtitle: string;
    fields: ContentField[];
    msg: string;
  }>;
};

export function ContentHubGenericPageEditor({
  activeTab,
  contentHubSubTab,
  pageConfigs,
  content,
  policyDrafts,
  setPolicyDrafts,
  setContentValue,
  notify,
}: GenericPageEditorProps) {
  const tabCfg = pageConfigs[activeTab] || (activeTab === 'content_hub' ? pageConfigs[contentHubSubTab] : null);
  if (!tabCfg) return null;

  return (
    <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-gray-900 text-lg">{tabCfg.title}</h3>
          <p className="text-xs text-gray-400 mt-1">{tabCfg.subtitle}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setPolicyDrafts({})} className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm">إعادة تحميل</button>
          <button
            onClick={() => {
              tabCfg.fields.forEach(field => setContentValue(field.key, policyDrafts[field.key] ?? content[field.key] ?? ''));
              notify('success', tabCfg.msg);
            }}
            className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-bold"
          >
            حفظ التعديلات
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {tabCfg.fields.map((field) => (
          <ContentFieldInput
            key={field.key}
            field={field}
            value={policyDrafts[field.key] ?? content[field.key] ?? ''}
            setPolicyDrafts={setPolicyDrafts}
          />
        ))}
      </div>
    </article>
  );
}
