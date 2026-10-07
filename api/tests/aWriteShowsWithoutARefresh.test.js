'use strict';

// «هل في حل ان عميله بعملها لازم اعمل بعدها ريرفريش عشان تظهر؟» (7 Oct 2026):
// a write reloaded the dashboard's lists, but a sales rep's or a collection
// officer's screens read their own scoped lists, refetched every two minutes.
// A reload now announces itself and those lists follow, once per burst.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

test('both reloads announce the change, and the staff lists are refetched on it', () => {
  const core = read('admin/context/site-data-hooks/useCrmCoreState.ts');
  const reloadLeads = core.slice(core.indexOf('const reloadLeads = useCallback'), core.indexOf('const reloadSubscribers = useCallback'));
  const reloadSubs = core.slice(core.indexOf('const reloadSubscribers = useCallback'), core.indexOf('const recordSubscriberPayment'));
  assert.match(reloadLeads, /announceCrmChanged\(\);/);
  assert.match(reloadSubs, /announceCrmChanged\(\);/);
  const dashboard = read('admin/pages/Dashboard.tsx');
  assert.match(dashboard, /window\.addEventListener\(CRM_CHANGED_EVENT, onChanged\);/);
  assert.match(dashboard, /timer = setTimeout\(\(\) => \{ void fetchSalesData\(\); \}, 300\);/, 'one refetch for a burst of reloads');
  assert.doesNotMatch(read('admin/pages/dashboard/useStaffOwnData.ts'), /reloadLeads|reloadSubscribers|announceCrmChanged/,
    'the refetch must not announce a change itself, or it would loop');
});
