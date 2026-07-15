import React, { Suspense } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { Settings2, Shield, User } from 'lucide-react';
import { TabErrorBoundary } from '../../../shared/ui/TabErrorBoundary';
import type { PaymentDraft } from '../../components/PaymentModal';
import type {
  AuthUser,
  Bundle,
  CommunicationRecord,
  CommunityPostItem,
  ConsultationItem,
  Course,
  DaqqiRound,
  LeadItem,
  OrderItem,
  SalesTarget,
  StaffMember,
  StaffPermission,
  SubscriberItem,
  Therapist,
} from '../../types';
import {
  ActivityTab,
  AdminAiSettingsTab,
  AskAITab,
  AutomationDashboardTab,
  AutomationTab,
  BalanceSheetTab,
  BudgetTrackerTab,
  CashFlowTab,
  ClientDbTab,
  CohortAnalysisTab,
  KpiDashboardTab,
  ConsultationCalendarTab,
  ContactsTab,
  CoursesTab,
  DaqqiAttendanceTab,
  DaqqiScheduleTab,
  DaqqiTeamTab,
  DripCampaignsTab,
  EmailCampaignsTab,
  ExpenseAnalyticsTab,
  FinancialTab,
  FollowupRemindersTab,
  ForecastTab,
  HrTab,
  InstallmentPlansTab,
  IpWhitelistTab,
  JoinUsAdminTab,
  LeadScoringTab,
  LeadsTab,
  LiveStreamsTab,
  MarketingHubTab,
  MessagingAgentTab,
  MyHrTab,
  NpsDashboardTab,
  NotifInboxMgmtTab,
  NotificationsAdminTab,
  OnlineTeamMgmtTab,
  OnlineTeamTab,
  PgMigrateTab,
  QuizzesTab,
  RecurringExpensesTab,
  RetentionTab,
  RevenueForecastTab,
  RevenueSourcesTab,
  SalesGoalsTab,
  SalesHubTab,
  SalesReportsTab,
  SalesTeamTab,
  SecurityDashboardTab,
  ServerMonitorTab,
  SmsCampaignsTab,
  SmsSettingsTab,
  StaffHomeTab,
  StaffPerformanceTab,
  SubscriptionsTab,
  SystemSettingsTab,
  TasksBoardTab,
  TicketsTab,
  SupportInboxTab,
  WaitlistTab,
  WebhooksTab,
} from './lazyTabs';
const ChartOfAccountsTab = React.lazy(() => import('./tabs/ChartOfAccountsTab'));
const BranchWorkspacesTab = React.lazy(() => import('./tabs/BranchWorkspacesTab'));
const TenantsAdminTab = React.lazy(() => import('./tabs/TenantsAdminTab'));
const OnlineClientsTab = React.lazy(() => import('./tabs/OnlineClientsTab'));
const OverviewTab = React.lazy(() => import('./tabs/OverviewTab'));
const CertRequestsTab = React.lazy(() => import('./tabs/CertRequestsTab'));
const CommunityAdminTab = React.lazy(() => import('./tabs/CommunityAdminTab'));
const StaffSettingsTab = React.lazy(() => import('./tabs/StaffSettingsTab'));
const ContentHubTab = React.lazy(() => import('./tabs/ContentHubTab'));
const RefundRequestsTab = React.lazy(() => import('./tabs/RefundRequestsTab'));
const OrdersTab = React.lazy(() => import('./tabs/OrdersTab'));
import { CertPricingTab, TAB_PERMISSION_MAP, type CertPricingMap } from './dashboardShared';
import { type TabKey } from './navigation';
const FinancialReportsHub = React.lazy(() => import('./FinancialReportsHub'));
const HrHub = React.lazy(() => import('./HrHub'));
const AnalyticsHub = React.lazy(() => import('./AnalyticsHub'));
const BranchWorkspaceHub = React.lazy(() => import('./BranchWorkspaceHub'));
const SalesFollowupPanel = React.lazy(() => import('./SalesFollowupPanel'));
const OnlineManagerPanels = React.lazy(() => import('./OnlineManagerPanels'));

