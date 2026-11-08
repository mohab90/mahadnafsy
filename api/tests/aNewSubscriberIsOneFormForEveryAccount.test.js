'use strict';
/**
 * «في حسابات التحصيل وحسابات الدقي عند اضافه مشترك جديد بيظهر حجز ودفع ودا غلط المفروض يظهر زر مشترك جديد
 * زي اللى بيظهر عند الادارة … بنفس تفاصيله سواء في الاونلاين او الدقي» (16 Oct 2026) — answered: the same form,
 * without the login, for the collection accounts and the Dokki desk.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const tab = read('admin/pages/dashboard/tabs/OnlineClientsTab.tsx');
const form = read('admin/pages/dashboard/tabs/NewSubscriberModal.tsx');





test('the management still creates the login account; the other two book through the booking endpoint', () => {
  
  const booking = tab.slice(tab.indexOf('const submitNewBooking = async'), tab.indexOf('const [daqqiSettingsOpen'));
  assert.match(booking, /handleNewDaqqiClient\(draft\)/);
  assert.match(booking, /handleNewCollectionClient\(draft\)/, 'a collection officer\'s customer still waits for the manager');
  assert.match(booking, /lockedPrice/, 'a locked desk sends no price of its own');
  
});


