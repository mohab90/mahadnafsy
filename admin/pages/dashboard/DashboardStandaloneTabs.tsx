import React, { Suspense } from 'react';
import { TabErrorBoundary } from '../../../shared/ui/TabErrorBoundary';
import type { TabKey } from './navigation';
import {
  ActivityTab,
  CohortAnalysisTab,
  ConsultationCalendarTab,
  DaqqiAttendanceTab,
  CourseWaitlistTab,
  KpiDashboardTab,
  LiveStreamsTab,
  NotificationsAdminTab,
  QuizzesTab,
} from './lazyTabs';

type Notify = (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;

interface DashboardStandaloneTabsProps {
  activeTab: TabKey;
  isSalesOnly: boolean;
  notify: Notify;
}

/**
 * Small, self-contained dashboard tabs that only need the active route and toast API.
 * Keeping them together removes routing noise from the main dashboard without moving
 * any business state or persistence logic.
 */
export function DashboardStandaloneTabs({ activeTab, isSalesOnly, notify }: DashboardStandaloneTabsProps) {
  return (
    <>
      {activeTab === 'kpi_dashboard' && (
        <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-indigo-600" /></div>}>
          <KpiDashboardTab notify={notify} />
        </Suspense>
      )}

      {activeTab === 'cohort_analysis' && (
        <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-emerald-600" /></div>}>
          <CohortAnalysisTab notify={notify} />
        </Suspense>
      )}

      {activeTab === 'daqqi_attendance' && (
        <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-teal-600" /></div>}>
          <DaqqiAttendanceTab notify={(message, type) => notify(type || 'info', message)} />
        </Suspense>
      )}

      {activeTab === 'consultations' && (
        <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" /></div>}>
          <TabErrorBoundary>
            <ConsultationCalendarTab notify={notify} />
          </TabErrorBoundary>
        </Suspense>
      )}

      {activeTab === 'notifications' && (
        <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>}>
          <NotificationsAdminTab />
        </Suspense>
      )}

      {activeTab === 'activity' && (
        <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-gray-600 border-t-transparent" /></div>}>
          <ActivityTab isSalesOnly={isSalesOnly} />
        </Suspense>
      )}

      {activeTab === 'quizzes' && (
        <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" /></div>}>
          <QuizzesTab notify={notify} />
        </Suspense>
      )}

      {activeTab === 'course_waitlist' && (
        <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" /></div>}>
          <CourseWaitlistTab notify={notify} />
        </Suspense>
      )}

      {activeTab === 'live_streams' && (
        <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" /></div>}>
          <LiveStreamsTab notify={notify} />
        </Suspense>
      )}
    </>
  );
}
