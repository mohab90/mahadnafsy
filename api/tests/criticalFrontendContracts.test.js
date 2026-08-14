'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('client and admin registration wait for the real auth API before reporting success', () => {
  for (const relativePath of ['client/pages/Auth.tsx', 'admin/pages/Auth.tsx']) {
    const source = read(relativePath);
    assert.match(source, /else\s*\{[\s\S]{0,900}await mysqlAuth\.register\(/);
    assert.match(source, /await mysqlAuth\.register\([\s\S]{0,700}setNotice\(\{ type: 'success'/);
  }
});

test('client and admin TOTP forms verify the pending session before refreshing auth', () => {
  for (const relativePath of ['client/pages/Auth.tsx', 'admin/pages/Auth.tsx']) {
    const source = read(relativePath);
    assert.match(source, /await mysqlAuth\.verify2fa\(twoFaTempToken,\s*twoFaCode\)/);
    // The session is the httpOnly cookie the API sets. Stashing a token in
    // localStorage is the exact thing the cookie migration removed, so assert
    // it stays gone — this guard used to require the opposite.
    assert.doesNotMatch(source, /localStorage\.setItem\('mahad-token'/);
    assert.match(source, /refreshAuth\(\)/);
  }
  for (const relativePath of ['client/lib/mysqlapi.ts', 'admin/lib/mysqlapi.ts']) {
    assert.match(read(relativePath), /\/auth\/2fa\/verify/);
  }
});

test('checkout does not gate on a token the cookie migration stopped writing', () => {
  const checkout = read('client/pages/Checkout.tsx');
  // Logins write no localStorage token any more, so this threw "سجّل الدخول
  // أولاً" for every signed-in customer and no order could be created at all.
  // The real gate is `authUser` (and requireAuth on the route).
  assert.doesNotMatch(checkout, /if \(!token\) throw new Error/);
  assert.match(checkout, /if \(requiresLogin && authUser === null\)/);
  // The API can only see the cookie if the request actually sends it.
  assert.match(checkout, /'\/api\/public\/checkout-intent',\s*\{[\s\S]{0,80}credentials: 'include'/);
});

test('checkout survives a customer who has no email address', () => {
  const checkout = read('client/pages/Checkout.tsx');
  // subscribers.email is nullable and WhatsApp-only clients have none. An
  // unguarded .toLowerCase() on it crashed the whole page to the error
  // boundary — for exactly the customers the API goes out of its way to serve.
  assert.doesNotMatch(checkout, /s\.email\.toLowerCase\(\)/);
  assert.match(checkout, /subscribers\.find\(s => s\.id === mySubscriberId\)/);
});

test('the WhatsApp sign-in step reports its own outcome', () => {
  const auth = read('client/pages/Auth.tsx');
  const verifyForm = auth.slice(
    auth.indexOf('onSubmit={handleWaVerify}'),
    auth.indexOf('تغيير الرقم')
  );
  assert.notEqual(verifyForm, '', 'could not locate the WhatsApp verify form');
  // Without a notice block the step failed in total silence: the API accepted
  // the code, the handler threw, the catch swallowed it, and nothing on screen
  // changed while the customer was in fact already signed in.
  assert.match(verifyForm, /\{notice && \(/);
  // `result` must be bound before it is read — this shipped as a ReferenceError
  // because the build strips types and never type-checks.
  assert.match(auth, /const result = await mysqlAuth\.verifyWaOtp\(/);
});

test('contact success is shown only after the public API persists the message', () => {
  const page = read('client/pages/Contact.tsx');
  const context = read('client/context/SiteDataContext.tsx');
  assert.match(page, /await addContactMessage\(/);
  assert.match(page, /catch\s*\{[\s\S]{0,300}لم يتم حفظها/);
  assert.match(context, /const addContactMessage = async[\s\S]{0,250}await mysqlForms\.submitContact/);
});

test('push ownership and payment creation permission are tenant and finance safe', () => {
  const push = read('api/routes/push.js');
  const payments = read('api/routes/subscriber-payments.js');
  const migration = read('api/migrations/104_v25_push_subscription_tenant_identity.sql');
  // Ownership resolution moved to lib/subscriberIdentity.js so push, loyalty and
  // every /api/me/* route resolve the client the same way — including clients
  // who sign in by WhatsApp number and have no email at all.
  assert.match(push, /require\('\.\.\/lib\/subscriberIdentity'\)/);
  assert.match(push, /resolveSubscriberId\(/);
  assert.match(push, /WHERE tenant_id = \? AND is_active = 1/);
  assert.match(push, /SET is_active = 0 WHERE tenant_id = \? AND endpoint_hash = \?/);
  assert.match(payments, /subscriber-payments'[\s\S]{0,160}requirePermission\('manage_payments'\)/);
  assert.match(migration, /uq_push_tenant_endpoint \(tenant_id, endpoint_hash\)/);
});

test('subscriber status, certificate counts and sales goals use server-owned truth', () => {
  const clients = read('admin/pages/dashboard/tabs/OnlineClientsTab.tsx');
  const dashboard = read('client/pages/UserDashboard.tsx');
  const goals = read('admin/pages/dashboard/tabs/SalesGoalsTab.tsx');
  assert.match(clients, /s\.isActive === false/);
  assert.match(dashboard, /extraCertificateRequests[\s\S]{0,180}\+ completions\.length/);
  assert.doesNotMatch(dashboard, /earnedCertsCount[\s\S]{0,500}lectureProgress/);
  assert.match(goals, /mysqlAdmin\.listSalesTargets\(MONTH\)/);
  assert.match(goals, /await mysqlAdmin\.saveSalesTarget/);
  assert.doesNotMatch(goals, /الأهداف المحددة هنا مؤقتة/);
});

test('CRM assignment and success feedback are server-authoritative', () => {
  const state = read('admin/context/site-data-hooks/useCrmCoreState.ts');
  const leads = [
    read('admin/pages/dashboard/tabs/LeadsTab.tsx'),
    read('admin/pages/dashboard/tabs/leads/useLeadActions.ts'),
  ].join('\n');
  const editing = read('admin/pages/unified-client/useUnifiedClientEditState.ts');
  const route = read('api/routes/admin/leads.js');

  assert.match(state, /const updateLead = async[\s\S]{0,500}await mysqlAdmin\.saveLead/);
  assert.match(state, /catch[\s\S]{0,300}return false[\s\S]{0,300}return true/);
  // Scope stays 'unassigned' and distribution stays a single server call — the
  // point of this guard. A second argument (the per-rep daily cap) is passed
  // through to that same call, so it is allowed; a client-side assignment loop
  // still is not, which the doesNotMatch below covers.
  assert.match(leads, /await bulkRedistributeLeads\('unassigned'(?:\s*,[^)]*)?\)/);
  assert.match(leads, /const saved = await updateLead\(\{ \.\.\.lead, status \}\)/);
  assert.doesNotMatch(leads, /crm\.rrIndex/);
  assert.doesNotMatch(leads, /for \(const u of updates\) await updateLead/);
  assert.match(editing, /if \(await updateLead\(leadDraft\)\) setEditing\(false\)/);
  assert.match(route, /isNew && !salesId[\s\S]{0,150}getNextSalesRep/);
});

test('unified client mutations wait for canonical persistence before reporting success', () => {
  const editing = read('admin/pages/unified-client/useUnifiedClientEditState.ts');
  const communications = read('admin/pages/unified-client/useUnifiedClientCommunications.ts');
  assert.match(editing, /await mysqlAdmin\.saveSubscriber\(\{[\s\S]{0,800}credentialUpdate:/);
  assert.match(editing, /await mysqlAdmin\.saveSubscriber[\s\S]{0,1000}await reloadSubscribers\(\)/);
  assert.match(editing, /else if \(!await updateSubscriber\(nextSubscriber\)\)/);
  assert.equal(
    (communications.match(/return updateSubscriber\(\{/g) || []).length,
    1,
  );
  assert.match(communications, /communications: \[\.\.\.\(subscriber\.communications \|\| \[\]\), record\]/);
  assert.match(communications, /if \(await persistCommunication\(draft, updateStatus\)\) onSuccess\(\)/);
  const accessHandler = read('admin/pages/unified-client/useUnifiedClientCourseAccess.ts');
  assert.match(accessHandler, /await mysqlAdmin\.updateEnrollmentAccess/);
  assert.match(accessHandler, /await reloadSubscribers\(\)/);
  assert.doesNotMatch(accessHandler, /updateSubscriber\(/);
});

test('customer profile names persist through the self-service API before success feedback', () => {
  const dashboard = read('client/pages/UserDashboard.tsx');
  const clientApi = read('client/lib/mysqlapi.ts');
  const authRoute = read('api/routes/auth.js');
  assert.match(dashboard, /await mysqlAuth\.updateProfile\(undefined, value\)/);
  assert.match(dashboard, /await refreshMySubscriber\(\)/);
  assert.doesNotMatch(dashboard, /updateSubscriber\(\{ \.\.\.sub, nameEn/);
  assert.match(clientApi, /JSON\.stringify\(\{ name, nameEn \}\)/);
  assert.match(authRoute, /JSON_SET\([\s\S]{0,220}'\$\.nameEn'/);
  assert.match(authRoute, /await conn\.beginTransaction\(\)/);
});

test('customer avatar and support actions do not depend on browser-only operational state', () => {
  const dashboard = read('client/pages/UserDashboard.tsx');
  const settings = read('client/components/student-dashboard/StudentSettingsTab.tsx');
  const support = read('client/components/student-dashboard/StudentSupportTab.tsx');
  assert.doesNotMatch(`${dashboard}\n${settings}`, /avatarDataUrl|localStorage\.(?:getItem|setItem)\(`avatar-|يتم الحفظ على هذا الجهاز/);
  assert.doesNotMatch(dashboard, /StudentSupportTab token=|localStorage\.getItem\('mahad-token'\)/);
  assert.match(support, /credentials: 'include'/);
  assert.doesNotMatch(support, /Authorization: `Bearer/);
});

test('CRM shared state is not stored in browser-local storage', () => {
  const targets = read('admin/pages/dashboard/tabs/leads/useSalesTargetsStorage.ts');
  const whatsapp = read('admin/pages/dashboard/tabs/leads/LeadSubcomponents.tsx');
  const client = read('admin/pages/unified-client/useUnifiedClientCommunications.ts');
  assert.doesNotMatch(targets, /localStorage/);
  assert.doesNotMatch(whatsapp, /wa_rep_|apiToken.*localStorage|localStorage.*apiToken/);
  assert.doesNotMatch(client, /client-note-|localStorage\.setItem\(noteKey/);
  assert.match(targets, /listSalesTargets\(period\)/);
  assert.match(client, /internalQuickNote/);
});

test('site-data browser caches contain public catalog only, never customer or operational truth', () => {
  for (const relativePath of [
    'admin/context/SiteDataContext.tsx',
    'client/context/SiteDataContext.tsx',
  ]) {
    const source = read(relativePath);
    const cacheStart = source.indexOf('const payloadObject = {');
    const cacheEnd = source.indexOf('writeVersionedCache(', cacheStart);
    assert.ok(cacheStart >= 0 && cacheEnd > cacheStart, `${relativePath} cache contract is missing`);
    const payload = source.slice(cacheStart, cacheEnd);
    assert.doesNotMatch(payload, /\b(subscribers|leads|staffMembers|consultations|orders|expenses|activityLogs|joinUsApplications|contactMessages|automationWorkflows|quizAttempts|inboxConversations)\b/);
    assert.match(source, /DATA_VERSION = 4/);
    assert.match(source, /readVersionedCache/);
    assert.match(source, /writeVersionedCache/);
  }
  const sharedCache = read('shared/siteDataCache.ts');
  assert.match(sharedCache, /_dataVersion !== version/);
  assert.match(sharedCache, /stripLargeInlineAssets/);
  assert.doesNotMatch(sharedCache, /subscribers|leads|staffMembers|payments/);
});

test('site-data contexts delegate server runtime orchestration to focused hooks', () => {
  const adminContext = read('admin/context/SiteDataContext.tsx');
  const adminRuntime = read('admin/context/site-data-hooks/useAdminDataRuntime.ts');
  const clientContext = read('client/context/SiteDataContext.tsx');
  const clientRuntime = read('client/context/site-data-hooks/useClientAccountRuntime.ts');

  assert.ok(adminContext.split(/\r?\n/).length < 850);
  assert.match(adminContext, /useAdminDataRuntime\(\{/);
  assert.doesNotMatch(adminContext, /listSubscribersPage|listAllOrders|listAllExpenses/);
  assert.match(adminRuntime, /Promise\.allSettled/);
  assert.match(adminRuntime, /disposed/);
  assert.match(adminRuntime, /lastCRMWriteRef\.current < 180_000/);

  assert.ok(clientContext.split(/\r?\n/).length < 600);
  assert.match(clientContext, /useClientAccountRuntime\(\{/);
  assert.doesNotMatch(clientContext, /getMySubscriber|checkIsStaff|getMyConsultations/);
  assert.doesNotMatch(clientContext, /mysqlAdmin/);
  assert.match(clientRuntime, /mahad-progress-synced/);
  assert.match(clientRuntime, /cancelled/);
});

test('community UI waits for persistence and keeps admin publishing controls permission-bound', () => {
  const page = read('client/pages/Community.tsx');
  const hook = read('client/context/site-data-hooks/useCommunityData.ts');
  const route = read('api/routes/community.js');

  assert.match(page, /await toggleCommunityPostLike\(id\)/);
  assert.match(page, /await addCommunityPostComment\(postId,\s*body\.trim\(\)\)/);
  assert.match(page, /await addCommunityPost\(/);
  assert.match(page, /authUser && !isAdmin/);
  assert.match(page, /\{post\.isOwner && <div/);
  assert.doesNotMatch(page, /handleSubmitLibrary|handleSubmitVideo|handleSubmitEvent|إضافة فعالية/);
  assert.match(hook, /await mysqlClient\.createCommunityPost/);
  assert.match(hook, /await mysqlClient\.deleteCommunityPost/);
  assert.doesNotMatch(hook, /mysqlAdmin|saveCommunityLibraryItem|saveCommunityVideo|saveCommunityEvent/);
  assert.doesNotMatch(hook, /void mysql(?:Admin|Client)\.[A-Za-z]*Community[\s\S]{0,80}\.catch/);
  assert.match(route, /router\.post\('\/api\/community\/posts\/:id\/like'/);
  assert.match(route, /router\.post\('\/api\/community\/posts\/:id\/comments'/);
});

test('customer discounts, broadcasts, quizzes and live sessions hydrate from canonical APIs', () => {
  const configRoute = read('api/routes/config.js');
  const discounts = read('client/context/site-data-hooks/useDiscounts.ts');
  const notifications = read('client/context/site-data-hooks/useNotifications.ts');
  const quizzes = read('client/context/site-data-hooks/useQuizzes.ts');
  const streams = read('client/context/site-data-hooks/useLiveStreams.ts');
  const catalog = read('client/context/site-data-hooks/useCatalogData.ts');
  const adminRuntime = read('admin/context/site-data-hooks/useAdminDataRuntime.ts');

  assert.match(configRoute, /router\.get\('\/api\/discounts',\s*publicLimiter/);
  assert.match(configRoute, /router\.get\('\/api\/notifications\/broadcasts',\s*requireAuth/);
  assert.match(discounts, /mysqlCatalog\.listDiscounts\(\)/);
  assert.match(notifications, /mysqlClient\.getBroadcastNotifications\(\)/);
  assert.match(quizzes, /mysqlCatalog\.listQuizzes\(\)/);
  assert.match(streams, /mysqlCatalog\.listLiveStreams\(\)/);
  assert.match(adminRuntime, /mysqlAdmin\.getNotificationSettings\(\)/);
  assert.doesNotMatch(catalog, /mysqlAdmin|saveCourse|deleteCourse|saveBundle/);
  for (const source of [discounts, notifications, quizzes, streams]) {
    assert.doesNotMatch(source, /mysqlAdmin/);
  }
});

test('admin broadcast and discount editors publish before mutating local state', () => {
  const notificationsState = read('admin/context/site-data-hooks/useNotificationsState.ts');
  const notificationsPage = read('admin/pages/dashboard/tabs/NotificationsAdminTab.tsx');
  const discountsState = read('admin/context/site-data-hooks/useDiscountsState.ts');
  const discountsPage = read('admin/pages/dashboard/tabs/courses/DiscountsView.tsx');

  assert.match(notificationsState, /await mysqlAdmin\.saveNotifications\(next/);
  assert.match(notificationsState, /await mysqlAdmin\.saveNotifications\(next[\s\S]{0,100}setNotifications\(next\)/);
  assert.match(notificationsPage, /await updateNotification/);
  assert.match(notificationsPage, /await addNotification/);
  assert.match(discountsState, /await mysqlAdmin\.saveDiscounts\(next/);
  assert.match(discountsState, /await mysqlAdmin\.saveDiscounts\(next[\s\S]{0,100}setDiscounts\(next\)/);
  assert.match(discountsPage, /await updateDiscount/);
  assert.match(discountsPage, /await addDiscount/);
});

test('unified client defers inactive tabs and modal code instead of shipping one monolithic chunk', () => {
  const unified = read('admin/pages/UnifiedClientPage.tsx');
  const modalHost = read('admin/pages/unified-client/UnifiedClientModalsHost.tsx');
  assert.ok(unified.split(/\r?\n/).length < 700);
  assert.ok(
    (unified.match(/React\.lazy\(/g) || []).length
      + (modalHost.match(/React\.lazy\(/g) || []).length >= 15,
  );
  assert.match(unified, /React\.Suspense/);
  assert.match(unified, /useUnifiedClientPayments/);
  assert.match(unified, /useUnifiedClientLifecycleActions/);
  assert.match(modalHost, /React\.Suspense/);
  assert.doesNotMatch(unified, /import \{ UnifiedClientOverviewTab \}/);
  assert.doesNotMatch(unified, /import \{ UnifiedClientSubscriberPaymentsPanel \}/);
});

test('subscriber profile and login credentials save in one transaction', () => {
  const editing = read('admin/pages/unified-client/useUnifiedClientEditState.ts');
  const subscribersRoute = read('api/routes/admin/subscribers.js');

  assert.match(editing, /mysqlAdmin\.saveSubscriber\(\{[\s\S]{0,800}credentialUpdate:/);
  assert.doesNotMatch(editing, /updateSubscriberCredentials\(/);
  assert.match(subscribersRoute, /credentialUpdate,/);
  assert.match(subscribersRoute, /requestedPasswordHash[\s\S]{0,300}pool\.getConnection\(\)/);
  assert.match(subscribersRoute, /UPDATE users SET \$\{credentialSets\.join\(', '\)\}/);
  assert.match(subscribersRoute, /await conn\.commit\(\)/);
});

test('Dokki subscriber archival uses the canonical action and explicit permission', () => {
  const schedule = read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx');
  const clients = read('admin/pages/dashboard/tabs/daqqi/DaqqiClientsPanel.tsx');
  const growth = read('admin/pages/dashboard/DashboardGrowthOpsTabs.tsx');
  const catalog = read('api/routes/core/catalog.js');
  // The panel is no longer rendered on the schedule page — that page is the
  // schedule, and عملاء الدقي has its own tab. What matters here is that
  // archival still goes through the canonical action with an explicit
  // permission, not where the list happens to be mounted.
  assert.doesNotMatch(schedule, /<DaqqiClientsPanel/);
  assert.match(schedule, /onAddClient=\{/);
  assert.match(clients, /await deleteSubscriber\(subscriber\.id\)/);
  assert.doesNotMatch(clients, /mysqlAdmin\.deleteSubscriber/);
  assert.match(growth, /canDeleteSubscriber=\{canDeleteSubscriber\}/);
  assert.match(catalog, /subscribers\/:id'[\s\S]{0,160}requirePermission\('delete_subscribers'\)/);
});

test('CRM reminders render in their own tab and heavy lead views stay deferred', () => {
  const leads = read('admin/pages/dashboard/tabs/LeadsTab.tsx');
  const header = read('admin/pages/dashboard/tabs/leads/LeadsTabHeader.tsx');
  const tabs = read('admin/pages/dashboard/tabs/leads/LeadSubTabs.tsx');
  const remoteReminders = read('admin/pages/dashboard/tabs/leads/useLeadRemoteReminders.ts');
  const filtering = read('admin/pages/dashboard/tabs/leads/useLeadFilteringData.ts');

  const remindersSection = leads.slice(
    leads.indexOf("subTab === 'reminders'"),
    leads.indexOf("subTab === 'performance'"),
  );
  // 'الاتصالات' was merged into 'المتابعات': one tab, two views switched by
  // followupView. Both panels must therefore render under subTab='reminders',
  // and communications must no longer be a top-level tab of its own.
  assert.match(remindersSection, /<LeadRemindersPanel/);
  assert.match(remindersSection, /<LeadCommunicationsTimeline/);
  assert.match(leads, /followupView === 'followups'/);
  assert.match(leads, /followupView === 'calls'/);
  assert.equal((leads.match(/subTab === 'communications'/g) || []).length, 0);
  assert.doesNotMatch(tabs, /\['communications', 'الاتصالات'/);
  assert.match(tabs, /\['reminders', 'المتابعات'/);
  assert.match(remoteReminders, /subTab !== 'reminders'/);
  assert.match(leads, /const LeadTable = React\.lazy/);
  assert.match(leads, /const QuickEditPanel = React\.lazy/);
  assert.doesNotMatch(header, /LeadSubcomponents/);
  assert.match(filtering, /from '\.\/leadBranchUtils'/);
});

test('dashboard never performs browser-side customer or lead data migrations', () => {
  const dashboard = read('admin/pages/Dashboard.tsx');
  assert.doesNotMatch(dashboard, /lead-mig-/);
  assert.doesNotMatch(dashboard, /clientStatus\s*===\s*['"]leads['"]/);
  assert.doesNotMatch(dashboard, /markLeadsConverted\(/);
});

test('subscriber to lead conversion uses the atomic server workflow', () => {
  const onlineClients = read('admin/pages/dashboard/tabs/OnlineClientsTab.tsx');
  const api = read('admin/lib/mysqlapi.ts');
  const conversionStart = onlineClients.indexOf("if (convertType === 'leads')");
  const conversion = onlineClients.slice(
    conversionStart,
    onlineClients.indexOf("if (convertType === 'refunded')", conversionStart)
  );

  assert.match(api, /convertSubscriberToLead:[\s\S]*convert-to-lead/);
  assert.match(conversion, /await mysqlAdmin\.convertSubscriberToLead\(convertRow\.id\)/);
  assert.match(conversion, /await Promise\.all\(\[reloadSubscribers\(\), reloadLeads\(\)\]\)/);
  assert.doesNotMatch(conversion, /deleteSubscriber\(/);
  assert.doesNotMatch(conversion, /addLead\(/);
});

test('installment writes stay fail-closed and legacy finance UI is read-only', () => {
  const routes = read('api/routes/installments.js');
  const finance = read('admin/pages/dashboard/tabs/FinancialTab.tsx');
  const unifiedPayments = read('admin/pages/unified-client/useUnifiedClientPayments.ts');
  const bulkActions = read('admin/pages/dashboard/tabs/online-clients-sections/BulkActionBar.tsx');
  const mutatingRoutes = routes.match(/router\.(?:post|delete)\([\s\S]*?async \(req, res\) =>/g) || [];

  assert.equal(mutatingRoutes.length, 4);
  mutatingRoutes.forEach(route => assert.match(route, /requireInstallmentWritesEnabled/));
  assert.match(routes, /INSTALLMENT_WRITES_ENABLED === 'true'/);
  assert.doesNotMatch(finance, /saveSubscriberPayment|addEnrollment|handleSaveInstallmentPlan/);
  assert.doesNotMatch(unifiedPayments, /installment-plans\/.*\/pay|handleCreateInstallmentPlan/);
  assert.doesNotMatch(bulkActions, /setCollOnlineBulkConfirm\('refund'\)/);
});

test('balance sheet and cash flow never fabricate accounting figures in the browser', () => {
  const balanceSheet = read('admin/pages/dashboard/tabs/BalanceSheetTab.tsx');
  const cashFlow = read('admin/pages/dashboard/tabs/CashFlowTab.tsx');
  const apiClient = read('admin/lib/mysqlapi.ts');
  const financeRoute = read('api/routes/analytics/financial.js');

  assert.match(balanceSheet, /mysqlAdmin\.getFinancialBalanceSheet\(asOf\)/);
  assert.match(cashFlow, /mysqlAdmin\.getFinancialCashFlow\(from, to\)/);
  assert.match(apiClient, /\/admin\/financial\/balance-sheet\?asOf=/);
  assert.match(apiClient, /\/admin\/financial\/cash-flow\?from=/);
  assert.match(financeRoute, /JOIN journal_entry_lines jel ON jel\.entry_id=je\.id/);
  assert.doesNotMatch(balanceSheet, /0\.4|0\.82|avg per subscriber|platform value estimate/);
  assert.doesNotMatch(cashFlow, /useSiteData|orders[\s\S]{0,120}\.filter|expenses[\s\S]{0,120}\.filter/);
});

test('finance P&L fails closed when the ledger API is unavailable', () => {
  const finance = read('admin/pages/dashboard/tabs/FinancialTab.tsx');
  assert.match(finance, /const totalRevenueEGP = ledgerAllPnl\?\.totalRevenue \?\? 0/);
  assert.match(finance, /const gRevenue = ledgerFilteredPnl\?\.totalRevenue \?\? 0/);
  assert.match(finance, /تعذر تحميل الدفتر المحاسبي/);
  assert.doesNotMatch(finance, /ledgerAllPnl\?\.totalRevenue \?\? local/);
  assert.doesNotMatch(finance, /ledgerFilteredPnl\?\.totalRevenue \?\? local/);
});

test('automation is backend-owned and workflow edits wait for persistence', () => {
  const automationState = read('admin/context/site-data-hooks/useAutomationState.ts');
  const crmState = read('admin/context/site-data-hooks/useCrmCoreState.ts');
  const automationPage = read('admin/pages/dashboard/tabs/AutomationTab.tsx');

  assert.doesNotMatch(automationState, /const triggerAutomation/);
  assert.doesNotMatch(crmState, /triggerAutomationRef|triggerAutomationRef\.current/);
  assert.match(automationState, /await mysqlAdmin\.saveAutomationWorkflow/);
  assert.match(automationState, /await mysqlAdmin\.deleteAutomationWorkflow/);
  assert.match(automationPage, /saved = await updateAutomationWorkflow/);
  assert.match(automationPage, /saved = await addAutomationWorkflow/);
  assert.match(automationPage, /const deleted = await deleteAutomationWorkflow/);
});

test('admin API helper paths never duplicate the configured /api base', () => {
  const adminRoot = path.join(root, 'admin');
  const files = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(full);
    }
  };
  walk(adminRoot);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /mysqlAdmin\.admin(?:Get|Post|Put|Patch|Delete)(?:<[\s\S]{0,300}?>)?\(\s*[`'"]\/api\//,
      `${path.relative(root, file)} passes an already-prefixed /api path to mysqlAdmin`);
  }
});

test('operational admin tools are database-backed rather than browser demos', () => {
  const webhooks = read('admin/pages/dashboard/tabs/WebhooksTab.tsx');
  const tasks = read('admin/pages/dashboard/tabs/TasksBoardTab.tsx');
  const onlineTeam = read('admin/pages/dashboard/tabs/OnlineTeamTab.tsx');
  const staffSettings = read('admin/pages/dashboard/DashboardStaffSettingsPanel.tsx');

  assert.match(webhooks, /adminGet<WebhookConfig\[]>\('\/admin\/webhooks'\)/);
  assert.match(webhooks, /\/admin\/webhooks\/\$\{encodeURIComponent\(item\.id\)\}\/test/);
  assert.doesNotMatch(webhooks, /localStorage|Math\.random|seedDeliveries/);
  assert.match(tasks, /adminGet<Array<Record<string, unknown>>>\('\/admin\/tasks'\)/);
  assert.match(tasks, /adminPost\('\/admin\/tasks'/);
  assert.doesNotMatch(tasks, /\/admin\/kv\/tasks_board|saveTimerRef/);
  assert.match(onlineTeam, /listSalesTargets\(month\(\)\)/);
  assert.doesNotMatch(onlineTeam, /online_targets_|localStorage/);
  assert.match(staffSettings, /getMyPreferences\(\)/);
  assert.match(staffSettings, /saveMyPreferences\(/);
  assert.doesNotMatch(staffSettings, /sales\.waTemplates|sales\.customTags|sales\.waNumber/);
});

test('content, community, quizzes and contact edits wait for server persistence', () => {
  const content = read('admin/context/site-data-hooks/useContentState.ts');
  const community = read('admin/context/site-data-hooks/useCommunityState.ts');
  const quizzes = read('admin/context/site-data-hooks/useCourseQuizzesState.ts');
  const contacts = read('admin/context/site-data-hooks/useContactMessagesState.ts');

  assert.match(content, /contentWriteQueueRef/);
  assert.match(content, /await mysqlAdmin\.saveContent/);
  assert.doesNotMatch(content, /saveContent\([\s\S]{0,80}\.catch\(\(\) => \{\}\)/);
  assert.match(community, /await request/);
  assert.doesNotMatch(community, /void mysqlAdmin/);
  assert.match(quizzes, /await mysqlAdmin\.saveQuiz/);
  assert.match(contacts, /await mysqlAdmin\.updateContactMessage/);
});

test('Dokki round edits are server-first and attendee transfers are atomic', () => {
  const state = read('admin/context/site-data-hooks/useDaqqiRoundsState.ts');
  const page = read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx');
  const route = read('api/routes/daqqi-rounds.js');

  assert.match(state, /await mysqlAdmin\.saveDaqqiRound/);
  assert.match(state, /await mysqlAdmin\.transferDaqqiAttendee/);
  assert.doesNotMatch(state, /persistOrRevert\(\s*mysqlAdmin\.saveDaqqiRound/);
  assert.match(page, /await transferDaqqiAttendee/);
  assert.match(page, /if \(!await doUpdateRound/);
  const transferRoute = route.slice(
    route.indexOf("router.post('/api/admin/daqqi-rounds/transfer-attendee'"),
    route.indexOf("router.delete('/api/admin/daqqi-rounds/:id'"),
  );
  assert.match(transferRoute, /await conn\.beginTransaction\(\)/);
  assert.match(transferRoute, /FOR UPDATE/);
  assert.match(transferRoute, /DELETE FROM daqqi_attendees/);
  assert.match(transferRoute, /INSERT INTO daqqi_attendees/);
  assert.match(transferRoute, /await conn\.commit\(\)/);
  assert.match(transferRoute, /await conn\.rollback\(\)/);
  const housing = read('admin/pages/dashboard/tabs/DaqqiHousingModal.tsx');
  assert.match(housing, /mysqlAdmin\.transferDaqqiAttendee/);
  assert.match(housing, /catch \{[\s\S]{0,160}لم يتم تغيير الروندات/);
});

test('staff password reset uses the privileged server-generated credential flow', () => {
  const profile = read('admin/pages/StaffProfile.tsx');
  const api = read('admin/lib/mysqlapi.ts');
  const auth = read('api/routes/auth.js');

  assert.match(profile, /mysqlAuth\.forceResetPassword\(staff\.email\)/);
  assert.doesNotMatch(profile, /Math\.random\(\)/);
  assert.match(api, /forceResetPassword:[\s\S]{0,200}\/admin\/force-reset-password/);
  assert.match(auth, /const newPassword = generateTemporaryPassword\(\)/);
  assert.match(auth, /temporaryPassword: newPassword/);
});

test('customer notification reads are server-owned per tenant and subscriber', () => {
  const route = read('api/routes/config.js');
  const hook = read('client/context/site-data-hooks/useNotifications.ts');
  const dashboard = read('client/pages/UserDashboard.tsx');

  assert.match(route, /customerNotificationViewer/);
  assert.match(route, /WHERE tenant_id=\? AND viewer_key=\? AND notification_id IN/);
  assert.match(route, /INSERT INTO notification_reads/);
  assert.match(hook, /markBroadcastNotificationRead/);
  assert.match(hook, /markAllBroadcastNotificationsRead/);
  assert.doesNotMatch(dashboard, /dismissed-notifs/);
});

test('lecture, chapter and generated-note edits wait for database persistence', () => {
  const state = read('admin/context/site-data-hooks/useLecturesChaptersState.ts');
  const courses = read('admin/pages/dashboard/tabs/CoursesTab.tsx');
  const quizzes = read('admin/pages/dashboard/tabs/QuizzesTab.tsx');

  assert.match(state, /await mysqlAdmin\.saveLecture/);
  assert.match(state, /await mysqlAdmin\.saveChapter/);
  assert.match(state, /await mysqlAdmin\.deleteLecture/);
  assert.match(state, /await mysqlAdmin\.deleteChapter/);
  assert.match(courses, /const saved = editingLectureId \? await updateLecture/);
  assert.match(courses, /const saved = editingChapterId \? await updateChapter/);
  assert.match(quizzes, /if \(!await updateLecture/);
  assert.doesNotMatch(quizzes, /lecture_notes:|localStorage/);
});

test('therapist portal is staff-linked, server-authorized and assignment scoped', () => {
  const page = read('admin/pages/TherapistPortal.tsx');
  const route = read('api/routes/staff.js');

  assert.match(page, /mysqlClient\.getTherapistPortal\(\)/);
  assert.match(page, /mysqlClient\.updateTherapistConsultation/);
  assert.doesNotMatch(page, /localStorage|portal\.password|handleLogin/);
  assert.match(route, /therapist-portal', requireAuth, requireAdminOrStaff, requirePermission\('manage_consultations'\)/);
  assert.match(route, /t\.tenant_id=\? AND t\.staff_id=\?/);
  assert.match(route, /c\.id=\? AND c\.tenant_id=\? AND c\.deleted_at IS NULL[\s\S]*t\.staff_id=\?/);
});

test('catalog and therapist schedules are server-first and saved atomically', () => {
  const state = read('admin/context/site-data-hooks/useCatalogState.ts');
  const courses = read('admin/pages/dashboard/tabs/CoursesTab.tsx');
  const route = read('api/routes/lms-admin.js');

  assert.match(state, /await persist\(mysqlAdmin\.saveCourse/);
  assert.match(state, /await persist\(mysqlAdmin\.saveTherapist/);
  assert.match(state, /await persist\(mysqlAdmin\.saveBundle/);
  assert.doesNotMatch(state, /persistOrRevert|setTimeout/);
  assert.match(courses, /const saved = editingCourseId \? await updateCourse/);
  assert.match(courses, /const saved = editingTherapistId \? await updateTherapist/);
  const therapistRoute = route.slice(route.indexOf("router.post('/api/admin/therapists'"), route.indexOf("// POST /api/admin/testimonials"));
  assert.match(therapistRoute, /await conn\.beginTransaction\(\)/);
  assert.match(therapistRoute, /DELETE FROM therapist_slots/);
  assert.match(therapistRoute, /INSERT INTO therapist_slots/);
  assert.match(therapistRoute, /UPDATE courses SET instructor/);
  assert.match(therapistRoute, /await conn\.commit\(\)/);
  assert.match(therapistRoute, /await conn\.rollback/);
});

test('orders and recruiting forms never report success before canonical persistence', () => {
  const state = read('admin/context/site-data-hooks/useCrmCoreState.ts');
  const joinPage = read('admin/pages/JoinUs.tsx');
  const ordersPage = read('admin/pages/dashboard/tabs/OrdersTab.tsx');

  assert.match(state, /await mysqlForms\.submitJoinUs/);
  assert.match(state, /await mysqlAdmin\.saveOrder/);
  assert.match(state, /await mysqlAdmin\.updateOrderStatus/);
  assert.match(state, /await mysqlAdmin\.deleteOrder/);
  assert.doesNotMatch(state, /persistOrderToCollection|persistJoinUsToCollection/);
  assert.match(joinPage, /const saved = await addJoinUsApplication/);
  assert.match(joinPage, /if \(saved\) setSubmitted\(true\)/);
  assert.match(ordersPage, /const saved = await addOrder\(newTransfer\)/);
});

test('staff account and consultation creation commit their cross-module writes atomically', () => {
  const profile = read('admin/pages/StaffProfile.tsx');
  const auth = read('api/routes/auth.js');
  const catalog = read('api/routes/core/catalog.js');

  assert.match(profile, /await createStaffAccount\(payload, password\.trim\(\)\)/);
  const staffRoute = auth.slice(
    auth.indexOf("router.post('/api/admin/staff-account'"),
    auth.indexOf("router.post('/api/admin/force-reset-password'"),
  );
  assert.match(staffRoute, /await conn\.beginTransaction\(\)/);
  assert.match(staffRoute, /INSERT INTO users/);
  assert.match(staffRoute, /INSERT INTO staff/);
  assert.match(staffRoute, /await conn\.commit\(\)/);
  assert.match(staffRoute, /await conn\.rollback/);

  const consultationRoute = catalog.slice(
    catalog.indexOf("router.post('/api/admin/consultations'"),
    catalog.indexOf("router.delete('/api/admin/consultations/:id'"),
  );
  assert.match(consultationRoute, /await conn\.beginTransaction\(\)/);
  assert.match(consultationRoute, /INSERT INTO consultations/);
  assert.match(consultationRoute, /INSERT INTO leads/);
  assert.match(consultationRoute, /await logLeadEvent\(/);
  assert.match(consultationRoute, /await conn\.commit\(\)/);
  assert.match(consultationRoute, /await conn\.rollback/);
});

test('AI provider secrets stay behind the authenticated server proxy', () => {
  const configRoute = read('api/routes/config.js');
  const askAi = read('admin/pages/dashboard/tabs/AskAITab.tsx');
  const quizzes = read('admin/pages/dashboard/tabs/QuizzesTab.tsx');
  const settings = read('admin/pages/dashboard/tabs/AdminAiSettingsTab.tsx');
  const browserSources = `${askAi}\n${quizzes}\n${settings}`;

  assert.match(configRoute, /\/api\/admin\/ai\/generate'[\s\S]{0,200}requirePermission\('ask_ai'\)[\s\S]{0,100}aiLimiter/);
  assert.match(configRoute, /generateAdminAi\(settings\.adminAiConfig/);
  assert.match(browserSources, /mysqlAdmin\.generateAdminAi/);
  assert.doesNotMatch(browserSources, /mahad-ai-(?:dev-)?messages|subPhone|contactMessages\.filter/);
  assert.match(configRoute, /admin_ai\.generate/);
  const settingsUpdate = configRoute.slice(
    configRoute.indexOf("router.put('/api/admin/settings'"),
    configRoute.indexOf('// ── Email settings'),
  );
  assert.match(settingsUpdate, /await conn\.beginTransaction\(\)/);
  assert.match(settingsUpdate, /admin\.settings\.updated/);
  assert.match(settingsUpdate, /db: conn/);
  assert.match(settingsUpdate, /await conn\.commit\(\)/);
  assert.match(settingsUpdate, /await conn\.rollback/);
  assert.doesNotMatch(browserSources, /generativelanguage\.googleapis\.com|api\.openai\.com|api\.anthropic\.com/);
  assert.doesNotMatch(browserSources, /Authorization['"]?: `Bearer \$\{apiKey\}`/);
});

test('admin namespace authenticates before database-backed feature gates', () => {
  const httpApp = read('api/lib/httpApp.js');
  const auth = read('api/middleware/auth.js');
  const authIndex = httpApp.indexOf("app.use('/api/admin', (req, res, next)");
  const featureIndex = httpApp.indexOf("app.use('/api/admin', adminFeatureGate)");

  assert.ok(authIndex > 0 && featureIndex > authIndex);
  assert.match(httpApp, /isPublicAdminPath\(pathname\) \? next\(\) : requireAuth\(req, res, next\)/);
  assert.match(auth, /if \(req\.user\?\.uid && req\.user\?\.tenant_id === req\.tenantId\) return next\(\)/);
});

test('admin payment drafts use the canonical Egypt/Saudi/international currency mapping', () => {
  const mapping = read('admin/lib/branchCurrency.ts');
  assert.match(mapping, /ONLINE_SAUDI'\) return 'SAR'/);
  assert.match(mapping, /ONLINE_ABROAD'\) return 'USD'/);
  assert.match(mapping, /return 'EGP'/);

  const consumers = [
    'admin/pages/Dashboard.tsx',
    'admin/pages/dashboard/DashboardQuickBooking.tsx',
    'admin/pages/dashboard/tabs/LeadsTab.tsx',
    'admin/pages/dashboard/tabs/online-clients-sections/ClientsTable.tsx',
  ].map(read).join('\n');
  assert.match(consumers, /currencyForBranch\(/);
  assert.doesNotMatch(consumers, /ONLINE_ABROAD[^\n]{0,100}\?\s*'SAR'/);
});

test('unified client finance computes balances and certificates in the branch settlement currency', () => {
  const payments = read('admin/pages/unified-client/useUnifiedClientPayments.ts');
  const lifecycle = read('admin/pages/unified-client/useUnifiedClientLifecycleActions.ts');
  const clientsTable = read('admin/pages/dashboard/tabs/online-clients-sections/ClientsTable.tsx');
  const drafts = read('admin/lib/clientActionDrafts.ts');
  const handlers = read('admin/pages/dashboard/dashboardPaymentHandlers.ts');
  const helpers = read('admin/pages/dashboard/dashboardHelpers.ts');

  assert.match(drafts, /options\.currency \|\| currencyForBranch\(options\.branch\)/);
  assert.match(payments, /payment\.currency === settlementCurrency/);
  assert.match(payments, /expectedTotals\?\.\[settlementCurrency\]/);
  assert.match(payments, /subPaidTotals\[settlementCurrency\]/);
  assert.match(payments, /currency: settlementCurrency/);
  assert.match(lifecycle, /currency: currencyForBranch\(subscriber\.branch\)/);
  assert.match(clientsTable, /p\.currency === branchCurrency/);
  assert.match(clientsTable, /price\?\.\[branchCurrency\]/);
  assert.doesNotMatch(clientsTable, /setSubInstDraft|title="خطة أقساط"/);
  assert.match(handlers, /سعر \$\{(?:subPayDraft|leadPayDraft)\.currency\} غير مُعرّف/);
  assert.doesNotMatch(handlers, /price\?\.\[(?:subPayDraft|leadPayDraft)\.currency[^\n]*price\?\.EGP/);
  assert.doesNotMatch(helpers, /price\?\.\[currency\] \?\? price\?\.EGP/);
});
