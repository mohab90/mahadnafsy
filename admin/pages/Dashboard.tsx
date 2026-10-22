import React, { Suspense } from 'react';
import { CoursesTab } from './dashboard/lazyTabs';
import { AdminBootstrapLoading, StaffPermissionsLoading } from './dashboard/DashboardGuards';
import { DashboardTabContainer } from './dashboard/DashboardTabContainer';
import { DashboardNavigation } from './dashboard/DashboardNavigation';
import { DashboardPaymentOverlays } from './dashboard/DashboardPaymentOverlays';
import { DashboardStandaloneTabs } from './dashboard/DashboardStandaloneTabs';
import { type TabKey } from './dashboard/navigation';
import { aboutPageFields, homeOfferFields, policySections } from './dashboard/contentFields';
import StaffAnnouncementPopup from '../components/StaffAnnouncementPopup';
import { contentHubRouteTabs, directContentTabs, growthOpsTabs, saasOpsTabs } from './dashboard/dashboardTabGroups';
import { DashboardClientTabs, DashboardCommunityAdminPanel, DashboardContentHubRoutes, DashboardCustomerServiceTabs, DashboardDirectContentRoutes, DashboardFinanceTabs, DashboardGrowthOpsTabs, DashboardOnlineManagerPanels, DashboardQuickBooking, DashboardSaasOpsTabs, MyProfilePage, OverviewTab, OwnerProfilePage } from './dashboard/lazyDashboardComponents';
import { isProfileTab } from './dashboard/my-profile/profileTabs';
import { PhysicalBranchProvider } from '../lib/physicalBranch';
import { useDashboardModel } from './dashboard/shell/useDashboardModel';
const LeadSalesNotificationsPanel = React.lazy(() => import('./dashboard/tabs/leads/LeadSalesNotificationsPanel').then(m => ({ default: m.LeadSalesNotificationsPanel })));

