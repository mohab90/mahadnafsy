import { useMemo, type Dispatch, type SetStateAction } from 'react';
import { BookText, FileText, Scale } from 'lucide-react';

import { ContentEditor } from './content-editor/ContentEditor';
import type { EditorField, EditorSection } from './content-editor/types';

type ContentMap = Record<string, string>;
type ContentField = EditorField;
type PolicySection = {
  title: string;
  fields: ContentField[];
};
type NotifyFn = (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;

type BaseProps = {
  content: ContentMap;
  policyDrafts: ContentMap;
  setPolicyDrafts: Dispatch<SetStateAction<ContentMap>>;
  setContentValue: (key: string, value: string) => Promise<boolean>;
  /** Saves a whole form in one request — see useContentState.setContentValues. */
  setContentValues: (entries: Record<string, string>) => Promise<boolean>;
  notify: NotifyFn;
};

type SimpleEditorProps = BaseProps & {
  title: string;
  fields: ContentField[];
  successMessage: string;
  subtitle?: string;
};

/**
 * A flat field list as titled sections: by each field's `section` when it has
 * one, else by the label's own prefix («المعرض — العنوان» goes under «المعرض»,
 * labelled «العنوان»), else under `mainTitle`. Sections keep the order their
 * first field appears in, which is the order the page draws them.
 */
export function sectionsFromFields(fields: ContentField[], mainTitle: string): EditorSection[] {
  const sections: EditorSection[] = [];
  const byTitle = new Map<string, EditorSection>();
  for (const field of fields) {
    let title = field.section || mainTitle;
    let label = field.label;
    const dash = field.label.indexOf(' — ');
    if (!field.section && dash > 0) {
      title = field.label.slice(0, dash).trim();
      label = field.label.slice(dash + 3).trim();
    }
    let section = byTitle.get(title);
    if (!section) {
      section = { id: `s${sections.length}`, title, fields: [] };
      byTitle.set(title, section);
      sections.push(section);
    }
    section.fields.push(label === field.label ? field : { ...field, label });
  }
  return sections;
}

// One request for the whole page, from every editor below: the per-field loop
// these replaced posted the entire content document once per field, so a failure
// part-way through left the page half-saved while the fields that went first had
// already reported success. The editor sends only the keys that changed.

export function ContentHubSimpleEditor({
  title,
  subtitle,
  fields,
  successMessage,
  content,
  policyDrafts,
  setPolicyDrafts,
  setContentValues,
  notify,
}: SimpleEditorProps) {
  const pageSections = useMemo(() => sectionsFromFields(fields, 'نصوص الصفحة'), [fields]);
  return (
    <ContentEditor
      title={title}
      subtitle={subtitle}
      icon={<BookText size={20} />}
      sections={pageSections}
      content={content}
      drafts={policyDrafts}
      setDrafts={setPolicyDrafts}
      onSave={entries => setContentValues(entries)}
      notify={notify}
      successMessage={successMessage}
    />
  );
}

export function ContentHubPoliciesEditor({
  sections,
  content,
  policyDrafts,
  setPolicyDrafts,
  setContentValues,
  notify,
}: BaseProps & { sections: PolicySection[] }) {
  // Privacy and terms save together in one write. As 27 separate full-document
  // posts, a failure part-way through could leave terms.* unsaved while the
  // page still said "تم الحفظ".
  const pageSections = useMemo(
    () => sections.map((section, index) => ({ id: `p${index}`, title: section.title, fields: section.fields })),
    [sections],
  );
  return (
    <ContentEditor
      title="الشروط والسياسات"
      subtitle="نصوص صفحة سياسة الخصوصية وصفحة الشروط والأحكام، قسم قسم."
      icon={<Scale size={20} />}
      sections={pageSections}
      content={content}
      drafts={policyDrafts}
      setDrafts={setPolicyDrafts}
      onSave={entries => setContentValues(entries)}
      notify={notify}
      successMessage="تم حفظ نصوص السياسات القانونية بنجاح."
    />
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
  setContentValues,
  notify,
}: GenericPageEditorProps) {
  const tabCfg = pageConfigs[activeTab] || (activeTab === 'content_hub' ? pageConfigs[contentHubSubTab] : null);
  // Keyed on the field list, which is a module constant: pageConfigs itself is
  // rebuilt by the parent on every render.
  const pageFields = tabCfg?.fields;
  const pageSections = useMemo(() => sectionsFromFields(pageFields || [], 'نصوص عامة'), [pageFields]);
  if (!tabCfg) return null;

  return (
    <ContentEditor
      key={tabCfg.title}
      title={tabCfg.title}
      subtitle={tabCfg.subtitle}
      icon={<FileText size={20} />}
      sections={pageSections}
      content={content}
      drafts={policyDrafts}
      setDrafts={setPolicyDrafts}
      onSave={entries => setContentValues(entries)}
      notify={notify}
      successMessage={tabCfg.msg}
    />
  );
}