// Local — only used behind the permission gate below, never elsewhere.
type BranchEntry = { id: string; label: string };
type SubInstDraft = {
  courseId: string; currency: 'EGP' | 'SAR' | 'USD';
  amountPerInst: string; numInstallments: string;
  inputMode: 'count' | 'amount';
  startDate: string;
  intervalDays: string; notes: string; overrideExpected: string;
};
type SubContactDraft = {
  type: CommunicationRecord['type'];
  date: string;
  notes: string;
  outcome: string;
  nextFollowUp: string;
};
type OrdersStats = {
  total: number; paid: number; failed: number; refunded: number;
  revenueEGP: number; revenueSAR: number; revenueUSD: number;
};

const AccessDenied: React.FC = () => (
  <div className="bg-white border border-red-200 rounded-2xl p-12 text-center">
    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
      <Shield size={28} className="text-red-500" />
    </div>
    <h3 className="text-lg font-bold text-gray-900 mb-2">غير مصرح بالوصول</h3>
    <p className="text-gray-500 text-sm">ليس لديك صلاحية الوصول لهذا القسم. تواصل مع المدير لطلب الصلاحية.</p>
  </div>
);

export interface DashboardTabRouterProps {
  activeTab: TabKey;
  isAdmin: boolean;
  hasPermission: (perm: StaffPermission) => boolean;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
  setActiveTab: (tab: TabKey) => void;
  setActiveTabState: React.Dispatch<React.SetStateAction<TabKey>>;
  navigate: NavigateFunction;

  orders: OrderItem[];
  currentStaff: StaffMember | null;
  salesOwnLeads: LeadItem[];
  salesOwnSubscribers: SubscriberItem[];
  salesOwnOrders: OrderItem[];
  subscribers: SubscriberItem[];
  courses: Course[];
  staffMembers: StaffMember[];
  leads: LeadItem[];
  consultations: ConsultationItem[];
  therapists: Therapist[];
  communityPosts: CommunityPostItem[];
  content: Record<string, string>;
  isOnlineManager: boolean;
  isCollectionRole: boolean;
  isReceptionDaqqi: boolean;
  isSalesOnly: boolean;
  onlineTeamMembers: StaffMember[];
  onlineUsers: { uid: string; email?: string; displayName?: string; lastActiveAt: string }[];

  policyDrafts: Record<string, string>;
  setPolicyDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  instituteGalleryImages: string[];
  instituteBranches: BranchEntry[];

  certPricingMap: CertPricingMap;
  saveCertPricingMap: (map: CertPricingMap) => void;

  updateSubscriber: (item: SubscriberItem) => void;

  lectureCourseId: string;
  setLectureCourseId: React.Dispatch<React.SetStateAction<string>>;
  subscriberCourseFilter: string;
  setSubscriberCourseFilter: React.Dispatch<React.SetStateAction<string>>;

  bundles: Bundle[];
  salesOwnDaqqiRounds: DaqqiRound[] | null;
  setSalesOwnDaqqiRounds: React.Dispatch<React.SetStateAction<DaqqiRound[] | null>>;
  addSubscriber: (item: SubscriberItem) => Promise<boolean>;
  addLead: (item: LeadItem) => Promise<void>;
  deleteSubscriber: (id: string) => void;
  isDaqqiManager: boolean;
  isNonAdminStaff: boolean;
  staffSelf: StaffMember | null;
  setSubPayRow: React.Dispatch<React.SetStateAction<SubscriberItem | null>>;
  setSubPayDraft: React.Dispatch<React.SetStateAction<PaymentDraft>>;
  setSubContactRow: React.Dispatch<React.SetStateAction<SubscriberItem | null>>;
  setSubContactDraft: React.Dispatch<React.SetStateAction<SubContactDraft>>;
  setSubInstRow: React.Dispatch<React.SetStateAction<SubscriberItem | null>>;
  setSubInstDraft: React.Dispatch<React.SetStateAction<SubInstDraft>>;
  setSubWaRow: React.Dispatch<React.SetStateAction<SubscriberItem | null>>;
  setSalesOwnSubscribers: React.Dispatch<React.SetStateAction<SubscriberItem[]>>;