// The shell: the menu, the screen the tab names and the overlays drawn over every screen. Its state and wiring —
// the tab, the lists each screen loads, the badges, the payment handlers — are useDashboardModel's
// (dashboard/shell/useDashboardModel.tsx).
const Dashboard: React.FC = () => {
  const {
    courses, bundles, therapists, subscribers, leads, siteDaqqiRounds, staffMembers, consultations, communityPosts,
    communityLibraryItems, communityVideos, communityEvents, content, isAdmin, addSubscriber, updateSubscriber,
    deleteSubscriber, addCommunityPost, updateCommunityPost, deleteCommunityPost, addCommunityLibraryItem,
    updateCommunityLibraryItem, deleteCommunityLibraryItem, addCommunityVideo, updateCommunityVideo,
    deleteCommunityVideo, addCommunityEvent, updateCommunityEvent, deleteCommunityEvent, updateOrderStatus,
    reloadOrders, reloadLeads, reloadSubscribers, deleteOrder, setContentValue, setContentValues, addContentKey,
    removeContentKey, authUser, remoteReady, currentStaff, staffSelf, staffSelfLoading, searchText, setSearchText,
    newContentKey, setNewContentKey, newContentValue, setNewContentValue, contentEdits, setContentEdits,
    policyDrafts, setPolicyDrafts, instituteGalleryUrlInput, setInstituteGalleryUrlInput, instituteGalleryUploadRef,
    subscriberCourseFilter, setSubscriberCourseFilter, refundActionSaving, setRefundActionSaving, subPayRow,
    setSubPayRow, subPayDraft, setSubPayDraft, salesNotifOpen, setSalesNotifOpen, onlineMgrFollowupOpen,
    setOnlineMgrFollowupOpen, onlineMgrNewEventsOpen, setOnlineMgrNewEventsOpen, quickBookOpen, setQuickBookOpen,
    quickBookSearch, setQuickBookSearch, leadPayRow, setLeadPayRow, leadPayDraft, setLeadPayDraft, leadsSalesTargets,
    setLeadsFollowupFilter, notifRows, setNotifRows, notifUnread, setNotifUnread, notifOpen, setNotifOpen, notifRef,
    notifError, refreshNotifs, orderSearch, setOrderSearch, orderStatusFilter, setOrderStatusFilter, orderTypeFilter,
    setOrderTypeFilter, orderMethodFilter, setOrderMethodFilter, orderDateFrom, setOrderDateFrom, orderDateTo,
    setOrderDateTo, orderReviewTab, setOrderReviewTab, orderStaffFilter, setOrderStaffFilter, omOrdReviewTab,
    setOmOrdReviewTab, showAddTransfer, setShowAddTransfer, linkTransferModal, setLinkTransferModal, linkOrderModal,
    setLinkOrderModal, isSalesOnly, isCollectionRole, isReceptionDaqqi, isSupport, isDaqqiManager, isOnlineManager,
    isSalesCollectionManager, salesOwnDaqqiRounds, setSalesOwnDaqqiRounds, onlineTeamMembers, salesDataLoading,
    fetchSalesData, staffNotifBadge, onlineMgrFollowupBadge, onlineMgrNewEventsBadge, branchQueryFilter,
    inboxUnreadCount, instituteBranches, notify, lectureCourseId, setLectureCourseId, daqqiSubSearch,
    setDaqqiSubSearch, daqqiAccDateFrom, setDaqqiAccDateFrom, daqqiAccDateTo, setDaqqiAccDateTo, subCsDistributing,
    setSubCsDistributing, daqqiOldDistribPlan, setDaqqiOldDistribPlan, daqqiOldDistributing, setDaqqiOldDistributing,
    navigate, activeTabState, setActiveTabState, pendingProofsCount, onlineMgrAcademyOpen, setOnlineMgrAcademyOpen,
    activeDropdownGroup, setActiveDropdownGroup, dropdownRect, setDropdownRect, onlineUsers, kpiModal, setKpiModal,
    physicalBranch, setActiveTab, navigateToTab, activeTab, communityAdminTab, setCommunityAdminTab, filteredContent,
    isNonAdminStaff, onlineManagerSummary, handleClientDbBook, effectiveOrders, filteredOrders, ordersStats,
    hasPermission, canOpenChannelTab, staffNavTab, ownBranch, visibleMenuGroups, overviewStats,
    exportFilteredOrdersCsv, contentHubSubTab, setContentHubSubTab, handleSubPayment, handleLeadPayment,
  } = useDashboardModel();

  // -- Quick installment plan creator from Dashboard table ------------------
  // Show loading spinner while fetching staff permissions to avoid flash of AccessDenied
  if (!isAdmin && authUser && staffSelfLoading) {
    return <StaffPermissionsLoading />;
  }

  // Show loading overlay while admin CRM bootstrap (Batch 1) is in progress
  if (isAdmin && !remoteReady) {
    return <AdminBootstrapLoading />;
  }

  return (
    <>
    {/* pb-28 on phones: the «حجز / دفعة» button is fixed at bottom-6 and 44px
        tall, so it owns the bottom 68px of the viewport. With py-6 alone it sat
        over the last row of every screen — on العملاء المحتملين it covered the
        pagination, so «السابق» and the page numbers could not be tapped at all.
        Restored to the original padding from md up, where the button clears the
        content column. */}
    {/* Keyed by branch: the same screen at the other branch starts clean. */}
    <PhysicalBranchProvider key={physicalBranch} branch={physicalBranch}>
    <div className="min-h-screen bg-gradient-to-br from-gray-100 via-white to-primary-50/30 pt-2 pb-28 md:pt-3 md:pb-8">
      <div className="container mx-auto px-4">
        <DashboardNavigation
          isSalesOnly={isSalesOnly}
          isCollectionRole={isCollectionRole}
          isReceptionDaqqi={isReceptionDaqqi}
          isSupport={isSupport}
          isOnlineManager={isOnlineManager}
          isDaqqiManager={isDaqqiManager}
          isSalesCollectionManager={isSalesCollectionManager}
          isAdmin={isAdmin}
          visibleMenuGroups={visibleMenuGroups}
          activeTab={ownBranch === 'TAGAMOA' ? activeTab : activeTabState}
          setActiveTab={staffNavTab}
          activeDropdownGroup={activeDropdownGroup}
          setActiveDropdownGroup={setActiveDropdownGroup}
          dropdownRect={dropdownRect}
          setDropdownRect={setDropdownRect}
          notifRef={notifRef}
          notifOpen={notifOpen}
          setNotifOpen={setNotifOpen}
          notifRows={notifRows}
          setNotifRows={setNotifRows}
          notifUnread={notifUnread}
          setNotifUnread={setNotifUnread}
          notifError={notifError}
          refreshNotifs={refreshNotifs}
          pendingProofsCount={pendingProofsCount}
          inboxUnreadCount={inboxUnreadCount}
          currentStaff={currentStaff}
          salesDataLoading={salesDataLoading}
          staffNotifBadge={staffNotifBadge}
          setSalesNotifOpen={setSalesNotifOpen}
          onlineMgrAcademyOpen={onlineMgrAcademyOpen}
          setOnlineMgrAcademyOpen={setOnlineMgrAcademyOpen}
          setOnlineMgrFollowupOpen={setOnlineMgrFollowupOpen}
          onlineMgrFollowupBadge={onlineMgrFollowupBadge}
          setOnlineMgrNewEventsOpen={setOnlineMgrNewEventsOpen}
          onlineMgrNewEventsBadge={onlineMgrNewEventsBadge}
          notify={notify}
        />

        <div className="grid grid-cols-1 gap-6 items-start">
          <section className="space-y-6 min-w-0 overflow-hidden">
            <DashboardTabContainer
              activeTab={activeTab}
              isAdmin={isAdmin}
              hasPermission={hasPermission}
              canOpenTab={canOpenChannelTab}
            >

            {activeTab === 'overview' && (
              <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>}>
                <OverviewTab
                  overviewStats={overviewStats}
                  isSalesOnly={isSalesOnly}
                  currentStaff={currentStaff ?? null}
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
                  onlineTeamMembers={onlineTeamMembers}
                  onlineUsers={onlineUsers}
                  kpiModal={kpiModal}
                  setKpiModal={setKpiModal}
                  notify={notify}
                  setActiveTab={navigateToTab}
                  navigate={navigate}
                />
              </Suspense>
            )}

            <DashboardStandaloneTabs
              activeTab={activeTab}
              isSalesOnly={isSalesOnly}
              notify={notify}
            />
            {/* The page editors also open inside صفحات الموقع (ContentHubGenericPageEditor
                reads contentHubSubTab there), but this was mounted only for their
                standalone keys — so the ten page tabs of the hub drew nothing. */}
            {(directContentTabs.has(activeTab) || (activeTab === 'content_hub' && contentHubSubTab.startsWith('page_'))) && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" /></div>}>
                <DashboardDirectContentRoutes
                  activeTab={activeTab}
                  contentHubSubTab={contentHubSubTab}
                  content={content}
                  policyDrafts={policyDrafts}
                  setPolicyDrafts={setPolicyDrafts}
                  setContentValue={setContentValue}
                  setContentValues={setContentValues}
                  setActiveTab={navigateToTab}
                  setContentHubSubTab={setContentHubSubTab}
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
                  courses={courses}
                  instituteGalleryUploadRef={instituteGalleryUploadRef}
                  instituteGalleryUrlInput={instituteGalleryUrlInput}
                  setInstituteGalleryUrlInput={setInstituteGalleryUrlInput}
                  instituteBranches={instituteBranches}
                  canEditSettings={isAdmin || ['admin', 'manager'].includes(String(currentStaff?.role || '').toLowerCase())}
                />
              </Suspense>
            )}

            {(['courses','lectures','instructors','bundles','testimonials','discounts'].includes(activeTab)) && (
              <Suspense fallback={<div className="text-center py-8 text-gray-400">جاري التحميل...</div>}>
                <CoursesTab
                  notify={notify}
                  activeTab={activeTab}
                  setActiveTab={setActiveTab}
                  lectureCourseId={lectureCourseId}
                  setLectureCourseId={setLectureCourseId}
                  subscriberCourseFilter={subscriberCourseFilter}
                  setSubscriberCourseFilter={setSubscriberCourseFilter}
                  policyDrafts={policyDrafts}
                  setPolicyDrafts={setPolicyDrafts}
                />
              </Suspense>
            )}

            {(activeTab === 'online_clients' || activeTab === 'daqqi_clients') && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" /></div>}>
                <DashboardClientTabs
                  activeTab={activeTab}
                  canViewDaqqiClients={isDaqqiManager || isReceptionDaqqi || isSupport || isAdmin}
                  onlineClientsProps={{
                    canDeleteSubscriber: hasPermission('delete_subscribers'),
                    activeTab,
                    courses,
                    bundles,
                    staffMembers,
                    content,
                    // The context's rounds, not the staff copy: that one is null for an admin
                    // (every client read «غير مسكن») and, for the desk, only changed on the
                    // next poll — a client housed a moment ago did not show as housed.
                    salesOwnDaqqiRounds: siteDaqqiRounds,
                    setSalesOwnDaqqiRounds,
                    updateSubscriber,
                    addSubscriber,
                    reloadSubscribers,
                    reloadLeads,
                    deleteSubscriber,
                    notify,
                    isDaqqiManager,
                    isReceptionDaqqi,
                    isAdmin,
                    isOnlineManager,
                    isNonAdminStaff,
                    currentStaff: currentStaff ?? null,
                    staffSelf,
                    onlineTeamMembers,
                    subCsDistributing,
                    setSubCsDistributing,
                    daqqiOldDistribPlan,
                    setDaqqiOldDistribPlan,
                    daqqiOldDistributing,
                    setDaqqiOldDistributing,
                    setSubPayRow,
                    setSubPayDraft,
                    branchFilter: branchQueryFilter,
                  }}
                />
              </Suspense>
            )}

            {(['refund_requests', 'contacts', 'join_us'] as TabKey[]).includes(activeTab) && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" /></div>}>
                <DashboardCustomerServiceTabs
                  activeTab={activeTab}
                  isCollectionRole={isCollectionRole}
                  isSupport={isSupport}
                  isOnlineManager={isOnlineManager}
                  isAdmin={isAdmin}
                  courses={courses}
                  bundles={bundles}
                  updateSubscriber={updateSubscriber}
                  notify={notify}
                  refundActionSaving={refundActionSaving}
                  setRefundActionSaving={setRefundActionSaving}
                />
              </Suspense>
            )}

            {(['orders', 'financial', 'client'] as TabKey[]).includes(activeTab) && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" /></div>}>
                <DashboardFinanceTabs
                  activeTab={activeTab}
                  notify={notify}
                  branchFilter={branchQueryFilter || undefined}
                  onClientBook={handleClientDbBook}
                  ordersProps={{
                    isOnlineManager,
                    isDaqqiManager,
                    isAdmin,
                    canManageFinancial: hasPermission('manage_financial'),
                    notify,
                    courses,
                    bundles,
                    daqqiSubSearch,
                    setDaqqiSubSearch,
                    daqqiAccDateFrom,
                    setDaqqiAccDateFrom,
                    daqqiAccDateTo,
                    setDaqqiAccDateTo,
                    omOrdReviewTab,
                    setOmOrdReviewTab,
                    effectiveOrders,
                    filteredOrders,
                    ordersStats,
                    orderSearch,
                    setOrderSearch,
                    orderStatusFilter,
                    setOrderStatusFilter,
                    orderTypeFilter,
                    setOrderTypeFilter,
                    orderMethodFilter,
                    setOrderMethodFilter,
                    orderDateFrom,
                    setOrderDateFrom,
                    orderDateTo,
                    setOrderDateTo,
                    orderStaffFilter,
                    setOrderStaffFilter,
                    orderReviewTab,
                    setOrderReviewTab,
                    showAddTransfer,
                    setShowAddTransfer,
                    linkTransferModal,
                    setLinkTransferModal,
                    linkOrderModal,
                    setLinkOrderModal,
                    currentStaff,
                    authUser: authUser ?? null,
                    content,
                    updateOrderStatus,
                    reloadOrders,
                    reloadSubscribers,
                    deleteOrder,
                    exportFilteredOrdersCsv,
                  }}
                />
              </Suspense>
            )}

            {/* -------------------------------------------------------------------
                NOTIFICATIONS TAB — إشعارات المشتركين (broadcast)
            ------------------------------------------------------------------- */}

            {(onlineMgrFollowupOpen || onlineMgrNewEventsOpen) && (
              <Suspense fallback={null}>
                <DashboardOnlineManagerPanels
                  followupOpen={onlineMgrFollowupOpen}
                  newEventsOpen={onlineMgrNewEventsOpen}
                  summary={onlineManagerSummary}
                  setFollowupOpen={setOnlineMgrFollowupOpen}
                  setNewEventsOpen={setOnlineMgrNewEventsOpen}
                  setActiveTab={setActiveTab}
                />
              </Suspense>
            )}
            {salesNotifOpen && (
              <Suspense fallback={null}>
                {/* The same drawer the leads tab opens. There were two, and they
                    disagreed about whose follow-ups you see. */}
                <LeadSalesNotificationsPanel
                  open={salesNotifOpen}
                  isSalesOnly={isSalesOnly}
                  onClose={() => setSalesNotifOpen(false)}
                  onShowOverdue={() => { setLeadsFollowupFilter('overdue'); setSalesNotifOpen(false); setActiveTab('leads'); }}
                  onShowToday={() => { setLeadsFollowupFilter('today'); setSalesNotifOpen(false); setActiveTab('leads'); }}
                />
              </Suspense>
            )}
            {activeTab === 'community' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>}>
                <DashboardCommunityAdminPanel
                  activeTab={activeTab}
                  communityAdminTab={communityAdminTab}
                  setCommunityAdminTab={setCommunityAdminTab}
                  communityPosts={communityPosts}
                  communityLibraryItems={communityLibraryItems}
                  communityVideos={communityVideos}
                  communityEvents={communityEvents}
                  updateCommunityPost={updateCommunityPost}
                  deleteCommunityPost={deleteCommunityPost}
                  addCommunityPost={addCommunityPost}
                  addCommunityLibraryItem={addCommunityLibraryItem}
                  updateCommunityLibraryItem={updateCommunityLibraryItem}
                  deleteCommunityLibraryItem={deleteCommunityLibraryItem}
                  addCommunityVideo={addCommunityVideo}
                  updateCommunityVideo={updateCommunityVideo}
                  deleteCommunityVideo={deleteCommunityVideo}
                  addCommunityEvent={addCommunityEvent}
                  updateCommunityEvent={updateCommunityEvent}
                  deleteCommunityEvent={deleteCommunityEvent}
                />
              </Suspense>
            )}

            {saasOpsTabs.has(activeTab) && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" /></div>}>
                <DashboardSaasOpsTabs
                  activeTab={activeTab}
                  notify={notify}
                  isAdmin={isAdmin}
                  hasPermission={hasPermission}
                  setActiveTab={setActiveTab}
                />
              </Suspense>
            )}

            {growthOpsTabs.has(activeTab) && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" /></div>}>
                <DashboardGrowthOpsTabs
                  activeTab={activeTab}
                  notify={notify}
                  staffSelf={staffSelf}
                  salesDataLoading={salesDataLoading}
                  fetchSalesData={fetchSalesData}
                  setActiveTab={navigateToTab}
                  branchFilter={branchQueryFilter}
                  salesOwnDaqqiRounds={salesOwnDaqqiRounds}
                  isReceptionDaqqi={isReceptionDaqqi}
                  isSupport={isSupport}
                  leadsSalesTargets={leadsSalesTargets}
                />
              </Suspense>
            )}

            {contentHubRouteTabs.has(activeTab) && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" /></div>}>
                <DashboardContentHubRoutes
                  activeTab={activeTab}
                  contentHubSubTab={contentHubSubTab}
                  setContentHubSubTab={setContentHubSubTab}
                  setActiveTab={navigateToTab}
                  content={content}
                  policyDrafts={policyDrafts}
                  setPolicyDrafts={setPolicyDrafts}
                  setContentValue={setContentValue}
                  setContentValues={setContentValues}
                  notify={notify}
                  instituteBranches={instituteBranches}
                  homeOfferFields={homeOfferFields}
                  aboutPageFields={aboutPageFields}
                  policySections={policySections}
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
              </Suspense>
            )}

            {/* ---- ملفي: the person signed in — one page, every account. ---- */}
            {isProfileTab(activeTab) && currentStaff && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" /></div>}>
                <MyProfilePage
                  activeTab={activeTab}
                  staff={currentStaff}
                  notify={notify}
                  onNavigate={setActiveTabState}
                />
              </Suspense>
            )}

            {/* The owner account has a users row and no staff record: its own
                page, with the password it could not change anywhere. */}
            {isProfileTab(activeTab) && !currentStaff && (
              <Suspense fallback={null}>
                <OwnerProfilePage
                  name={authUser?.displayName || ''}
                  email={authUser?.email || ''}
                  isOwner={isAdmin}
                  notify={notify}
                  onNavigate={setActiveTabState}
                />
              </Suspense>
            )}

            </DashboardTabContainer>
          </section>
        </div>
      </div>

      {/* On every account: «لازم يكون ظاهر لكل الحسابات». Every role holds
          manage_payments for it (api/constants/permissions.js), so the save is
          not refused; a payment from someone who cannot approve waits PENDING. */}
      <Suspense fallback={null}>
        <DashboardQuickBooking
          open={quickBookOpen}
          search={quickBookSearch}
          leads={leads}
          subscribers={subscribers}
          setOpen={setQuickBookOpen}
          setSearch={setQuickBookSearch}
          setLeadPayRow={setLeadPayRow}
          setLeadPayDraft={setLeadPayDraft}
          setSubPayRow={setSubPayRow}
          setSubPayDraft={setSubPayDraft}
          navigate={navigate}
        />
      </Suspense>

      {/* A message from the administration, over whatever the employee is doing (components/StaffAnnouncementPopup.tsx). */}
      <StaffAnnouncementPopup />
    </div>
    <DashboardPaymentOverlays
      lead={leadPayRow}
      leadDraft={leadPayDraft}
      setLeadDraft={setLeadPayDraft}
      submitLeadPayment={handleLeadPayment}
      closeLeadPayment={() => setLeadPayRow(null)}
      subscriber={subPayRow}
      subscriberDraft={subPayDraft}
      setSubscriberDraft={setSubPayDraft}
      submitSubscriberPayment={handleSubPayment}
      closeSubscriberPayment={() => setSubPayRow(null)}
      branchOptions={instituteBranches.map(b => ({ id: b.id, label: b.label }))}
      instituteName={content['institute.name'] || 'معهد الدراسات النفسية'}
      requireSubscriberApproval={isReceptionDaqqi}
      lockPrice={isCollectionRole}
    />
    </PhysicalBranchProvider>
    </>
  );
};

export default Dashboard;
