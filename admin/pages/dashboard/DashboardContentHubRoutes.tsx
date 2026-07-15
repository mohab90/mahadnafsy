import React from 'react';
import { Sparkles } from 'lucide-react';

import { ContentHubPoliciesEditor, ContentHubSimpleEditor } from './ContentHubEditors';
import { DashboardContentHubAdvancedPanel } from './DashboardContentHubAdvancedPanel';
import { DashboardContentHubPanel } from './DashboardContentHubPanel';
import { DashboardFooterSettingsPanel } from './DashboardFooterSettingsPanel';
import { GeneralDashboardTabs } from './GeneralDashboardTabs';
import type { InstituteBranch } from './dashboardShared';
import type { TabKey } from './navigation';

type ContentMap = Record<string, string>;
type NotifyFn = (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
type ContentField = { key: string; label: string; multiline?: boolean };
type PolicySection = { title: string; fields: ContentField[] };

interface Props {
  activeTab: TabKey;
  contentHubSubTab: TabKey;
  setContentHubSubTab: (tab: TabKey) => void;
  setActiveTab: (tab: TabKey) => void;
  content: ContentMap;
  policyDrafts: ContentMap;
  setPolicyDrafts: React.Dispatch<React.SetStateAction<ContentMap>>;
  setContentValue: (key: string, value: string) => void;
  notify: NotifyFn;
  instituteBranches: InstituteBranch[];
  homeOfferFields: ContentField[];
  aboutPageFields: ContentField[];
  policySections: PolicySection[];
  contentEdits: ContentMap;
  setContentEdits: React.Dispatch<React.SetStateAction<ContentMap>>;
  newContentKey: string;
  setNewContentKey: React.Dispatch<React.SetStateAction<string>>;
  newContentValue: string;
  setNewContentValue: React.Dispatch<React.SetStateAction<string>>;
  addContentKey: (key: string, value: string) => void;
  searchText: string;
  setSearchText: React.Dispatch<React.SetStateAction<string>>;
  filteredContent: [string, string][];
  removeContentKey: (key: string) => void;
}

export function DashboardContentHubRoutes({
  activeTab,
  contentHubSubTab,
  setContentHubSubTab,
  setActiveTab,
  content,
  policyDrafts,
  setPolicyDrafts,
  setContentValue,
  notify,
  instituteBranches,
  homeOfferFields,
  aboutPageFields,
  policySections,
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
}: Props) {
  return (
<>
            {activeTab === 'content_hub' && (
              <DashboardContentHubPanel
                contentHubSubTab={contentHubSubTab}
                setContentHubSubTab={setContentHubSubTab}
                setActiveTab={setActiveTab}
              />
            )}

            <GeneralDashboardTabs activeTab={activeTab} notify={notify} />

            {/* -- Placeholder tabs (coming soon) -- */}
            {([] as TabKey[]).includes(activeTab) && (
              <article className="bg-white border border-gray-200 rounded-2xl p-12 shadow-sm flex flex-col items-center justify-center text-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-primary-50 flex items-center justify-center">
                  <Sparkles size={32} className="text-primary-500" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-xl mb-2">قريباً</h3>
                  <p className="text-gray-500 text-sm">هذا القسم قيد التطوير وسيكون متاحاً قريباً</p>
                </div>
              </article>
            )}



            {(activeTab === 'footer_settings' || (activeTab === 'content_hub' && contentHubSubTab === 'footer_settings')) && (
              <DashboardFooterSettingsPanel
                content={content}
                policyDrafts={policyDrafts}
                setPolicyDrafts={setPolicyDrafts}
                setContentValue={setContentValue}
                notify={notify}
                instituteBranches={instituteBranches}
              />
            )}
            {(activeTab === 'content_hub' && contentHubSubTab === 'home_offer') && (
              <ContentHubSimpleEditor
                title="إدارة الصفحة الرئيسية"
                fields={homeOfferFields}
                successMessage="تم حفظ إعدادات الصفحة الرئيسية بنجاح."
                content={content}
                policyDrafts={policyDrafts}
                setPolicyDrafts={setPolicyDrafts}
                setContentValue={setContentValue}
                notify={notify}
              />
            )}
            {(activeTab === 'content_hub' && contentHubSubTab === 'about_page') && (
              <ContentHubSimpleEditor
                title="إدارة صفحة عن المعهد"
                fields={aboutPageFields}
                successMessage="تم حفظ إعدادات صفحة عن المعهد بنجاح."
                content={content}
                policyDrafts={policyDrafts}
                setPolicyDrafts={setPolicyDrafts}
                setContentValue={setContentValue}
                notify={notify}
              />
            )}
            {(activeTab === 'content_hub' && contentHubSubTab === 'policies') && (
              <ContentHubPoliciesEditor
                sections={policySections}
                content={content}
                policyDrafts={policyDrafts}
                setPolicyDrafts={setPolicyDrafts}
                setContentValue={setContentValue}
                notify={notify}
              />
            )}
            {(activeTab === 'content_hub' && contentHubSubTab === 'hub_advanced') && (
              <DashboardContentHubAdvancedPanel
                content={content}
                policyDrafts={policyDrafts}
                setPolicyDrafts={setPolicyDrafts}
                setContentValue={setContentValue}
                notify={notify}
                contentEdits={contentEdits}
                setContentEdits={setContentEdits}
                newContentKey={newContentKey}
                setNewContentKey={setNewContentKey}
                newContentValue={newContentValue}
                setNewContentValue={setNewContentValue}
                addContentKey={addContentKey}
                searchText={searchText}
                setSearchText={setSearchText}
                filteredContent={filteredContent}
                removeContentKey={removeContentKey}
              />
            )}

</>
  );
}