  effectiveOrders: OrderItem[];
  ordersStats: OrdersStats;
  authUser: AuthUser | null | undefined;
  updateOrderStatus: (id: string, status: OrderItem['status']) => void;
  addOrder: (item: OrderItem) => void;
  deleteOrder: (id: string) => void;

  handleClientDbBook: (clientId: string, type: 'subscriber' | 'lead') => void;

  onlineMgrFollowupOpen: boolean;
  setOnlineMgrFollowupOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onlineMgrNewEventsOpen: boolean;
  setOnlineMgrNewEventsOpen: React.Dispatch<React.SetStateAction<boolean>>;

  salesNotifOpen: boolean;
  setSalesNotifOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setLeadsFollowupFilter: React.Dispatch<React.SetStateAction<'all' | 'today' | 'overdue'>>;

  fetchSalesData: () => Promise<void>;
  salesDataLoading: boolean;
  leadsSalesTargets: SalesTarget[];
  setStaffProfileModalId: React.Dispatch<React.SetStateAction<string | null>>;
}

// Tab-content routing — extracted verbatim from Dashboard.tsx's main render.
// Same conditions/order/props; only the location moved. The permission gate
// (TAB_PERMISSION_MAP lookup) that used to wrap this JSX in an inline IIFE
// is now just the top of this component's body.
const DashboardTabRouter: React.FC<DashboardTabRouterProps> = ({
  activeTab, isAdmin, hasPermission, notify, setActiveTab, setActiveTabState, navigate,
  orders, currentStaff, salesOwnLeads, salesOwnSubscribers, salesOwnOrders, subscribers,
  courses, staffMembers, leads, consultations, therapists, communityPosts, content,
  isOnlineManager, isCollectionRole, isReceptionDaqqi, isSalesOnly, onlineTeamMembers, onlineUsers,
  policyDrafts, setPolicyDrafts, instituteGalleryImages, instituteBranches,
  certPricingMap, saveCertPricingMap,
  updateSubscriber,
  lectureCourseId, setLectureCourseId, subscriberCourseFilter, setSubscriberCourseFilter,
  bundles, salesOwnDaqqiRounds, setSalesOwnDaqqiRounds, addSubscriber, addLead, deleteSubscriber,
  isDaqqiManager, isNonAdminStaff, staffSelf,
  setSubPayRow, setSubPayDraft, setSubContactRow, setSubContactDraft, setSubInstRow, setSubInstDraft, setSubWaRow,
  setSalesOwnSubscribers,
  effectiveOrders, ordersStats, authUser, updateOrderStatus, addOrder, deleteOrder,
  handleClientDbBook,
  onlineMgrFollowupOpen, setOnlineMgrFollowupOpen, onlineMgrNewEventsOpen, setOnlineMgrNewEventsOpen,
  salesNotifOpen, setSalesNotifOpen, setLeadsFollowupFilter,
  fetchSalesData, salesDataLoading, leadsSalesTargets, setStaffProfileModalId,
}) => {
  const __tabPerm = TAB_PERMISSION_MAP[activeTab];
  // Block if tab has a required permission and staff lacks it.
  // Also block unmapped tabs for non-admins (fail-secure default).
  if (!isAdmin && (!__tabPerm || !hasPermission(__tabPerm))) return <AccessDenied />;
  return (
  <TabErrorBoundary key={activeTab} tabName={activeTab}><>

            {activeTab === 'overview' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>}>
              <OverviewTab
                orders={orders}
                currentStaff={currentStaff ?? null}
                salesOwnLeads={salesOwnLeads ?? []}
                salesOwnSubscribers={salesOwnSubscribers}
                salesOwnOrders={salesOwnOrders}
                subscribers={subscribers}
                courses={courses}
                staffMembers={staffMembers}
                leads={leads}
                consultations={consultations}
                therapists={therapists}
                communityPosts={communityPosts}
                content={content}
                isAdmin={isAdmin}
                isOnlineManager={isOnlineManager}
                isCollectionRole={isCollectionRole}
                isReceptionDaqqi={isReceptionDaqqi}
                isSalesOnly={isSalesOnly}
                onlineTeamMembers={onlineTeamMembers}
                onlineUsers={onlineUsers}
                notify={notify}
                setActiveTab={(tab: string) => setActiveTab(tab as TabKey)}
                navigate={navigate}
              />
              </Suspense>
            )}


            {(activeTab === 'content_hub' || activeTab === 'content' || activeTab === 'policies' ||
              activeTab === 'about_page' || activeTab === 'home_offer' || activeTab === 'footer_settings' ||
              activeTab === 'institute_gallery' ||
              ['page_courses','page_bundles','page_consultations','page_instructors','page_contact','page_joinus','page_community'].includes(activeTab)) && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary>
                  <ContentHubTab
                    activeTab={activeTab}
                    notify={notify}
                    policyDrafts={policyDrafts}
                    setPolicyDrafts={setPolicyDrafts}
                    instituteGalleryImages={instituteGalleryImages}
                    instituteBranches={instituteBranches}
                  />
                </TabErrorBoundary>
              </Suspense>
            )}

            {activeTab === 'cert_pricing' && (
              <CertPricingTab certPricingMap={certPricingMap} saveCertPricingMap={saveCertPricingMap} notify={notify} />
            )}

            {activeTab === 'cert_requests' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>}>
              <CertRequestsTab
                notify={notify}
                courses={courses}
                subscribers={subscribers}
                updateSubscriber={updateSubscriber}
              />
              </Suspense>
            )}

            {(['courses','lectures','instructors','bundles','testimonials','discounts'].includes(activeTab)) && (
              <Suspense fallback={<div className="text-center py-8 text-gray-400">جاري التحميل...</div>}>
                <CoursesTab
                  notify={notify}
                  activeTab={activeTab}
                  setActiveTab={(tab) => setActiveTab(tab as TabKey)}
                  lectureCourseId={lectureCourseId}
                  setLectureCourseId={setLectureCourseId}
                  subscriberCourseFilter={subscriberCourseFilter}
                  setSubscriberCourseFilter={setSubscriberCourseFilter}
                  instituteGalleryImages={instituteGalleryImages}
                  policyDrafts={policyDrafts}
                  setPolicyDrafts={setPolicyDrafts}
                />
              </Suspense>
            )}

            {(activeTab === 'online_clients' || (activeTab === 'daqqi_clients' && (isDaqqiManager || isReceptionDaqqi || isAdmin))) && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>}>
              <OnlineClientsTab
                activeTab={activeTab}
                subscribers={subscribers}
                salesOwnSubscribers={salesOwnSubscribers}
                setSalesOwnSubscribers={setSalesOwnSubscribers}
                courses={courses}
                bundles={bundles}
                staffMembers={staffMembers}
                content={content}
                salesOwnDaqqiRounds={salesOwnDaqqiRounds ?? []}
                setSalesOwnDaqqiRounds={setSalesOwnDaqqiRounds}
                salesOwnLeads={salesOwnLeads ?? []}
                updateSubscriber={updateSubscriber}
                addSubscriber={addSubscriber}
                addLead={addLead}
                deleteSubscriber={deleteSubscriber}
                notify={notify}
                isDaqqiManager={isDaqqiManager}
                isReceptionDaqqi={isReceptionDaqqi}
                isAdmin={isAdmin}
                isOnlineManager={isOnlineManager}
                isNonAdminStaff={isNonAdminStaff}
                currentStaff={currentStaff ?? null}
                staffSelf={staffSelf}
                onlineTeamMembers={onlineTeamMembers}
                setSubPayRow={setSubPayRow}
                setSubPayDraft={setSubPayDraft}
                setSubContactRow={setSubContactRow}
                setSubContactDraft={setSubContactDraft}
                setSubInstRow={setSubInstRow}
                setSubInstDraft={setSubInstDraft}
                setSubWaRow={setSubWaRow}
              />
              </Suspense>
            )}

            {activeTab === 'refund_requests' && (isCollectionRole || isOnlineManager || isAdmin) && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary>
                  <RefundRequestsTab
                    notify={notify}
                    salesOwnSubscribers={salesOwnSubscribers}
                    setSalesOwnSubscribers={setSalesOwnSubscribers}
                  />
                </TabErrorBoundary>
              </Suspense>
            )}

            {activeTab === 'orders' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>}>
              <TabErrorBoundary>
              <OrdersTab
                isOnlineManager={isOnlineManager}
                isDaqqiManager={isDaqqiManager}
                isAdmin={isAdmin}
                notify={notify}
                courses={courses}
                bundles={bundles}
                salesOwnSubscribers={salesOwnSubscribers}
                updateSubscriber={updateSubscriber}
                effectiveOrders={effectiveOrders}
                ordersStats={ordersStats}
                currentStaff={currentStaff}
                authUser={authUser ?? null}
                content={content}
                updateOrderStatus={updateOrderStatus}
                addOrder={addOrder}
                deleteOrder={deleteOrder}
              />
              </TabErrorBoundary>
              </Suspense>
            )}


            {activeTab === 'financial' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <FinancialTab notify={notify} onNavigateTab={(tab) => setActiveTab(tab as TabKey)} />
              </Suspense>
            )}
            {activeTab === 'chart_of_accounts' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary><ChartOfAccountsTab notify={notify} /></TabErrorBoundary>
              </Suspense>
            )}
            {activeTab === 'branch_workspace' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary><BranchWorkspacesTab notify={notify} /></TabErrorBoundary>
              </Suspense>
            )}
            {activeTab === 'daqqi_accounting' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary><FinancialTab notify={notify} branchFilter="daqqi" onNavigateTab={(tab) => setActiveTab(tab as TabKey)} /></TabErrorBoundary>
              </Suspense>
            )}
            {activeTab === 'financial_reports' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary><FinancialReportsHub notify={notify} /></TabErrorBoundary>
              </Suspense>
            )}
            {activeTab === 'hr_hub' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary><HrHub notify={notify} /></TabErrorBoundary>
              </Suspense>
            )}
            {activeTab === 'analytics_hub' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary><AnalyticsHub notify={notify} /></TabErrorBoundary>
              </Suspense>
            )}
            {activeTab === 'branch_workspace' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary><BranchWorkspaceHub notify={notify} onNavigateTab={(tab) => setActiveTab(tab as TabKey)} /></TabErrorBoundary>
              </Suspense>
            )}

            {activeTab === 'contacts' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <ContactsTab />
              </Suspense>
            )}

            {activeTab === 'consultations' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"/></div>}><TabErrorBoundary><ConsultationCalendarTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'client' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"/></div>}><TabErrorBoundary><ClientDbTab notify={notify} onBook={handleClientDbBook} /></TabErrorBoundary></Suspense>)}

            {/* ═══════════════════════════════════════════════════════════════════
                NOTIFICATIONS TAB — إشعارات المشتركين (broadcast)
            ═══════════════════════════════════════════════════════════════════ */}

            {(onlineMgrFollowupOpen || onlineMgrNewEventsOpen) && (
              <Suspense fallback={null}>
                <OnlineManagerPanels
                  onlineMgrFollowupOpen={onlineMgrFollowupOpen}
                  setOnlineMgrFollowupOpen={setOnlineMgrFollowupOpen}
                  onlineMgrNewEventsOpen={onlineMgrNewEventsOpen}
                  setOnlineMgrNewEventsOpen={setOnlineMgrNewEventsOpen}
                  isNonAdminStaff={isNonAdminStaff}
                  salesOwnSubscribers={salesOwnSubscribers}
                  setActiveTab={setActiveTab}
                />
              </Suspense>
            )}

            {salesNotifOpen && (
              <Suspense fallback={null}>
                <SalesFollowupPanel
                  salesNotifOpen={salesNotifOpen}
                  setSalesNotifOpen={setSalesNotifOpen}
                  isNonAdminStaff={isNonAdminStaff}
                  isAdmin={isAdmin}
                  isSalesOnly={isSalesOnly}
                  currentStaff={currentStaff}
                  salesOwnLeads={salesOwnLeads}
                  setLeadsFollowupFilter={(f: string) => setLeadsFollowupFilter(f as 'all' | 'today' | 'overdue')}
                  setActiveTab={setActiveTab}
                />
              </Suspense>
            )}

            {activeTab === 'notifications' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <NotificationsAdminTab />
              </Suspense>
            )}

            {/* ═══ COMMUNITY TAB ═══ */}
            {activeTab === 'community' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary tabName="المجتمع">
                  <CommunityAdminTab notify={notify} />
                </TabErrorBoundary>
              </Suspense>
            )}

            {/* ═══ JOIN US TAB ═══ */}
            {activeTab === 'join_us' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <JoinUsAdminTab />
              </Suspense>
            )}

            {activeTab === 'activity' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" /></div>}>
                <ActivityTab isSalesOnly={isSalesOnly} />
              </Suspense>
            )}

            {/* ═══════════════════════════════════════════════════════════════════
                ASK AI TAB — اسأل AI عن أي شيء في السيستم
            ═══════════════════════════════════════════════════════════════════ */}
            {activeTab === 'ask_ai' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <AskAITab notify={notify} />
              </Suspense>
            )}

            {/* ══════════════════════════════════════════════════════════════
                AUTOMATION TAB — Workflow Builder (extracted to AutomationTab.tsx)
            ══════════════════════════════════════════════════════════════ */}
            {activeTab === 'automation' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <AutomationTab notify={notify} setActiveTab={(tab) => setActiveTab(tab as TabKey)} />
              </Suspense>
            )}
            {/* ══════════════════════════════════════════════════════════════
                MESSAGING AGENT TAB — Channel Configuration
            ══════════════════════════════════════════════════════════════ */}
            {activeTab === 'messaging_agent' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <MessagingAgentTab notify={notify} />
              </Suspense>
            )}

            {/* ══════════════════════════════════════════════════════════════
                ADMIN AI SETTINGS TAB
            ══════════════════════════════════════════════════════════════ */}
            {activeTab === 'admin_ai_settings' && (
              <Suspense fallback={<div className="text-center py-8 text-gray-400">جاري التحميل...</div>}>
                <AdminAiSettingsTab notify={notify} />
              </Suspense>
            )}

            {/* ══════════════════════════════════════════════════════════════
                POSTGRESQL MIGRATION TAB
            ══════════════════════════════════════════════════════════════ */}
            {activeTab === 'pg_migrate' && (isAdmin || hasPermission('manage_staff')) && (
              <Suspense fallback={<div className="p-8 text-center text-gray-400">جاري التحميل...</div>}>
                <PgMigrateTab />
              </Suspense>
            )}

            {/* ══════════════════════════════════════════════════════════════
                SERVER MONITOR TAB
            ══════════════════════════════════════════════════════════════ */}
            {activeTab === 'server_monitor' && isAdmin && (
              <Suspense fallback={<div className="p-8 text-center text-gray-400">جاري التحميل...</div>}>
                <TabErrorBoundary>
                  <ServerMonitorTab notify={notify} />
                </TabErrorBoundary>
              </Suspense>
            )}

            {/* ═══════════════════════════════════════════════════════════════
                LEADS TAB — العملاء المحتملون
            ═══════════════════════════════════════════════════════════════ */}
            {activeTab === 'leads' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary>
                  <LeadsTab
                    notify={notify}
                    staffSelf={staffSelf}
                    salesOwnLeads={salesOwnLeads}
                    salesOwnSubscribers={salesOwnSubscribers}
                    salesDataLoading={salesDataLoading}
                    fetchSalesData={fetchSalesData}
                    setActiveTab={(tab: string) => setActiveTab(tab as TabKey)}
                  />
                </TabErrorBoundary>
              </Suspense>
            )}

            {/* ═══════════════════════════════════════════════════════════════
                DAQQI SCHEDULE TAB — جدول الدقي
            ═══════════════════════════════════════════════════════════════ */}
            {activeTab === 'daqqi_attendance' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary>
                  <DaqqiAttendanceTab notify={(msg: string, t?: 'success' | 'error') => notify(t === 'error' ? 'error' : 'success', msg)} />
                </TabErrorBoundary>
              </Suspense>
            )}

            {activeTab === 'daqqi_schedule' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary>
                  <DaqqiScheduleTab
                    notify={notify}
                    subscribersOverride={isNonAdminStaff ? salesOwnSubscribers : undefined}
                    roundsOverride={isNonAdminStaff && salesOwnDaqqiRounds ? salesOwnDaqqiRounds : undefined}
                    hideCreateRound={isReceptionDaqqi}
                    requirePaymentApproval={isReceptionDaqqi}
                  />
                </TabErrorBoundary>
              </Suspense>
            )}

            {/* ═══════════════════════════════════════════════════════════════
                SALES HUB — مركز المبيعات الموحد
            ═══════════════════════════════════════════════════════════════ */}
            {activeTab === 'sales_hub' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary>
                  <SalesHubTab
                    notify={notify}
                    salesTargets={leadsSalesTargets}
                    onOpenStaffProfile={(staffId) => {
                      setStaffProfileModalId(staffId);
                    }}
                  />
                </TabErrorBoundary>
              </Suspense>
            )}

            {/* ═══════════════════════════════════════════════════════════════
                MARKETING HUB — مركز التسويق
            ═══════════════════════════════════════════════════════════════ */}
            {activeTab === 'marketing_hub' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary>
                  <MarketingHubTab notify={notify} />
                </TabErrorBoundary>
              </Suspense>
            )}

            {/* ═══════════════════════════════════════════════════════════════
                ONLINE HUB — مركز الأونلاين والتحصيل
            ═══════════════════════════════════════════════════════════════ */}
            {activeTab === 'online_hub' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary>
                  <OnlineTeamTab notify={notify} />
                </TabErrorBoundary>
              </Suspense>
            )}

            {/* ════ QUIZZES TAB ════ */}
            {activeTab === 'quizzes' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <QuizzesTab notify={notify} />
              </Suspense>
            )}

            {/* ════ LIVE STREAMS TAB ════ */}
            {activeTab === 'staff_settings' && (isSalesOnly || isCollectionRole || isReceptionDaqqi) && currentStaff && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary>
                  <StaffSettingsTab notify={notify} currentStaff={currentStaff} salesOwnSubscribers={salesOwnSubscribers} />
                </TabErrorBoundary>
              </Suspense>
            )}

            {activeTab === 'live_streams' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <LiveStreamsTab notify={notify} />
              </Suspense>
            )}

            {activeTab === 'staff_applications' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><JoinUsAdminTab /></TabErrorBoundary></Suspense>)}
            {activeTab === 'lecturer_applications' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><JoinUsAdminTab /></TabErrorBoundary></Suspense>)}
            {/* saas_settings + rbac_settings consolidated into the unified Settings page (legacy URLs still resolve here) */}
            {activeTab === 'saas_settings' && isAdmin && (<div className="mb-5"><Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><TenantsAdminTab notify={notify} /></TabErrorBoundary></Suspense></div>)}
            {['system_settings','saas_settings','rbac_settings'].includes(activeTab) && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><SystemSettingsTab notify={notify} isAdmin={isAdmin} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'staff_performance' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><StaffPerformanceTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'retention' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><RetentionTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'cohort_analysis' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><CohortAnalysisTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'kpi_dashboard' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><KpiDashboardTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'forecast' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><ForecastTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'sales_team' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><SalesTeamTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'sales_reports' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><SalesReportsTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'sales_goals' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><SalesGoalsTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'online_team' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><OnlineTeamMgmtTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'subscriptions' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><SubscriptionsTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'lead_scoring' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><LeadScoringTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'consultation_calendar' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><ConsultationCalendarTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'expense_analytics' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><ExpenseAnalyticsTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'revenue_sources' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><RevenueSourcesTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'my_hr' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><MyHrTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'automation_dashboard' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><AutomationDashboardTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'ip_whitelist' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><IpWhitelistTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'sms_settings' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><SmsSettingsTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'notif_inbox' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><NotifInboxMgmtTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'email_campaigns' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><EmailCampaignsTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'sms_campaigns' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><SmsCampaignsTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'drip_campaigns' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><DripCampaignsTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'staff_home' && (
              currentStaff ? (
                <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}>
                  <TabErrorBoundary>
                    <StaffHomeTab
                      staff={currentStaff}
                      leads={isNonAdminStaff ? salesOwnLeads : leads}
                      subscribers={isNonAdminStaff ? salesOwnSubscribers : subscribers}
                      notify={notify}
                      onNavigate={(tab) => setActiveTabState(tab as TabKey)}
                    />
                  </TabErrorBoundary>
                </Suspense>
              ) : (
                <div className="bg-white border border-gray-200 rounded-2xl p-16 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-gray-100 grid place-items-center mx-auto mb-4"><User size={28} className="text-gray-300" /></div>
                  <h3 className="text-lg font-extrabold text-gray-700 mb-2">البوابة الشخصية للموظفين</h3>
                  <p className="text-gray-400 text-sm">هذه الصفحة مخصّصة لحسابات الموظفين. حسابك (مدير) لا يملك ملفاً وظيفياً مرتبطاً.</p>
                </div>
              )
            )}

            {/* ── Restored tab renders (were imported in lazyTabs + present in menu but missing here → blank pages) ── */}
            {activeTab === 'hr' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><HrTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'tickets' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><TicketsTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'support_inbox' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><SupportInboxTab onOpen={(t) => setActiveTab(t as typeof activeTab)} notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'waitlist' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><WaitlistTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'tasks_board' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><TasksBoardTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'nps_dashboard' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><NpsDashboardTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'security_dashboard' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><SecurityDashboardTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'balance_sheet' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><BalanceSheetTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'cash_flow' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><CashFlowTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'revenue_forecast' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><RevenueForecastTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'installment_plans' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><InstallmentPlansTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'recurring_expenses' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><RecurringExpensesTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'budget_tracker' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><BudgetTrackerTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'daqqi_team' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><DaqqiTeamTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'followup_reminders' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><FollowupRemindersTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'webhooks' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><WebhooksTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {/* daqqi_stats → reuse the Daqqi attendance + monthly-stats view */}
            {activeTab === 'daqqi_stats' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><DaqqiAttendanceTab notify={(msg: string, t?: 'success' | 'error') => notify(t === 'error' ? 'error' : 'success', msg)} /></TabErrorBoundary></Suspense>)}
            {/* staff_management → reuse the all-staff performance/overview view */}
            {activeTab === 'staff_management' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><StaffPerformanceTab notify={notify} /></TabErrorBoundary></Suspense>)}

            {/* ── Placeholder tabs (قيد الإنشاء) — no dedicated component yet ── */}
            {([] as TabKey[]).includes(activeTab) && (
              <div className="bg-white border border-gray-200 rounded-2xl p-16 text-center">
                <div className="w-16 h-16 rounded-2xl bg-gray-100 grid place-items-center mx-auto mb-4">
                  <Settings2 size={28} className="text-gray-300" />
                </div>
                <h3 className="text-lg font-extrabold text-gray-700 mb-2">قيد الإنشاء</h3>
                <p className="text-gray-400 text-sm">هذا القسم سيكون متاحاً قريباً</p>
              </div>
            )}

  </></TabErrorBoundary>
  );
};

export default DashboardTabRouter;
