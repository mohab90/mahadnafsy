import React, { Suspense, type Dispatch, type RefObject, type SetStateAction } from 'react';

import type { Course, ExtraCertificateType, SubscriberItem } from '../../types';
import { DashboardContentHubAdvancedPanel } from './DashboardContentHubAdvancedPanel';
import { DashboardHomeOfferPanel } from './DashboardHomeOfferPanel';
import { DashboardInstituteGalleryPanel } from './DashboardInstituteGalleryPanel';
import { ContentHubGenericPageEditor, ContentHubPoliciesEditor, ContentHubSimpleEditor } from './ContentHubEditors';
import {
  aboutPageFields,
  homeOfferFields,
  pageBundlesFields,
  pageCommunityFields,
  pageConsultationsFields,
  pageContactFields,
  pageCoursesFields,
  pageInstructorsFields,
  pageJoinUsFields,
  policySections,
} from './contentFields';
import { BranchAddForm, CertPricingTab, type CertPricingMap, type InstituteBranch } from './dashboardShared';
import type { TabKey } from './navigation';

const CertRequestsTab = React.lazy(() => import('./tabs/CertRequestsTab'));

type ContentMap = Record<string, string>;
type NotifyFn = (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;

interface DashboardDirectContentRoutesProps {
  activeTab: TabKey;
  contentHubSubTab: TabKey;
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
  courses: Course[];
  offerSelectedCourseId: string;
  setOfferSelectedCourseId: Dispatch<SetStateAction<string>>;
  instituteGalleryUploadRef: RefObject<HTMLInputElement | null>;
  handleInstituteGalleryUpload: (files: FileList | null) => void | Promise<void>;
  instituteGalleryUrlInput: string;
  setInstituteGalleryUrlInput: Dispatch<SetStateAction<string>>;
  instituteGalleryImages: string[];
  saveInstituteGalleryImages: (images: string[]) => void;
  instituteBranches: InstituteBranch[];
  certPricingMap: CertPricingMap;
  saveCertPricingMap: (map: CertPricingMap) => void;
  subscribers: SubscriberItem[];
  updateSubscriber: (subscriber: SubscriberItem) => void | Promise<void>;
  certSearch: string;
  setCertSearch: Dispatch<SetStateAction<string>>;
  certTypeFilter: ExtraCertificateType | 'all';
  setCertTypeFilter: Dispatch<SetStateAction<ExtraCertificateType | 'all'>>;
  certStatusFilter: string;
  setCertStatusFilter: Dispatch<SetStateAction<string>>;
}

export function DashboardDirectContentRoutes({
  activeTab,
  contentHubSubTab,
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
  courses,
  offerSelectedCourseId,
  setOfferSelectedCourseId,
  instituteGalleryUploadRef,
  handleInstituteGalleryUpload,
  instituteGalleryUrlInput,
  setInstituteGalleryUrlInput,
  instituteGalleryImages,
  saveInstituteGalleryImages,
  instituteBranches,
  certPricingMap,
  saveCertPricingMap,
  subscribers,
  updateSubscriber,
  certSearch,
  setCertSearch,
  certTypeFilter,
  setCertTypeFilter,
  certStatusFilter,
  setCertStatusFilter,
}: DashboardDirectContentRoutesProps) {
  return (
    <>
      {activeTab === 'content' && (
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

      {activeTab === 'policies' && (
        <ContentHubPoliciesEditor
          sections={policySections}
          content={content}
          policyDrafts={policyDrafts}
          setPolicyDrafts={setPolicyDrafts}
          setContentValue={setContentValue}
          notify={notify}
        />
      )}

      {activeTab === 'about_page' && (
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

      {activeTab === 'home_offer' && (
        <DashboardHomeOfferPanel
          fields={homeOfferFields}
          content={content}
          policyDrafts={policyDrafts}
          setPolicyDrafts={setPolicyDrafts}
          setContentValue={setContentValue}
          notify={notify}
          courses={courses}
          offerSelectedCourseId={offerSelectedCourseId}
          setOfferSelectedCourseId={setOfferSelectedCourseId}
        />
      )}

      <ContentHubGenericPageEditor
        activeTab={activeTab}
        contentHubSubTab={contentHubSubTab}
        pageConfigs={{
          page_courses: { title: 'محتوى صفحة الكورسات والدبلومات', subtitle: 'تعديل العناوين والنصوص التي تظهر في صفحة الدبلومات والبرامج', fields: pageCoursesFields, msg: 'تم حفظ محتوى صفحة الكورسات بنجاح.' },
          page_bundles: { title: 'محتوى صفحة الباقات', subtitle: 'تعديل العناوين والنصوص التي تظهر في صفحة الباقات التعليمية', fields: pageBundlesFields, msg: 'تم حفظ محتوى صفحة الباقات بنجاح.' },
          page_consultations: { title: 'محتوى صفحة الاستشارات', subtitle: 'تعديل نصوص وأسعار صفحة الاستشارات النفسية السريعة', fields: pageConsultationsFields, msg: 'تم حفظ محتوى صفحة الاستشارات بنجاح.' },
          page_instructors: { title: 'محتوى صفحة المحاضرين', subtitle: 'تعديل عنوان وعرض صفحة قائمة المحاضرين والمستشارين', fields: pageInstructorsFields, msg: 'تم حفظ محتوى صفحة المحاضرين بنجاح.' },
          page_contact: { title: 'محتوى صفحة تواصل معنا', subtitle: 'تعديل عناوين ونصوص صفحة التواصل مع المعهد', fields: pageContactFields, msg: 'تم حفظ محتوى صفحة التواصل بنجاح.' },
          page_joinus: { title: 'محتوى صفحة انضم إلينا', subtitle: 'تعديل عناوين وإحصائيات ومزايا صفحة الانضمام للمحاضرين والمستشارين', fields: pageJoinUsFields, msg: 'تم حفظ محتوى صفحة انضم إلينا بنجاح.' },
          page_community: { title: 'محتوى صفحة المجتمع', subtitle: 'تعديل عناوين أقسام صفحة مجتمع المعهد النفسي', fields: pageCommunityFields, msg: 'تم حفظ محتوى صفحة المجتمع بنجاح.' },
        }}
        content={content}
        policyDrafts={policyDrafts}
        setPolicyDrafts={setPolicyDrafts}
        setContentValue={setContentValue}
        notify={notify}
      />

      {activeTab === 'institute_gallery' && (
        <DashboardInstituteGalleryPanel
          content={content}
          policyDrafts={policyDrafts}
          setPolicyDrafts={setPolicyDrafts}
          setContentValue={setContentValue}
          instituteGalleryUploadRef={instituteGalleryUploadRef}
          handleInstituteGalleryUpload={handleInstituteGalleryUpload}
          instituteGalleryUrlInput={instituteGalleryUrlInput}
          setInstituteGalleryUrlInput={setInstituteGalleryUrlInput}
          instituteGalleryImages={instituteGalleryImages}
          saveInstituteGalleryImages={saveInstituteGalleryImages}
          instituteBranches={instituteBranches}
          BranchAddForm={BranchAddForm}
        />
      )}

      {activeTab === 'cert_pricing' && (
        <CertPricingTab certPricingMap={certPricingMap} saveCertPricingMap={saveCertPricingMap} notify={notify} />
      )}

      {activeTab === 'cert_requests' && (
        <Suspense fallback={<div className="text-center py-8 text-gray-400">جاري التحميل...</div>}>
          <CertRequestsTab
            notify={notify}
            courses={courses}
            subscribers={subscribers}
            updateSubscriber={updateSubscriber}
            certSearch={certSearch}
            setCertSearch={setCertSearch}
            certTypeFilter={certTypeFilter}
            setCertTypeFilter={(value) => setCertTypeFilter(value as ExtraCertificateType | 'all')}
            certStatusFilter={certStatusFilter}
            setCertStatusFilter={setCertStatusFilter}
          />
        </Suspense>
      )}
    </>
  );
}
