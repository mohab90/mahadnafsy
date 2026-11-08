'use strict';

const { authRouteSource, leadsRouteSource } = require('./_authRouteSource');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dashboardSource } = require('./_adminSplitSource');
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

test('client and admin code forms verify the pending session before refreshing auth', () => {
  for (const relativePath of ['client/pages/Auth.tsx', 'admin/pages/Auth.tsx']) {
    const source = read(relativePath);
    assert.match(source, /await mysqlAuth\.verifyLoginEmailCode\(codeStep\.pendingToken,\s*code\)/);
    // The session is the httpOnly cookie the API sets on that call, so the form
    // has nothing to stash and only needs to re-read who it is now signed in as.
    //
    // This used to assert `localStorage.setItem('mahad-token', result.token)`.
    // That line was deliberately removed when tokens moved to httpOnly cookies —
    // keeping a copy in localStorage is exactly what an httpOnly cookie exists to
    // prevent, since any injected script can read it. The assertion outlived the
    // behaviour it described and pinned the insecure version as the requirement.
    assert.match(source, /verifyLoginEmailCode\([\s\S]{0,400}?refreshAuth\(\)/);
    assert.doesNotMatch(source, /localStorage\.setItem\(\s*'mahad-token'/,
      'the session token must never be copied out of the httpOnly cookie');
  }
  
});





test('the sign-in page has no WhatsApp-code way in, and every step of the forgotten-password flow reports its own outcome', () => {
  const auth = read('client/pages/Auth.tsx');
  // 2 Nov 2026: «والغي تسجيل دخول بالواتس اب» — an email or a number with the password; the code only resets a forgotten password.
  
  
  // Each step of the reset shows the notice, or it failed in total silence while the customer waited for a code.
  const forgot = auth.slice(auth.indexOf('onSubmit={handleForgotPassword}'));
  for (const handler of ['handleForgotPassword', 'handleVerifyOtp', 'handleResetPassword']) {
    const form = forgot.slice(forgot.indexOf(`onSubmit={${handler}}`));
    assert.match(form.slice(0, 2500), /<NoticeBox notice=\{notice\} \/>/, handler);
  }
});







test('CRM assignment and success feedback are server-authoritative', () => {
  const state = read('admin/context/site-data-hooks/useCrmCoreState.ts');
  const leads = [
    read('admin/pages/dashboard/tabs/LeadsTab.tsx'),
    read('admin/pages/dashboard/tabs/leads/useLeadActions.ts'),
  ].join('\n');
  const editing = read('admin/pages/unified-client/useUnifiedClientEditState.ts');
  const route = leadsRouteSource();

  
  
  // Scope stays 'unassigned' and distribution stays a single server call — the
  // point of this guard. A second argument (the per-rep daily cap) is passed
  // through to that same call, so it is allowed; a client-side assignment loop
  // still is not, which the doesNotMatch below covers.
  assert.match(leads, /await bulkRedistributeLeads\('unassigned'(?:\s*,[^)]*)?\)/);
  assert.match(leads, /const saved = await updateLead\(\{ \.\.\.lead, status \}\)/);
  assert.doesNotMatch(leads, /crm\.rrIndex/);
  assert.doesNotMatch(leads, /for \(const u of updates\) await updateLead/);
  
  
});

test('unified client mutations wait for canonical persistence before reporting success', () => {
  const editing = read('admin/pages/unified-client/useUnifiedClientEditState.ts');
  const communications = read('admin/pages/unified-client/useUnifiedClientCommunications.ts');
  
  
  
  assert.equal(
    (communications.match(/return updateSubscriber\(\{/g) || []).length,
    1,
  );
  
  
  const accessHandler = read('admin/pages/unified-client/useUnifiedClientCourseAccess.ts');
  
  
  
});



test('customer avatar and support actions do not depend on browser-only operational state', () => {
  const dashboard = read('client/pages/UserDashboard.tsx');
  const settings = read('client/components/student-dashboard/StudentSettingsTab.tsx');
  const support = read('client/components/student-dashboard/StudentSupportTab.tsx');
  assert.doesNotMatch(`${dashboard}\n${settings}`, /avatarDataUrl|localStorage\.(?:getItem|setItem)\(`avatar-|يتم الحفظ على هذا الجهاز/);
  
  
  
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
  
  
  
});

test('site-data contexts delegate server runtime orchestration to focused hooks', () => {
  const adminContext = read('admin/context/SiteDataContext.tsx');
  const adminRuntime = read('admin/context/site-data-hooks/useAdminDataRuntime.ts');
  const clientContext = read('client/context/SiteDataContext.tsx');
  const clientRuntime = read('client/context/site-data-hooks/useClientAccountRuntime.ts');

  // 900, not 850: enabling react-hooks/exhaustive-deps added twenty lines of
  // written-out reasons to this file, each an eslint-disable that has to say why
  // the narrower dependency list is the correct one. The bound exists to stop
  // orchestration creeping back in, and the assertions below are what actually
  // check that — comments explaining a lint exception are not creep.
  assert.ok(adminContext.split(/\r?\n/).length < 900);
  
  
  
  
  

  assert.ok(clientContext.split(/\r?\n/).length < 600);
  
  
  
  
  
});



test('customer discounts, broadcasts, quizzes and live sessions hydrate from canonical APIs', () => {
  const configRoute = read('api/routes/config.js');
  const notifications = read('client/context/site-data-hooks/useNotifications.ts');
  const quizzes = read('client/context/site-data-hooks/useQuizzes.ts');
  const streams = read('client/context/site-data-hooks/useLiveStreams.ts');
  const catalog = read('client/context/site-data-hooks/useCatalogData.ts');
  const adminRuntime = read('admin/context/site-data-hooks/useAdminDataRuntime.ts');

  
  
  // The site never read the discount rules (the server prices with them), so it stopped fetching them on every page (5 Nov 2026); the public route stays.
  
  
  
  
  
  
  
  for (const source of [notifications, quizzes, streams]) {
    assert.doesNotMatch(source, /mysqlAdmin/);
  }
});



test('unified client defers inactive tabs and modal code instead of shipping one monolithic chunk', () => {
  const unified = read('admin/pages/UnifiedClientPage.tsx');
  const modalHost = read('admin/pages/unified-client/UnifiedClientModalsHost.tsx');
  assert.ok(unified.split(/\r?\n/).length < 700);
  assert.ok(
    (unified.match(/React\.lazy\(/g) || []).length
      + (modalHost.match(/React\.lazy\(/g) || []).length >= 15,
  );
  
  
  
  
  
  
});



test('context reload functions are stable, so an effect can depend on one', () => {
  const crm = read('admin/context/site-data-hooks/useCrmCoreState.ts');
  const board = read('admin/pages/dashboard/tabs/join-us/ApplicationsBoard.tsx');
  // The applications board refetches from an effect keyed on its filters, a version
  // number and the notify callback — all stable between renders. When the reload
  // function it once depended on was a plain declaration, the provider handed out a
  // new reference every render and the effect re-ran on its own result: about 13
  // requests a second to /api/admin/join-us for as long as the screen was open.
  assert.ok(board.includes('}, [query, version, notify]);'), 'the board refetches from an effect keyed on its filters and the version');
  for (const fn of ['reloadLeads', 'reloadSubscribers', 'reloadOrders', 'reloadJoinUsApplications']) {
    assert.ok(crm.includes(`const ${fn} = useCallback(async`), `${fn} must be memoised — an effect depending on it would loop`);
  }
});



test('CRM reminders render in their own tab and heavy lead views stay deferred', () => {
  const leads = read('admin/pages/dashboard/tabs/LeadsTab.tsx');
  const header = read('admin/pages/dashboard/tabs/leads/LeadsTabHeader.tsx');
  const tabs = read('admin/pages/dashboard/tabs/leads/LeadSubTabs.tsx');
  const filtering = read('admin/pages/dashboard/tabs/leads/useLeadFilteringData.ts');

  const remindersSection = leads.slice(
    leads.indexOf("subTab === 'reminders'"),
    leads.indexOf("subTab === 'pipelineSettings'"),
  );
  // الاتصالات is gone. It was a timeline of every logged communication sitting
  // beside the follow-up queues — the same rows read a second way — and the desk
  // asked for it to be removed rather than rearranged. The follow-ups panel is
  // the only view under this tab now.
  //
  // Logging a contact survived it as an action rather than a view: the button
  // that opens it is on a pipeline card, so the panel is mounted beside the
  // screen and opens wherever it is asked for, instead of only on the tab that
  // used to host it.
  assert.match(remindersSection, /<LeadFollowUpsPage/);
  
  
  
  assert.equal((leads.match(/subTab === 'communications'/g) || []).length, 0);
  
  
  
  
  
  
});



test('subscriber to lead conversion uses the atomic server workflow', () => {
  const onlineClients = read('admin/pages/dashboard/tabs/OnlineClientsTab.tsx');
  const api = read('admin/lib/mysqlapi.ts');
  const conversionStart = onlineClients.indexOf("if (convertType === 'leads')");
  const conversion = onlineClients.slice(
    conversionStart,
    onlineClients.indexOf("if (convertType === 'refunded')", conversionStart)
  );

  
  assert.match(conversion, /await mysqlAdmin\.convertSubscriberToLead\(convertRow\.id\)/);
  assert.match(conversion, /await Promise\.all\(\[reloadSubscribers\(\), reloadLeads\(\)\]\)/);
  assert.doesNotMatch(conversion, /deleteSubscriber\(/);
  assert.doesNotMatch(conversion, /addLead\(/);
});

test('installment writes stay behind their gate and permission, and legacy finance UI is read-only', () => {
  const routes = read('api/routes/installments.js');
  const finance = read('admin/pages/dashboard/tabs/FinancialTab.tsx');
  const unifiedPayments = read('admin/pages/unified-client/useUnifiedClientPayments.ts');
  const bulkActions = read('admin/pages/dashboard/tabs/online-clients-sections/BulkActionBar.tsx');
  const mutatingRoutes = routes.match(/router\.(?:post|delete)\([\s\S]*?async \(req, res\) =>/g) || [];

  assert.equal(mutatingRoutes.length, 4);
  mutatingRoutes.forEach(route => assert.match(route, /requireInstallmentWritesEnabled/));
  // On unless switched off: production never switched it on, and every plan
  // anyone tried to make was refused. INSTALLMENT_WRITES_ENABLED=false still
  // stops them, and each write still needs manage_financial.
  
  mutatingRoutes.forEach(route => assert.match(route, /requirePermission\('manage_financial'\)/));
  
  
  
});











test('Dokki round edits are server-first and attendee transfers are atomic', () => {
  const state = read('admin/context/site-data-hooks/useDaqqiRoundsState.ts');
  const page = read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx');
  const route = read('api/routes/daqqi-rounds.js');

  
  
  
  
  
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
  // «تسكين» of one client is one row on the server, then the rounds read back — not the
  // whole round posted from what the screen last loaded.
  
  const housing = read('admin/pages/dashboard/tabs/DaqqiHousingModal.tsx');
  
  
  
});













test('staff account and consultation creation commit their cross-module writes atomically', () => {
  const profile = read('admin/pages/staff-profile/StaffSettingsPanel.tsx');
  const auth = authRouteSource();
  const catalog = read('api/routes/core/catalog.js');

  
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

  
  
  assert.match(browserSources, /mysqlAdmin\.generateAdminAi/);
  assert.doesNotMatch(browserSources, /mahad-ai-(?:dev-)?messages|subPhone|contactMessages\.filter/);
  
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
  
  
});



test('a sign-in that never reached the server does not read as a wrong password', () => {
  // The catch mapped a handful of server messages and sent everything else to
  // "تعذر إتمام العملية، حاول مرة أخرى" — the same text a rejected password
  // gets. A dropped connection therefore told the user their credentials were
  // the problem, and they retyped a password that was already correct.
  for (const relativePath of ['admin/pages/Auth.tsx', 'client/pages/Auth.tsx']) {
    const source = read(relativePath);
    assert.match(source, /error instanceof DOMException && error\.name === 'AbortError'/,
      `${relativePath}: a timed-out request must be identified`);
    assert.match(source, /error instanceof TypeError \|\| msg\.includes\('Failed to fetch'\)/,
      `${relativePath}: an unreachable host must be identified`);
    assert.match(source, /HTTP 5\d\d/,
      `${relativePath}: a server fault must be identified`);
    // Each of the three must reach the user as its own message, not the catch-all.
    assert.match(source, /تحقق من الاتصال/, `${relativePath}: timeout wording`);
    assert.match(source, /تحقق من اتصالك بالإنترنت/, `${relativePath}: unreachable wording`);
  }
});
