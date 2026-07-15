import React from 'react';

export const OverviewTab = React.lazy(() => import('./tabs/OverviewTab'));
export const PaymentModal = React.lazy(() => import('../../components/PaymentModal'));
export const DashboardClientTabs = React.lazy(() => import('./DashboardClientTabs').then(module => ({ default: module.DashboardClientTabs })));
export const DashboardCommunityAdminPanel = React.lazy(() => import('./DashboardCommunityAdminPanel').then(module => ({ default: module.DashboardCommunityAdminPanel })));
export const DashboardCustomerServiceTabs = React.lazy(() => import('./DashboardCustomerServiceTabs').then(module => ({ default: module.DashboardCustomerServiceTabs })));
export const DashboardFinanceTabs = React.lazy(() => import('./DashboardFinanceTabs').then(module => ({ default: module.DashboardFinanceTabs })));
export const DashboardContentHubRoutes = React.lazy(() => import('./DashboardContentHubRoutes').then(module => ({ default: module.DashboardContentHubRoutes })));
export const DashboardDirectContentRoutes = React.lazy(() => import('./DashboardDirectContentRoutes').then(module => ({ default: module.DashboardDirectContentRoutes })));
export const DashboardGrowthOpsTabs = React.lazy(() => import('./DashboardGrowthOpsTabs').then(module => ({ default: module.DashboardGrowthOpsTabs })));
export const DashboardMonitorPanel = React.lazy(() => import('./DashboardMonitorPanel').then(module => ({ default: module.DashboardMonitorPanel })));
export const DashboardOnlineManagerPanels = React.lazy(() => import('./DashboardOnlineManagerPanels').then(module => ({ default: module.DashboardOnlineManagerPanels })));
export const DashboardQuickBooking = React.lazy(() => import('./DashboardQuickBooking').then(module => ({ default: module.DashboardQuickBooking })));
export const DashboardSaasOpsTabs = React.lazy(() => import('./DashboardSaasOpsTabs').then(module => ({ default: module.DashboardSaasOpsTabs })));
export const DashboardSalesFollowupPanel = React.lazy(() => import('./DashboardSalesFollowupPanel').then(module => ({ default: module.DashboardSalesFollowupPanel })));
export const DashboardStaffSettingsPanel = React.lazy(() => import('./DashboardStaffSettingsPanel').then(module => ({ default: module.DashboardStaffSettingsPanel })));
export const DashboardStaffTabs = React.lazy(() => import('./DashboardStaffTabs').then(module => ({ default: module.DashboardStaffTabs })));
