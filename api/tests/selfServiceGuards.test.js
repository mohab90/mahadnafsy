'use strict';
/**
 * The routes an employee opens for their own sake, asked of the real routers (these were regular expressions over routes/hr/staffprofile.js, campaigns.js,
 * notifications.js and middleware/auth.js): your own profile, report and messages need no HR right, somebody else's do, and writing to anybody's file is
 * HR's; the personal panels (tasks, notifications) answer any staff member and refuse a caller who is no staff member at all.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { guard, staffWith } = require('./support/routes');

const me = (...permissions) => ({ ...staffWith(...permissions), id: 'st-self' });

test('your own profile, report and messages need no HR right; somebody else\'s need view_hr', async () => {
  const router = require('../routes/hr/staffprofile');
  for (const route of ['profile', 'report', 'messages']) {
    const path = `/api/admin/hr/staff/:id/${route}`;
    const own = await guard(router, 'get', path, { staff: me('manage_inbox'), params: { id: 'st-self' } });
    assert.equal(own.allowed, true, `${route}: your own`);
    const other = await guard(router, 'get', path, { staff: me('manage_inbox'), params: { id: 'st-other' } });
    assert.equal(other.allowed, false, `${route}: somebody else's, with no HR right`);
    assert.equal(other.status, 403);
    assert.equal((await guard(router, 'get', path, { staff: me('view_hr'), params: { id: 'st-other' } })).allowed, true, `${route}: view_hr opens anyone's`);
  }
});

test('writing to somebody\'s file is HR\'s, even on your own id', async () => {
  const router = require('../routes/hr/staffprofile');
  const path = '/api/admin/hr/staff/:id/messages';
  assert.equal((await guard(router, 'post', path, { staff: me('view_hr'), params: { id: 'st-self' } })).allowed, false);
  assert.equal((await guard(router, 'post', path, { staff: me('manage_hr'), params: { id: 'st-other' } })).allowed, true);
});

test('the personal panels answer any staff member and refuse a caller who is no staff member', async () => {
  const tasks = require('../routes/campaigns');
  const notifications = require('../routes/notifications');
  for (const [router, method, path] of [
    [tasks, 'get', '/api/admin/tasks'], [tasks, 'post', '/api/admin/tasks'], [tasks, 'put', '/api/admin/tasks/:id'], [tasks, 'delete', '/api/admin/tasks/:id'],
    [notifications, 'get', '/api/admin/notifications'],
  ]) {
    assert.equal((await guard(router, method, path, { staff: me() })).allowed, true, `${method} ${path}: a staff member with an empty grid`);
    const stranger = await guard(router, method, path, { staff: null });
    assert.equal(stranger.allowed, false, `${method} ${path}: no staff record`);
    assert.equal(stranger.status, 403);
  }
  assert.equal((await guard(notifications, 'delete', '/api/admin/notifications/:id', { staff: me() })).allowed, false, 'removing notifications is a right of its own');
  assert.equal((await guard(notifications, 'delete', '/api/admin/notifications/:id', { staff: me('manage_notifications') })).allowed, true);
});
